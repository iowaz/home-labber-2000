import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import { decorate, injectable } from "inversify";
import { parse } from "yaml";

import type {
  ConfigLoader,
  DnsConfig,
  HomelabConfig,
  ServerEntry,
  ServiceEntry,
} from "./types.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectString(value: unknown, field: string, issues: string[]): string {
  if (typeof value === "string") {
    return value;
  }

  issues.push(`${field} must be a string.`);
  return "";
}

function expectNumber(value: unknown, field: string, issues: string[]): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  issues.push(`${field} must be a number.`);
  return 0;
}

function expectBoolean(value: unknown, field: string, issues: string[]): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  issues.push(`${field} must be a boolean.`);
  return false;
}

function validateHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253) {
    return false;
  }

  const labels: string[] = hostname.split(".");
  return labels.every((label: string) =>
    /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(label),
  );
}

function validateUrlPath(urlPath: string): boolean {
  return urlPath.startsWith("/");
}

function validateHttpUrl(url: string, field: string, issues: string[]): void {
  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      issues.push(`${field} must use http or https.`);
    }
  } catch {
    issues.push(`${field} must be a valid URL.`);
  }
}

async function parseYamlFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return parse(raw) as unknown;
}

function parseDnsConfig(value: unknown, issues: string[]): DnsConfig {
  if (!isRecord(value)) {
    issues.push("dns.yaml must contain an object.");
    return {
      type: "",
      api_url: "",
      auth: {
        username_env: "",
        password_env: "",
      },
      options: {
        ttl_seconds: 0,
        create_dns_rewrites: false,
      },
    };
  }

  const auth: UnknownRecord = isRecord(value.auth) ? value.auth : {};
  const options: UnknownRecord = isRecord(value.options) ? value.options : {};
  const apiUrl = expectString(value.api_url, "dns.api_url", issues);
  validateHttpUrl(apiUrl, "dns.api_url", issues);

  return {
    type: expectString(value.type, "dns.type", issues),
    api_url: apiUrl,
    auth: {
      username_env: expectString(auth.username_env, "dns.auth.username_env", issues),
      password_env: expectString(auth.password_env, "dns.auth.password_env", issues),
    },
    options: {
      ttl_seconds:
        options.ttl_seconds === undefined
          ? 0
          : expectNumber(options.ttl_seconds, "dns.options.ttl_seconds", issues),
      create_dns_rewrites: expectBoolean(
        options.create_dns_rewrites,
        "dns.options.create_dns_rewrites",
        issues,
      ),
    },
  };
}

function parseServers(value: unknown, issues: string[]): ServerEntry[] {
  if (!Array.isArray(value)) {
    issues.push("servers.yaml must contain a list.");
    return [];
  }

  return value.flatMap((entry: unknown, index: number): ServerEntry[] => {
    if (!isRecord(entry)) {
      issues.push(`servers[${index}] must be an object.`);
      return [];
    }

    const server: ServerEntry = {
      id: expectString(entry.id, `servers[${index}].id`, issues),
      ip: expectString(entry.ip, `servers[${index}].ip`, issues),
      os: expectString(entry.os, `servers[${index}].os`, issues),
      description: expectString(entry.description, `servers[${index}].description`, issues),
    };

    if (server.ip && isIP(server.ip) === 0) {
      issues.push(`servers[${index}].ip must be a valid IP address.`);
    }

    const caddyApi = isRecord(entry["caddy-api"]) ? entry["caddy-api"] : undefined;
    if (caddyApi) {
      const url = expectString(caddyApi.url, `servers[${index}].caddy-api.url`, issues);
      validateHttpUrl(url, `servers[${index}].caddy-api.url`, issues);
      server["caddy-api"] = { url };
    }

    const caddy = isRecord(entry.caddy) ? entry.caddy : undefined;
    if (caddy) {
      server.caddy = {
        caddyfile_path: expectString(
          caddy.caddyfile_path,
          `servers[${index}].caddy.caddyfile_path`,
          issues,
        ),
        reload_command: expectString(
          caddy.reload_command,
          `servers[${index}].caddy.reload_command`,
          issues,
        ),
      };
    }

    const ssh = isRecord(entry.ssh) ? entry.ssh : undefined;
    if (ssh) {
      server.ssh = {
        user: expectString(ssh.user, `servers[${index}].ssh.user`, issues),
        private_key_path:
          typeof ssh.private_key_path === "string" ? ssh.private_key_path : undefined,
        port: typeof ssh.port === "number" && Number.isFinite(ssh.port) ? ssh.port : undefined,
      };
    }

    const winrm = isRecord(entry.winrm) ? entry.winrm : undefined;
    if (winrm) {
      server.winrm = {
        user: expectString(winrm.user, `servers[${index}].winrm.user`, issues),
        password_file: expectString(
          winrm.password_file,
          `servers[${index}].winrm.password_file`,
          issues,
        ),
        port: expectNumber(winrm.port, `servers[${index}].winrm.port`, issues),
        transport: expectString(winrm.transport, `servers[${index}].winrm.transport`, issues),
      };
    }

    return [server];
  });
}

function parseServices(value: unknown, issues: string[]): ServiceEntry[] {
  if (!Array.isArray(value)) {
    issues.push("services.yaml must contain a list.");
    return [];
  }

  return value.flatMap((entry: unknown, index: number): ServiceEntry[] => {
    if (!isRecord(entry)) {
      issues.push(`services[${index}] must be an object.`);
      return [];
    }

    const service: ServiceEntry = {
      id: expectString(entry.id, `services[${index}].id`, issues),
      domain: expectString(entry.domain, `services[${index}].domain`, issues),
      description: expectString(entry.description, `services[${index}].description`, issues),
      server: expectString(entry.server, `services[${index}].server`, issues),
      port: expectNumber(entry.port, `services[${index}].port`, issues),
    };

    if (entry.ip_override !== undefined) {
      service.ip_override = expectString(
        entry.ip_override,
        `services[${index}].ip_override`,
        issues,
      );

      if (service.ip_override && isIP(service.ip_override) === 0) {
        issues.push(`services[${index}].ip_override must be a valid IP address.`);
      }
    }

    if (!validateHostname(service.domain)) {
      issues.push(`services[${index}].domain must be a valid hostname.`);
    }

    if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535) {
      issues.push(`services[${index}].port must be an integer between 1 and 65535.`);
    }

    if (entry.aliases !== undefined) {
      if (!Array.isArray(entry.aliases)) {
        issues.push(`services[${index}].aliases must be a list.`);
      } else {
        const aliases = entry.aliases.map((alias: unknown, aliasIndex: number): string =>
          expectString(alias, `services[${index}].aliases[${aliasIndex}]`, issues),
        );
        service.aliases = aliases;

        for (const alias of aliases) {
          if (!validateHostname(alias)) {
            issues.push(`services[${index}].aliases contains an invalid hostname: ${alias}`);
          }
        }
      }
    }

    const healthcheck = isRecord(entry.healthcheck) ? entry.healthcheck : undefined;
    if (healthcheck) {
      const urlPath = expectString(
        healthcheck.url_path,
        `services[${index}].healthcheck.url_path`,
        issues,
      );
      if (!validateUrlPath(urlPath)) {
        issues.push(`services[${index}].healthcheck.url_path must start with '/'.`);
      }
      service.healthcheck = { url_path: urlPath };
    }

    return [service];
  });
}

function validateReferences(config: HomelabConfig, issues: string[]): void {
  const serverIds = new Set<string>();
  const serviceIds = new Set<string>();
  const hostnames = new Set<string>();

  for (const server of config.servers) {
    if (serverIds.has(server.id)) {
      issues.push(`Duplicate server id found: ${server.id}`);
    }
    serverIds.add(server.id);
  }

  for (const service of config.services) {
    if (serviceIds.has(service.id)) {
      issues.push(`Duplicate service id found: ${service.id}`);
    }
    serviceIds.add(service.id);

    if (!serverIds.has(service.server)) {
      issues.push(`services.${service.id} references unknown server '${service.server}'.`);
    }

    const names: string[] = [service.domain, ...(service.aliases ?? [])];
    for (const hostname of names) {
      if (hostnames.has(hostname)) {
        issues.push(`Duplicate hostname found: ${hostname}`);
      }
      hostnames.add(hostname);
    }
  }
}

export class YamlConfigLoader implements ConfigLoader {
  public async load(configDirectory: string): Promise<HomelabConfig> {
    const dnsPath = path.join(configDirectory, "dns.yaml");
    const serversPath = path.join(configDirectory, "servers.yaml");
    const servicesPath = path.join(configDirectory, "services.yaml");

    const [dnsRaw, serversRaw, servicesRaw] = await Promise.all([
      parseYamlFile(dnsPath),
      parseYamlFile(serversPath),
      parseYamlFile(servicesPath),
    ]);

    const issues: string[] = [];
    const config: HomelabConfig = {
      dns: parseDnsConfig(dnsRaw, issues),
      servers: parseServers(serversRaw, issues),
      services: parseServices(servicesRaw, issues),
    };

    validateReferences(config, issues);

    if (issues.length > 0) {
      throw new Error(`Invalid config:\n- ${issues.join("\n- ")}`);
    }

    return config;
  }
}

decorate(injectable(), YamlConfigLoader);
