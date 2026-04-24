import ky, { HTTPError, type Options } from "ky";

import type {
  CloudflareTunnelsConfig,
  ServerEntry,
  ServiceEntry,
} from "../../config/types.ts";
import type {
  CloudflarePublicDnsSyncResult,
  CloudflareTunnelIngressRule,
  CloudflareTunnelIngressSyncResult,
  CloudflareTunnelSyncAction,
  CloudflareTunnelSyncResult,
} from "./types.ts";

interface CloudflareApiEnvelope<T> {
  success: boolean;
  errors?: Array<{
    message?: string;
  }>;
  result: T;
}

interface CloudflareTunnelConfigurationResponse {
  config?: {
    ingress?: CloudflareTunnelIngressRule[];
  };
}

interface CloudflareHostnameRoute {
  id?: string;
  hostname?: string;
  tunnel_id?: string;
  deleted_at?: string | null;
}

function normalizePath(path: string | undefined): string | undefined {
  if (!path || path === "*") {
    return undefined;
  }

  return path;
}

function normalizeIngressRule(
  rule: CloudflareTunnelIngressRule,
): CloudflareTunnelIngressRule {
  return {
    hostname: rule.hostname,
    path: normalizePath(rule.path),
    service: rule.service,
    originRequest: rule.originRequest,
  };
}

function serializeIngressRule(rule: CloudflareTunnelIngressRule): string {
  const normalized = normalizeIngressRule(rule);
  return JSON.stringify({
    hostname: normalized.hostname ?? null,
    path: normalized.path ?? null,
    service: normalized.service,
    originRequest: normalized.originRequest ?? null,
  });
}

function hasCloudflareTunnel(
  server: ServerEntry,
): server is ServerEntry & { "cloudflare-tunnel": { tunnel_id?: string } } {
  return typeof server["cloudflare-tunnel"] === "object" && server["cloudflare-tunnel"] !== null;
}

export class CloudflareTunnelService {
  private readonly config: CloudflareTunnelsConfig;
  private readonly server: ServerEntry & { "cloudflare-tunnel": { tunnel_id: string } };
  private readonly serversById: Map<string, ServerEntry>;
  private readonly client: typeof ky;
  private readonly accountId: string;
  private readonly tunnelId: string;

  public constructor(config: CloudflareTunnelsConfig, server: ServerEntry, servers: ServerEntry[]) {
    if (!hasCloudflareTunnel(server)) {
      throw new Error(`Server '${server.id}' does not define cloudflare-tunnel config.`);
    }

    if (!config.account_id) {
      throw new Error(
        "cloudflare-tunnels.account_id must be configured before applying Cloudflare Tunnel changes.",
      );
    }

    if (!server["cloudflare-tunnel"].tunnel_id) {
      throw new Error(
        `Server '${server.id}' must define cloudflare-tunnel.tunnel_id before applying Cloudflare Tunnel changes.`,
      );
    }

    const apiToken = process.env[config.auth.api_token_env];
    if (!apiToken) {
      throw new Error(
        `Missing environment variable '${config.auth.api_token_env}' for Cloudflare API token.`,
      );
    }

    this.config = config;
    this.server = {
      ...server,
      "cloudflare-tunnel": {
        tunnel_id: server["cloudflare-tunnel"].tunnel_id,
      },
    };
    this.serversById = new Map(
      servers.map((entry: ServerEntry): [string, ServerEntry] => [entry.id, entry]),
    );
    this.accountId = config.account_id;
    this.tunnelId = server["cloudflare-tunnel"].tunnel_id;
    this.client = ky.create({
      prefix: `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/`,
      retry: 0,
      timeout: 20_000,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
    });
  }

  public async syncPublishedApplications(services: ServiceEntry[]): Promise<CloudflareTunnelSyncResult> {
    const ingressResults = await this.syncIngressRules(services);
    const publicDnsResults = this.config.options.sync_public_dns
      ? await this.syncPublicDnsRoutes(services)
      : [];

    return {
      ingress: ingressResults,
      publicDns: publicDnsResults,
      publicDnsEnabled: this.config.options.sync_public_dns,
    };
  }

  private async syncIngressRules(
    services: ServiceEntry[],
  ): Promise<CloudflareTunnelIngressSyncResult[]> {
    const existingIngress = await this.listIngressRules();
    const plans = services
      .slice()
      .sort((left: ServiceEntry, right: ServiceEntry) =>
        this.getCloudflareHostname(left).localeCompare(this.getCloudflareHostname(right)),
      )
      .map((service: ServiceEntry): CloudflareTunnelIngressSyncResult => {
        const hostname = this.getCloudflareHostname(service);
        const currentRule = existingIngress.find(
          (rule: CloudflareTunnelIngressRule) => rule.hostname === hostname,
        );
        const desiredRule = this.buildIngressRule(service, currentRule);

        return {
          action: this.determineIngressAction(currentRule, desiredRule),
          hostname,
          desiredService: desiredRule.service,
          currentService: currentRule?.service,
          service,
          server: this.server,
        };
      });

    const nextIngress = this.buildNextIngress(existingIngress, services);
    const currentSerialized = existingIngress.map(serializeIngressRule);
    const nextSerialized = nextIngress.map(serializeIngressRule);

    if (!this.arraysEqual(currentSerialized, nextSerialized)) {
      await this.updateIngressRules(nextIngress);
    }

    return plans;
  }

  private async syncPublicDnsRoutes(
    services: ServiceEntry[],
  ): Promise<CloudflarePublicDnsSyncResult[]> {
    const results: CloudflarePublicDnsSyncResult[] = [];

    for (const service of services
      .slice()
      .sort((left: ServiceEntry, right: ServiceEntry) =>
        this.getCloudflareHostname(left).localeCompare(this.getCloudflareHostname(right)),
      )) {
      const hostname = this.getCloudflareHostname(service);
      const routes = await this.listHostnameRoutes(hostname);
      const currentRoute = routes.find((route: CloudflareHostnameRoute) => route.hostname === hostname);
      const action = this.determineHostnameRouteAction(currentRoute);

      if (action === "create") {
        await this.createHostnameRoute(hostname, service.id);
      } else if (action === "update" && currentRoute?.id) {
        await this.updateHostnameRoute(currentRoute.id, hostname, service.id);
      }

      results.push({
        action,
        hostname,
        desiredTunnelId: this.tunnelId,
        currentTunnelId: currentRoute?.tunnel_id,
        service,
        server: this.server,
      });
    }

    return results;
  }

  private async listIngressRules(): Promise<CloudflareTunnelIngressRule[]> {
    const response = await this.request<CloudflareTunnelConfigurationResponse>(
      `cfd_tunnel/${this.tunnelId}/configurations`,
    );

    return response.config?.ingress ?? [];
  }

  private async updateIngressRules(ingress: CloudflareTunnelIngressRule[]): Promise<void> {
    await this.request<CloudflareTunnelConfigurationResponse>(
      `cfd_tunnel/${this.tunnelId}/configurations`,
      {
        method: "PUT",
        json: {
          config: {
            ingress,
          },
        },
      },
    );
  }

  private async listHostnameRoutes(hostname: string): Promise<CloudflareHostnameRoute[]> {
    const response = await this.request<CloudflareHostnameRoute[]>(
      "zerotrust/routes/hostname",
      {
        searchParams: {
          hostname,
        },
      },
    );

    return response.filter(
      (route: CloudflareHostnameRoute) =>
        route.hostname === hostname && !route.deleted_at,
    );
  }

  private async createHostnameRoute(hostname: string, serviceId: string): Promise<void> {
    await this.request<CloudflareHostnameRoute>("zerotrust/routes/hostname", {
      method: "POST",
      json: {
        hostname,
        tunnel_id: this.tunnelId,
        comment: this.buildHostnameRouteComment(serviceId),
      },
    });
  }

  private async updateHostnameRoute(
    routeId: string,
    hostname: string,
    serviceId: string,
  ): Promise<void> {
    await this.request<CloudflareHostnameRoute>(`zerotrust/routes/hostname/${routeId}`, {
      method: "PATCH",
      json: {
        hostname,
        tunnel_id: this.tunnelId,
        comment: this.buildHostnameRouteComment(serviceId),
      },
    });
  }

  private buildNextIngress(
    existingIngress: CloudflareTunnelIngressRule[],
    services: ServiceEntry[],
  ): CloudflareTunnelIngressRule[] {
    const desiredByHostname = new Map<string, CloudflareTunnelIngressRule>();

    for (const service of services) {
      const hostname = this.getCloudflareHostname(service);
      const existingRule = existingIngress.find(
        (rule: CloudflareTunnelIngressRule) => rule.hostname === hostname,
      );
      desiredByHostname.set(hostname, this.buildIngressRule(service, existingRule));
    }

    const nextIngress: CloudflareTunnelIngressRule[] = [];
    const insertedHostnames = new Set<string>();
    let catchAllRule: CloudflareTunnelIngressRule | undefined;

    for (const rule of existingIngress) {
      if (!rule.hostname) {
        catchAllRule = catchAllRule ?? normalizeIngressRule(rule);
        continue;
      }

      const desiredRule = desiredByHostname.get(rule.hostname);
      if (desiredRule) {
        if (!insertedHostnames.has(rule.hostname)) {
          nextIngress.push(desiredRule);
          insertedHostnames.add(rule.hostname);
        }
        continue;
      }

      nextIngress.push(normalizeIngressRule(rule));
    }

    const remainingDesiredRules = [...desiredByHostname.entries()]
      .filter(([hostname]) => !insertedHostnames.has(hostname))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, rule]) => rule);

    nextIngress.push(...remainingDesiredRules);
    nextIngress.push(catchAllRule ?? { service: "http_status:404" });

    return nextIngress;
  }

  private buildIngressRule(
    service: ServiceEntry,
    existingRule?: CloudflareTunnelIngressRule,
  ): CloudflareTunnelIngressRule {
    return {
      hostname: this.getCloudflareHostname(service),
      path: normalizePath(service.publish["cloudflare-tunnel"]?.path),
      service: this.buildOriginServiceUrl(service),
      originRequest: existingRule?.originRequest,
    };
  }

  private buildOriginServiceUrl(service: ServiceEntry): string {
    const originServer = this.serversById.get(service.origin.server);
    if (!originServer) {
      throw new Error(`Service '${service.id}' references unknown origin server '${service.origin.server}'.`);
    }

    const publication = service.publish["cloudflare-tunnel"];
    if (!publication) {
      throw new Error(`Service '${service.id}' does not define publish.cloudflare-tunnel.`);
    }

    const host = publication.via === service.origin.server ? "localhost" : originServer.ip;
    return `http://${host}:${service.origin.port}`;
  }

  private getCloudflareHostname(service: ServiceEntry): string {
    const hostname = service.publish["cloudflare-tunnel"]?.hostname;
    if (!hostname) {
      throw new Error(`Service '${service.id}' does not define publish.cloudflare-tunnel.hostname.`);
    }

    return hostname;
  }

  private determineIngressAction(
    currentRule: CloudflareTunnelIngressRule | undefined,
    desiredRule: CloudflareTunnelIngressRule,
  ): CloudflareTunnelSyncAction {
    if (!currentRule) {
      return "create";
    }

    const currentComparable = JSON.stringify({
      hostname: currentRule.hostname ?? null,
      path: normalizePath(currentRule.path) ?? null,
      service: currentRule.service,
    });
    const desiredComparable = JSON.stringify({
      hostname: desiredRule.hostname ?? null,
      path: normalizePath(desiredRule.path) ?? null,
      service: desiredRule.service,
    });

    return currentComparable === desiredComparable ? "unchanged" : "update";
  }

  private determineHostnameRouteAction(
    currentRoute: CloudflareHostnameRoute | undefined,
  ): CloudflareTunnelSyncAction {
    if (!currentRoute) {
      return "create";
    }

    return currentRoute.tunnel_id === this.tunnelId ? "unchanged" : "update";
  }

  private buildHostnameRouteComment(serviceId: string): string {
    return `Managed by home-lab-machine-syncer (${serviceId})`;
  }

  private arraysEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((value: string, index: number) => value === right[index]);
  }

  private async request<T>(
    input: string,
    options?: Options,
  ): Promise<T> {
    try {
      const response = await this.client(input, options).json<CloudflareApiEnvelope<T>>();
      if (!response.success) {
        const message = response.errors?.map((error) => error.message).filter(Boolean).join(", ");
        throw new Error(message || "Cloudflare API returned an unsuccessful response.");
      }
      return response.result;
    } catch (error) {
      throw new Error(this.formatError(error));
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof HTTPError) {
      return `Cloudflare API request failed: ${error.message}`;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
