import ky from "ky";

import type { DnsConfig, ServerEntry, ServiceEntry } from "../../config/types.ts";
import type { ManagedDnsServerState } from "../../lockfile/types.ts";
import {
  formatHttpTraceBody,
  redactHttpHeaders,
  responseHeadersToRecord,
  type HttpTraceLogger,
} from "../http-trace.ts";
import type {
  AdGuardRewriteEntry,
  DnsRewriteAction,
  DnsRewritePlan,
  DnsSyncResult,
  DnsRewriteSyncResult,
  DnsSyncProgressHandler,
} from "./types.ts";

interface ServiceRewritePlan extends DnsRewritePlan {
  service?: ServiceEntry;
  serviceId: string;
  server: ServerEntry;
}

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export class AdGuardHomeDnsService {
  private readonly config: DnsConfig;
  private readonly client: typeof ky;
  private readonly apiBaseUrl: string;
  private readonly httpTraceLogger?: HttpTraceLogger;

  public constructor(config: DnsConfig, httpTraceLogger?: HttpTraceLogger) {
    this.config = config;
    this.apiBaseUrl = withTrailingSlash(config.api_url);
    this.httpTraceLogger = httpTraceLogger;
    this.client = ky.create({
      prefix: this.apiBaseUrl,
      retry: 0,
      headers: {
        accept: "application/json",
        authorization: this.buildAuthorizationHeader(),
      },
    });
  }

  public async syncServiceRewrites(
    server: ServerEntry,
    services: ServiceEntry[],
    previousState?: ManagedDnsServerState,
    onProgress?: DnsSyncProgressHandler,
  ): Promise<DnsSyncResult> {
    const existing = await this.listRewrites();
    const plans = this.planServiceRewrites(server, services, existing, previousState);
    const results = await Promise.all(
      plans.map(async (plan: ServiceRewritePlan): Promise<DnsRewriteSyncResult> => {
        try {
          await this.applyPlan(plan);
          return {
            ...plan,
          };
        } finally {
          await onProgress?.({
            ...plan,
          });
        }
      }),
    );

    return {
      lockState: this.buildManagedState(server, services),
      results,
    };
  }

  public buildManagedState(server: ServerEntry, services: ServiceEntry[]): ManagedDnsServerState {
    return {
      provider: "ADGUARD_HOME",
      services: Object.fromEntries(
        services
          .slice()
          .sort((left: ServiceEntry, right: ServiceEntry) => left.id.localeCompare(right.id))
          .map((service: ServiceEntry) => {
            const domains = this.getManagedDomains(service);
            if (domains.length === 0) {
              throw new Error(
                `Service '${service.id}' does not define publish.caddy.hostname for DNS sync.`,
              );
            }

            return [
              service.id,
              {
                domains,
                answer: server.ip,
              },
            ];
          }),
      ),
    };
  }

  private async listRewrites(): Promise<AdGuardRewriteEntry[]> {
    try {
      return await this.request<AdGuardRewriteEntry[]>("GET", "rewrite/list");
    } catch (error) {
      throw new Error(
        `Failed to list AdGuard Home rewrites from ${this.apiBaseUrl}rewrite/list: ${this.formatError(error)}`,
      );
    }
  }

  private planServiceRewrites(
    server: ServerEntry,
    services: ServiceEntry[],
    existing: AdGuardRewriteEntry[],
    previousState?: ManagedDnsServerState,
  ): ServiceRewritePlan[] {
    const rewritesByDomain = new Map<string, AdGuardRewriteEntry[]>();

    for (const rewrite of existing) {
      const domainRewrites = rewritesByDomain.get(rewrite.domain) ?? [];
      domainRewrites.push(rewrite);
      rewritesByDomain.set(rewrite.domain, domainRewrites);
    }

    const desiredPlans = services.flatMap((service: ServiceEntry): ServiceRewritePlan[] => {
      const domains = this.getManagedDomains(service);
      if (domains.length === 0) {
        throw new Error(
          `Service '${service.id}' does not define publish.caddy.hostname for DNS sync.`,
        );
      }

      return domains.map((domain: string): ServiceRewritePlan => {
        const desiredAnswer = server.ip;
        const currentRewrites = rewritesByDomain.get(domain) ?? [];
        const currentAnswers = currentRewrites.map((rewrite: AdGuardRewriteEntry) => rewrite.answer);
        const action = this.determineAction(currentAnswers, desiredAnswer);

        return {
          service,
          serviceId: service.id,
          server,
          domain,
          desiredAnswer,
          currentAnswers,
          action,
        };
      });
    });

    const desiredByServiceId = new Map<string, string[]>(
      services.map((service: ServiceEntry): [string, string[]] => {
        const domains = this.getManagedDomains(service);
        if (domains.length === 0) {
          throw new Error(
            `Service '${service.id}' does not define publish.caddy.hostname for DNS sync.`,
          );
        }

        return [service.id, domains];
      }),
    );
    const deletionPlans = Object.entries(previousState?.services ?? {})
      .flatMap(([serviceId, serviceState]): ServiceRewritePlan[] => {
        const desiredDomains = new Set(desiredByServiceId.get(serviceId) ?? []);
        return serviceState.domains
          .filter((domain: string) => !desiredDomains.has(domain))
          .map((domain: string): ServiceRewritePlan => ({
            serviceId,
            server,
            domain,
            desiredAnswer: serviceState.answer,
            currentAnswers: [serviceState.answer],
            action: "delete",
          }));
      })
      .sort((left: ServiceRewritePlan, right: ServiceRewritePlan) =>
        left.serviceId.localeCompare(right.serviceId) || left.domain.localeCompare(right.domain),
      );

    return [...desiredPlans, ...deletionPlans];
  }

  private getManagedDomains(service: ServiceEntry): string[] {
    const primaryDomain = service.publish.caddy?.hostname;
    if (!primaryDomain) {
      return [];
    }

    return [...new Set([primaryDomain, ...(service.publish.caddy?.aliases ?? [])])].sort((left, right) =>
      left.localeCompare(right),
    );
  }

  private determineAction(currentAnswers: string[], desiredAnswer: string): DnsRewriteAction {
    if (currentAnswers.length === 0) {
      return "create";
    }

    if (currentAnswers.length === 1 && currentAnswers[0] === desiredAnswer) {
      return "unchanged";
    }

    return "update";
  }

  private async applyPlan(plan: ServiceRewritePlan): Promise<void> {
    if (plan.action === "unchanged") {
      return;
    }

    try {
      if (plan.action === "delete") {
        await this.request("POST", "rewrite/delete", {
          domain: plan.domain,
          answer: plan.desiredAnswer,
        });
        return;
      }

      if (plan.action === "update") {
        await Promise.all(
          plan.currentAnswers.map((answer: string) =>
            this.request("POST", "rewrite/delete", {
              domain: plan.domain,
              answer,
            }),
          ),
        );
      }

      await this.request("POST", "rewrite/add", {
        domain: plan.domain,
        answer: plan.desiredAnswer,
      });
    } catch (error) {
      throw new Error(
        `Failed to ${plan.action} DNS rewrite for ${plan.domain} -> ${plan.desiredAnswer} via ${this.apiBaseUrl}: ${this.formatError(error)}`,
      );
    }
  }

  private buildAuthorizationHeader(): string {
    const username = process.env[this.config.auth.username_env];
    const password = process.env[this.config.auth.password_env];

    if (!username) {
      throw new Error(
        `Missing environment variable '${this.config.auth.username_env}' for AdGuard Home username.`,
      );
    }

    if (!password) {
      throw new Error(
        `Missing environment variable '${this.config.auth.password_env}' for AdGuard Home password.`,
      );
    }

    return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private async request<T = void>(
    method: "GET" | "POST",
    path: string,
    json?: unknown,
  ): Promise<T> {
    const requestUrl = new URL(path, this.apiBaseUrl).toString();
    const requestHeaders = redactHttpHeaders({
      accept: "application/json",
      authorization: this.buildAuthorizationHeader(),
      ...(json ? { "content-type": "application/json" } : {}),
    });
    const requestBody = formatHttpTraceBody(json);

    try {
      const response = await this.client(path, {
        method,
        json,
        throwHttpErrors: false,
      });
      const responseBody = await response.text();

      await this.httpTraceLogger?.({
        operation: "dns",
        request: {
          method,
          url: requestUrl,
          headers: requestHeaders,
          body: requestBody,
        },
        response: {
          statusCode: response.status,
          statusText: response.statusText,
          headers: responseHeadersToRecord(response.headers),
          body: responseBody,
        },
        transport: "ky",
      });

      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}. ${responseBody}`);
      }

      if (responseBody.length === 0) {
        return undefined as T;
      }

      return JSON.parse(responseBody) as T;
    } catch (error) {
      await this.httpTraceLogger?.({
        operation: "dns",
        request: {
          method,
          url: requestUrl,
          headers: requestHeaders,
          body: requestBody,
        },
        transport: "ky",
        error: this.formatError(error),
      });
      throw error;
    }
  }
}
