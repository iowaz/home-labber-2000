import http from "node:http";
import https from "node:https";
import { createHash } from "node:crypto";

import ky from "ky";

import type { ManagedCaddyServerState } from "../../lockfile/types.ts";
import type { ServerEntry, ServiceEntry } from "../../config/types.ts";
import {
  formatHttpTraceBody,
  redactHttpHeaders,
  responseHeadersToRecord,
  type HttpTraceLogger,
} from "../http-trace.ts";
import type { CaddyApplyResult, CaddyConfigPayload, CaddyRoute } from "./types.ts";

function hasCaddyApi(server: ServerEntry): server is ServerEntry & { "caddy-api": { url: string } } {
  return typeof server["caddy-api"]?.url === "string" && server["caddy-api"].url.length > 0;
}

export class CaddyService {
  public readonly server: ServerEntry & { "caddy-api": { url: string } };
  private readonly serversById: Map<string, ServerEntry>;
  private readonly httpTraceLogger?: HttpTraceLogger;

  public constructor(
    server: ServerEntry,
    servers: ServerEntry[],
    httpTraceLogger?: HttpTraceLogger,
  ) {
    if (!hasCaddyApi(server)) {
      throw new Error(`Server '${server.id}' does not define caddy-api.url.`);
    }

    this.server = server;
    this.serversById = new Map(
      servers.map((entry: ServerEntry): [string, ServerEntry] => [entry.id, entry]),
    );
    this.httpTraceLogger = httpTraceLogger;
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
      .sort((left: ServiceEntry, right: ServiceEntry) =>
        this.getPrimaryHostname(left).localeCompare(this.getPrimaryHostname(right)),
      )
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

  public buildManagedState(services: ServiceEntry[]): ManagedCaddyServerState {
    const payload = this.buildConfigPayload(services);
    const managedServices = Object.fromEntries(
      services
        .slice()
        .sort((left: ServiceEntry, right: ServiceEntry) => left.id.localeCompare(right.id))
        .map((service: ServiceEntry) => {
          const caddyPublication = service.publish.caddy;
          if (!caddyPublication) {
            throw new Error(`Service '${service.id}' does not define publish.caddy.`);
          }

          const originServer = this.serversById.get(service.origin.server);
          if (!originServer) {
            throw new Error(
              `Service '${service.id}' references unknown origin server '${service.origin.server}'.`,
            );
          }

          return [
            service.id,
            {
              hostnames: [caddyPublication.hostname, ...(caddyPublication.aliases ?? [])],
              upstream: `${originServer.ip}:${service.origin.port}`,
            },
          ];
        }),
    );

    return {
      adminUrl: this.getLoadUrl(),
      payloadHash: this.hashPayload(payload),
      services: managedServices,
    };
  }

  public async apply(services: ServiceEntry[]): Promise<CaddyApplyResult> {
    const loadUrl = this.getLoadUrl();
    const payload = this.buildConfigPayload(services);
    const requestBody = formatHttpTraceBody(payload);
    const requestHeaders = redactHttpHeaders({
      accept: "*/*",
      "content-type": "application/json",
    });
    try {
      const response = await ky.post(loadUrl, {
        json: payload,
        retry: 0,
        throwHttpErrors: false,
        headers: {
          accept: "*/*",
        },
      });

      const body = await response.text();
      await this.httpTraceLogger?.({
        operation: "caddy",
        request: {
          method: "POST",
          url: loadUrl,
          headers: requestHeaders,
          body: requestBody,
        },
        response: {
          statusCode: response.status,
          statusText: response.statusText,
          headers: responseHeadersToRecord(response.headers),
          body,
        },
        transport: "ky",
      });

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
    } catch (error) {
      await this.httpTraceLogger?.({
        operation: "caddy",
        request: {
          method: "POST",
          url: loadUrl,
          headers: requestHeaders,
          body: requestBody,
        },
        transport: "ky",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private buildRoute(service: ServiceEntry): CaddyRoute {
    const caddyPublication = service.publish.caddy;
    if (!caddyPublication) {
      throw new Error(`Service '${service.id}' does not define publish.caddy.`);
    }

    const originServer = this.serversById.get(service.origin.server);
    if (!originServer) {
      throw new Error(`Service '${service.id}' references unknown origin server '${service.origin.server}'.`);
    }

    const hostnames: string[] = [caddyPublication.hostname, ...(caddyPublication.aliases ?? [])];
    const upstreamIp = originServer.ip;

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
              dial: `${upstreamIp}:${service.origin.port}`,
            },
          ],
        },
      ],
    };
  }

  private getPrimaryHostname(service: ServiceEntry): string {
    const hostname = service.publish.caddy?.hostname;
    if (!hostname) {
      throw new Error(`Service '${service.id}' does not define publish.caddy.hostname.`);
    }

    return hostname;
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
            const result = {
              statusCode: response.statusCode ?? 0,
              body: responseBody,
            };
            Promise.resolve(
              this.httpTraceLogger?.({
                operation: "caddy",
                request: {
                  method: "POST",
                  url: loadUrl,
                  headers: redactHttpHeaders({
                    "content-type": "application/json",
                    "content-length": String(Buffer.byteLength(body)),
                  }),
                  body,
                },
                response: {
                  statusCode: result.statusCode,
                  statusText: response.statusMessage,
                  headers: Object.fromEntries(
                    Object.entries(response.headers).map(([name, value]) => [
                      name,
                      Array.isArray(value) ? value.join(", ") : String(value ?? ""),
                    ]),
                  ),
                  body: responseBody,
                },
                transport: "native",
              }),
            )
              .then(() => {
                resolve(result);
              })
              .catch(reject);
          });
        },
      );

      request.on("error", (error) => {
        Promise.resolve(
          this.httpTraceLogger?.({
            operation: "caddy",
            request: {
              method: "POST",
              url: loadUrl,
              headers: redactHttpHeaders({
                "content-type": "application/json",
                "content-length": String(Buffer.byteLength(body)),
              }),
              body,
            },
            transport: "native",
            error: error instanceof Error ? error.message : String(error),
          }),
        )
          .then(() => {
            reject(error);
          })
          .catch(reject);
      });
      request.write(body);
      request.end();
    });
  }

  private hashPayload(payload: CaddyConfigPayload): string {
    return `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`;
  }
}
