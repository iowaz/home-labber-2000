import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface HttpRequestRecord {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
}

interface TestHttpServer {
  baseUrl: string;
  requests: HttpRequestRecord[];
  close: () => Promise<void>;
}

interface TestWorkspace {
  root: string;
  configDirectory: string;
  lockfilePath: string;
}

interface CaddyLoadPayload {
  apps: {
    http: {
      servers: {
        srv0: {
          routes: Array<{
            match: Array<{ host: string[] }>;
            handle: Array<{ upstreams: Array<{ dial: string }> }>;
          }>;
        };
      };
    };
  };
}

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

function uniqueId(prefix: string): string {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createWorkspace(): Promise<TestWorkspace> {
  const root = await mkdtemp(path.join(os.tmpdir(), "homelab-syncer-e2e-"));
  const configDirectory = path.join(root, "config");

  await writeFile(
    path.join(root, ".keep"),
    "created by home-lab-machine-syncer e2e tests\n",
    "utf8",
  );
  await rm(configDirectory, { force: true, recursive: true });
  await mkdir(configDirectory, { recursive: true });

  return {
    root,
    configDirectory,
    lockfilePath: path.join(root, "homelab.lock.json"),
  };
}

async function writeConfigFile(workspace: TestWorkspace, filename: string, content: string): Promise<void> {
  await writeFile(path.join(workspace.configDirectory, filename), `${content.trim()}\n`, "utf8");
}

async function writeBaseConfig(
  workspace: TestWorkspace,
  options: {
    caddyApiUrl: string;
    adguardApiUrl: string;
    serviceId?: string;
    hostname?: string;
    alias?: string;
  },
): Promise<{ serviceId: string; hostname: string; alias: string }> {
  const serviceId = options.serviceId ?? uniqueId("dashboard").replaceAll(".", "-");
  const hostname = options.hostname ?? `${serviceId}.e2e.home.test`;
  const alias = options.alias ?? `${serviceId}-alias.e2e.home.test`;

  await writeConfigFile(
    workspace,
    "cloudflare-tunnels.yaml",
    `
account_id: ""
auth:
  api_token_env: TEST_CLOUDFLARE_API_TOKEN
options:
  sync_public_dns: false
`,
  );

  await writeConfigFile(
    workspace,
    "dns.yaml",
    `
type: ADGUARD_HOME
api_url: ${options.adguardApiUrl}/control
auth:
  username_env: TEST_ADGUARD_USERNAME
  password_env: TEST_ADGUARD_PASSWORD
options:
  ttl_seconds: 0
  create_dns_rewrites: true
`,
  );

  await writeConfigFile(
    workspace,
    "servers.yaml",
    `
- id: caddy-publish
  description: E2E Caddy publish target
  ip: 10.77.0.10
  os: linux
  caddy-api:
    url: ${options.caddyApiUrl}/
- id: app-origin
  description: E2E application origin
  ip: 10.77.0.20
  os: linux
`,
  );

  await writeConfigFile(
    workspace,
    "services.yaml",
    `
- id: ${serviceId}
  description: E2E dashboard
  origin:
    server: app-origin
    port: 8080
    healthcheck:
      url_path: /health
  publish:
    caddy:
      via: caddy-publish
      hostname: ${hostname}
      aliases:
        - ${alias}
  dns:
    from_publish: caddy
`,
  );

  return { serviceId, hostname, alias };
}

function runCli(args: string[], options?: { env?: NodeJS.ProcessEnv }): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "src/cli.mts", ...args],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          TEST_ADGUARD_USERNAME: "e2e-user",
          TEST_ADGUARD_PASSWORD: "e2e-password",
          ...options?.env,
        },
        signal: controller.signal,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function readRequestBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      raw += chunk;
    });
    request.on("error", reject);
    request.on("end", () => {
      resolve(raw.length > 0 ? JSON.parse(raw) : undefined);
    });
  });
}

async function startCaddyApiServer(): Promise<TestHttpServer> {
  const requests: HttpRequestRecord[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const body = await readRequestBody(request);
      requests.push({
        method: request.method ?? "",
        path: request.url ?? "",
        headers: request.headers,
        body,
      });

      if (request.method === "POST" && request.url === "/load") {
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("ok");
        return;
      }

      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  return listen(server, requests);
}

async function startAdGuardApiServer(initialRewrites: Array<{ domain: string; answer: string }> = []): Promise<TestHttpServer> {
  const requests: HttpRequestRecord[] = [];
  const rewrites = [...initialRewrites];
  const expectedAuthorization = `Basic ${Buffer.from("e2e-user:e2e-password").toString("base64")}`;

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const body = await readRequestBody(request);
      requests.push({
        method: request.method ?? "",
        path: request.url ?? "",
        headers: request.headers,
        body,
      });

      if (request.headers.authorization !== expectedAuthorization) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      if (request.method === "GET" && request.url === "/control/rewrite/list") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(rewrites));
        return;
      }

      if (request.method === "POST" && request.url === "/control/rewrite/add") {
        const rewrite = body as { domain: string; answer: string };
        rewrites.push({ domain: rewrite.domain, answer: rewrite.answer });
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
        return;
      }

      if (request.method === "POST" && request.url === "/control/rewrite/delete") {
        const rewrite = body as { domain: string; answer: string };
        const index = rewrites.findIndex(
          (entry) => entry.domain === rewrite.domain && entry.answer === rewrite.answer,
        );
        if (index >= 0) {
          rewrites.splice(index, 1);
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  return listen(server, requests);
}

function listen(server: Server, requests: HttpRequestRecord[]): Promise<TestHttpServer> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object", "test HTTP server must listen on a TCP port");
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        requests,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}

test("apply --dry-run validates config and prepares changes without external writes or lockfile changes", async (t) => {
  const workspace = await createWorkspace();
  const caddyApi = await startCaddyApiServer();
  const adguardApi = await startAdGuardApiServer();

  t.after(async () => {
    await caddyApi.close();
    await adguardApi.close();
    await rm(workspace.root, { force: true, recursive: true });
  });

  const { hostname } = await writeBaseConfig(workspace, {
    caddyApiUrl: caddyApi.baseUrl,
    adguardApiUrl: adguardApi.baseUrl,
  });

  const result = await runCli([
    "apply",
    "--dry-run",
    "--config",
    workspace.configDirectory,
    "--lockfile",
    workspace.lockfilePath,
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Origins/);
  assert.match(result.stdout, new RegExp(hostname));
  assert.match(result.stdout, /routes prepared/);
  assert.match(result.stdout, /skipped \(dry run\)/);
  assert.equal(caddyApi.requests.length, 0, "dry-run must not POST Caddy config");
  assert.equal(adguardApi.requests.length, 0, "dry-run must not call AdGuard Home");
  await assert.rejects(readFile(workspace.lockfilePath, "utf8"), { code: "ENOENT" });
});

test("apply syncs Caddy and AdGuard through HTTP APIs, writes managed lockfile state, then skips unchanged reapply", async (t) => {
  const workspace = await createWorkspace();
  const caddyApi = await startCaddyApiServer();
  const adguardApi = await startAdGuardApiServer();

  t.after(async () => {
    await caddyApi.close();
    await adguardApi.close();
    await rm(workspace.root, { force: true, recursive: true });
  });

  const { serviceId, hostname, alias } = await writeBaseConfig(workspace, {
    caddyApiUrl: caddyApi.baseUrl,
    adguardApiUrl: adguardApi.baseUrl,
  });

  const firstApply = await runCli([
    "apply",
    "--config",
    workspace.configDirectory,
    "--lockfile",
    workspace.lockfilePath,
  ]);

  assert.equal(firstApply.exitCode, 0, firstApply.stderr);
  assert.match(firstApply.stdout, /1 routes applied/);
  assert.match(firstApply.stdout, /1 create/);

  assert.equal(caddyApi.requests.length, 1, "first apply should POST one Caddy payload");
  assert.equal(caddyApi.requests[0]?.method, "POST");
  assert.equal(caddyApi.requests[0]?.path, "/load");

  const caddyPayload = caddyApi.requests[0]?.body as CaddyLoadPayload;
  const route = caddyPayload.apps.http.servers.srv0.routes[0];
  assert.deepEqual(route?.match[0]?.host, [hostname, alias]);
  assert.equal(route?.handle[0]?.upstreams[0]?.dial, "10.77.0.20:8080");

  assert.deepEqual(
    adguardApi.requests.map((request) => `${request.method} ${request.path}`),
    ["GET /control/rewrite/list", "POST /control/rewrite/add"],
  );
  assert.deepEqual(adguardApi.requests[1]?.body, {
    domain: hostname,
    answer: "10.77.0.10",
  });

  const lockfile = JSON.parse(await readFile(workspace.lockfilePath, "utf8")) as {
    caddy: Record<string, { services: Record<string, { hostnames: string[]; upstream: string }> }>;
    dns: Record<string, { services: Record<string, { domain: string; answer: string }> }>;
  };
  assert.deepEqual(lockfile.caddy["caddy-publish"]?.services[serviceId], {
    hostnames: [hostname, alias],
    upstream: "10.77.0.20:8080",
  });
  assert.deepEqual(lockfile.dns["caddy-publish"]?.services[serviceId], {
    domain: hostname,
    answer: "10.77.0.10",
  });

  caddyApi.requests.length = 0;
  adguardApi.requests.length = 0;

  const secondApply = await runCli([
    "apply",
    "--config",
    workspace.configDirectory,
    "--lockfile",
    workspace.lockfilePath,
  ]);

  assert.equal(secondApply.exitCode, 0, secondApply.stderr);
  assert.match(secondApply.stdout, /skipped \(lockfile unchanged\)/);
  assert.equal(caddyApi.requests.length, 0, "unchanged Caddy state should not call Caddy");
  assert.equal(adguardApi.requests.length, 0, "unchanged DNS state should not call AdGuard Home");
});

test("apply --full-http-output prints request and response details for HTTP-backed operations", async (t) => {
  const workspace = await createWorkspace();
  const caddyApi = await startCaddyApiServer();
  const adguardApi = await startAdGuardApiServer();

  t.after(async () => {
    await caddyApi.close();
    await adguardApi.close();
    await rm(workspace.root, { force: true, recursive: true });
  });

  const { hostname } = await writeBaseConfig(workspace, {
    caddyApiUrl: caddyApi.baseUrl,
    adguardApiUrl: adguardApi.baseUrl,
  });

  const result = await runCli([
    "apply",
    "--full-http-output",
    "--config",
    workspace.configDirectory,
    "--lockfile",
    workspace.lockfilePath,
  ]);

  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /Caddy HTTP \| request POST http:\/\/127\.0\.0\.1:\d+\/load \| transport ky/);
  assert.match(result.stdout, /Caddy HTTP \| request body \|/);
  assert.match(result.stdout, new RegExp(`\\"${hostname}\\"`));
  assert.match(result.stdout, /Caddy HTTP \| status 200/);
  assert.match(result.stdout, /Caddy HTTP \| response body \| ok/);
  assert.match(result.stdout, /AdGuard DNS HTTP \| request GET http:\/\/127\.0\.0\.1:\d+\/control\/rewrite\/list \| transport ky/);
  assert.match(result.stdout, /AdGuard DNS HTTP \| request POST http:\/\/127\.0\.0\.1:\d+\/control\/rewrite\/add \| transport ky/);
  assert.match(result.stdout, /authorization: <redacted>/);
  assert.match(result.stdout, /AdGuard DNS HTTP \| response body \| \[\]/);
  assert.match(result.stdout, /AdGuard DNS HTTP \| response body \| \{\}/);
});

test("apply --full-http-output prints attempted request details when an HTTP call fails before a response", async (t) => {
  const workspace = await createWorkspace();
  const caddyApi = await startCaddyApiServer();

  t.after(async () => {
    await caddyApi.close();
    await rm(workspace.root, { force: true, recursive: true });
  });

  await writeBaseConfig(workspace, {
    caddyApiUrl: caddyApi.baseUrl,
    adguardApiUrl: "http://127.0.0.1:1",
  });

  const result = await runCli([
    "apply",
    "--full-http-output",
    "--config",
    workspace.configDirectory,
    "--lockfile",
    workspace.lockfilePath,
  ]);

  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.exitCode, 1);
  assert.match(output, /AdGuard DNS HTTP \| request GET http:\/\/127\.0\.0\.1:1\/control\/rewrite\/list \| transport ky/);
  assert.match(output, /AdGuard DNS HTTP \| error /);
});

test("apply reports validation errors and does not create a lockfile for invalid config", async (t) => {
  const workspace = await createWorkspace();

  t.after(async () => {
    await rm(workspace.root, { force: true, recursive: true });
  });

  await writeConfigFile(
    workspace,
    "cloudflare-tunnels.yaml",
    `
account_id: ""
auth:
  api_token_env: TEST_CLOUDFLARE_API_TOKEN
options:
  sync_public_dns: false
`,
  );
  await writeConfigFile(
    workspace,
    "dns.yaml",
    `
type: ADGUARD_HOME
api_url: http://127.0.0.1:1/control
auth:
  username_env: TEST_ADGUARD_USERNAME
  password_env: TEST_ADGUARD_PASSWORD
options:
  ttl_seconds: 0
  create_dns_rewrites: true
`,
  );
  await writeConfigFile(
    workspace,
    "servers.yaml",
    `
- id: app-origin
  description: E2E application origin
  ip: 10.77.0.20
  os: linux
`,
  );
  await writeConfigFile(
    workspace,
    "services.yaml",
    `
- id: broken-service
  description: Broken E2E service
  origin:
    server: app-origin
    port: 8080
  publish:
    caddy:
      via: missing-caddy
      hostname: broken.e2e.home.test
`,
  );

  const result = await runCli([
    "apply",
    "--dry-run",
    "--config",
    workspace.configDirectory,
    "--lockfile",
    workspace.lockfilePath,
  ]);

  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.exitCode, 1);
  assert.match(output, /Invalid config/);
  assert.match(
    output,
    /services\.broken-service references unknown caddy publish server 'missing-caddy'/,
  );
  await assert.rejects(readFile(workspace.lockfilePath, "utf8"), { code: "ENOENT" });
});
