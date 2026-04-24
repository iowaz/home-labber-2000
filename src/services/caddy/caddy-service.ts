import http from "node:http";
import https from "node:https";

import ky from "ky";

import type { ServerEntry, ServiceEntry } from "../../config/types.ts";
import type { CaddyApplyResult, CaddyConfigPayload, CaddyRoute } from "./types.ts";

function hasCaddyApi(server: ServerEntry): server is ServerEntry & { "caddy-api": { url: string } } {
  return typeof server["caddy-api"]?.url === "string" && server["caddy-api"].url.length > 0;
}

export class CaddyService {
  public readonly server: ServerEntry & { "caddy-api": { url: string } };

  public constructor(server: ServerEntry) {
    if (!hasCaddyApi(server)) {
      throw new Error(`Server '${server.id}' does not define caddy-api.url.`);
    }

    this.server = server;
  }

  public getLoadUrl(): string {
    return new URL("/load", this.server["caddy-api"].url).toString();
  }

  public buildConfigPayload(services: ServiceEntry[]): CaddyConfigPayload {
    const adminUrl = new URL(this.server["caddy-api"].url);
    const adminPort =
      adminUrl.port ||
      (adminUrl.protocol === "https:" ? "443" : adminUrl.protocol === "http:" ? "80" : "");

    const routes: CaddyRoute[] = services
      .slice()
      .sort((left: ServiceEntry, right: ServiceEntry) => left.domain.localeCompare(right.domain))
      .map((service: ServiceEntry) => this.buildRoute(service));

    return {
      admin: {
        listen: `0.0.0.0:${adminPort}`,
      },
      apps: {
        http: {
          servers: {
            srv0: {
              listen: [":80"],
              routes,
            },
          },
        },
      },
    };
  }

  public async apply(services: ServiceEntry[]): Promise<CaddyApplyResult> {
    const loadUrl = this.getLoadUrl();
    const payload = this.buildConfigPayload(services);
    const response = await ky.post(loadUrl, {
      json: payload,
      retry: 0,
      throwHttpErrors: false,
      headers: {
        accept: "*/*",
      },
    });

    const body = await response.text();
    if (response.status === 403 && body.includes("client is not allowed to access from origin")) {
      const fallback = await this.postJsonWithNativeHttp(loadUrl, payload);
      return {
        ...fallback,
        transport: "native",
      };
    }

    return {
      statusCode: response.status,
      body,
      transport: "ky",
    };
  }

  private buildRoute(service: ServiceEntry): CaddyRoute {
    const hostnames: string[] = [service.domain, ...(service.aliases ?? [])];
    const upstreamIp = service.ip_override ?? this.server.ip;

    return {
      match: [
        {
          host: hostnames,
        },
      ],
      handle: [
        {
          handler: "reverse_proxy",
          upstreams: [
            {
              dial: `${upstreamIp}:${service.port}`,
            },
          ],
        },
      ],
    };
  }

  private async postJsonWithNativeHttp(
    loadUrl: string,
    payload: CaddyConfigPayload,
  ): Promise<Omit<CaddyApplyResult, "transport">> {
    const url = new URL(loadUrl);
    const body = JSON.stringify(payload);
    const transport = url.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const request = transport.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
        },
        (response) => {
          let responseBody = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            responseBody += chunk;
          });
          response.on("end", () => {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: responseBody,
            });
          });
        },
      );

      request.on("error", reject);
      request.write(body);
      request.end();
    });
  }
}
