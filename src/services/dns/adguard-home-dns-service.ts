import ky from "ky";

import type { DnsConfig, ServerEntry, ServiceEntry } from "../../config/types.ts";
import type {
  AdGuardRewriteEntry,
  DnsRewriteAction,
  DnsRewritePlan,
  DnsRewriteSyncResult,
  DnsSyncProgressHandler,
} from "./types.ts";

interface ServiceRewritePlan extends DnsRewritePlan {
  service: ServiceEntry;
  server: ServerEntry;
}

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export class AdGuardHomeDnsService {
  private readonly config: DnsConfig;
  private readonly client: typeof ky;
  private readonly apiBaseUrl: string;

  public constructor(config: DnsConfig) {
    this.config = config;
    this.apiBaseUrl = withTrailingSlash(config.api_url);
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
    onProgress?: DnsSyncProgressHandler,
  ): Promise<DnsRewriteSyncResult[]> {
    const existing = await this.listRewrites();
    const plans = this.planServiceRewrites(server, services, existing);

    return Promise.all(
      plans.map(async (plan: ServiceRewritePlan): Promise<DnsRewriteSyncResult> => {
        try {
          await this.applyPlan(plan);
          return {
            ...plan,
          };
        } finally {
          onProgress?.({
            ...plan,
          });
        }
      }),
    );
  }

  private async listRewrites(): Promise<AdGuardRewriteEntry[]> {
    try {
      return await this.client.get("rewrite/list").json<AdGuardRewriteEntry[]>();
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
  ): ServiceRewritePlan[] {
    const rewritesByDomain = new Map<string, AdGuardRewriteEntry[]>();

    for (const rewrite of existing) {
      const domainRewrites = rewritesByDomain.get(rewrite.domain) ?? [];
      domainRewrites.push(rewrite);
      rewritesByDomain.set(rewrite.domain, domainRewrites);
    }

    return services.map((service: ServiceEntry): ServiceRewritePlan => {
      const domain = service.domain;
      const desiredAnswer = server.ip;
      const currentRewrites = rewritesByDomain.get(domain) ?? [];
      const currentAnswers = currentRewrites.map((rewrite: AdGuardRewriteEntry) => rewrite.answer);
      const action = this.determineAction(currentAnswers, desiredAnswer);

      return {
        service,
        server,
        domain,
        desiredAnswer,
        currentAnswers,
        action,
      };
    });
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
      if (plan.action === "update") {
        await Promise.all(
          plan.currentAnswers.map((answer: string) =>
            this.client.post("rewrite/delete", {
              json: {
                domain: plan.domain,
                answer,
              },
            }),
          ),
        );
      }

      await this.client.post("rewrite/add", {
        json: {
          domain: plan.domain,
          answer: plan.desiredAnswer,
        },
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
}
