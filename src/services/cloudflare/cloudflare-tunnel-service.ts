import ky, { HTTPError, type Options } from "ky";

import type {
  CloudflareTunnelsConfig,
  ServerEntry,
  ServiceEntry,
} from "../../config/types.ts";
import type {
  ManagedCloudflareIngressState,
  ManagedCloudflarePublicDnsState,
  ManagedCloudflareTunnelServerState,
} from "../../lockfile/types.ts";
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

interface CloudflareDnsRecord {
  id?: string;
  name?: string;
  type?: string;
  content?: string;
  proxied?: boolean;
  comment?: string | null;
}

interface CloudflareZone {
  id?: string;
  name?: string;
}

interface SyncIngressRulesResult {
  lockState: ManagedCloudflareTunnelServerState["ingress"];
  results: CloudflareTunnelIngressSyncResult[];
}

interface SyncPublicDnsRoutesResult {
  lockState: ManagedCloudflareTunnelServerState["publicDns"];
  results: CloudflarePublicDnsSyncResult[];
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
  private readonly zoneIdsByName: Map<string, string>;

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
    this.zoneIdsByName = new Map<string, string>();
    this.client = ky.create({
      prefix: "https://api.cloudflare.com/client/v4/",
      retry: 0,
      timeout: 20_000,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
    });
  }

  public buildManagedState(
    services: ServiceEntry[],
    previousState?: ManagedCloudflareTunnelServerState,
  ): ManagedCloudflareTunnelServerState {
    const ingress = Object.fromEntries(
      this.sortServices(services).map((service: ServiceEntry) => [
        service.id,
        this.buildManagedIngressState(service),
      ]),
    );

    const publicDns = this.config.options.sync_public_dns
      ? Object.fromEntries(
          this.sortServices(services).map((service: ServiceEntry) => {
            const previousRecord = previousState?.publicDns[service.id];
            const hostname = this.getCloudflareHostname(service);

            return [
              service.id,
              {
                hostname,
                tunnelId: this.tunnelId,
                zoneId: previousRecord?.hostname === hostname ? previousRecord.zoneId : undefined,
                recordId: previousRecord?.hostname === hostname ? previousRecord.recordId : undefined,
              },
            ];
          }),
        )
      : { ...(previousState?.publicDns ?? {}) };

    return {
      tunnelId: this.tunnelId,
      ingress,
      publicDns,
    };
  }

  public async syncPublishedApplications(
    services: ServiceEntry[],
    previousState?: ManagedCloudflareTunnelServerState,
  ): Promise<CloudflareTunnelSyncResult> {
    const ingressResult = await this.syncIngressRules(services, previousState?.ingress ?? {});
    const publicDnsResult = this.config.options.sync_public_dns
      ? await this.syncPublicDnsRecords(services, previousState?.publicDns ?? {})
      : {
          lockState: { ...(previousState?.publicDns ?? {}) },
          results: [],
        };

    return {
      ingress: ingressResult.results,
      publicDns: publicDnsResult.results,
      publicDnsEnabled: this.config.options.sync_public_dns,
      lockState: {
        tunnelId: this.tunnelId,
        ingress: ingressResult.lockState,
        publicDns: publicDnsResult.lockState,
      },
    };
  }

  private async syncIngressRules(
    services: ServiceEntry[],
    previousManagedIngress: ManagedCloudflareTunnelServerState["ingress"],
  ): Promise<SyncIngressRulesResult> {
    const existingIngress = await this.listIngressRules();
    const desiredEntries = this.sortServices(services).map((service: ServiceEntry) => {
      const desiredState = this.buildManagedIngressState(service);
      const currentRule = existingIngress.find(
        (rule: CloudflareTunnelIngressRule) => rule.hostname === desiredState.hostname,
      );

      return {
        service,
        currentRule,
        desiredState,
        desiredRule: this.buildIngressRule(desiredState, currentRule),
      };
    });

    const results: CloudflareTunnelIngressSyncResult[] = desiredEntries.map((entry) => ({
      action: this.determineIngressAction(entry.currentRule, entry.desiredRule),
      hostname: entry.desiredState.hostname,
      desiredService: entry.desiredState.service,
      currentService: entry.currentRule?.service,
      service: entry.service,
      serviceId: entry.service.id,
      server: this.server,
    }));

    const currentHostnamesByServiceId = new Map<string, string>(
      desiredEntries.map((entry): [string, string] => [entry.service.id, entry.desiredState.hostname]),
    );
    const desiredHostnames = new Set<string>(desiredEntries.map((entry) => entry.desiredState.hostname));
    const desiredServiceUrlsByServiceId = new Map<string, string>(
      desiredEntries.map((entry): [string, string] => [entry.service.id, entry.desiredState.service]),
    );
    const removedManagedEntries = Object.entries(previousManagedIngress)
      .filter(([serviceId, ingressState]) => currentHostnamesByServiceId.get(serviceId) !== ingressState.hostname)
      .sort(([left], [right]) => left.localeCompare(right));

    for (const [serviceId, ingressState] of removedManagedEntries) {
      const currentRule = existingIngress.find(
        (rule: CloudflareTunnelIngressRule) => rule.hostname === ingressState.hostname,
      );

      results.push({
        action: "delete",
        hostname: ingressState.hostname,
        desiredService: "",
        currentService: currentRule?.service ?? ingressState.service,
        serviceId,
        server: this.server,
      });
    }

    const duplicateRemoteEntries = desiredEntries.flatMap((entry) =>
      existingIngress
        .filter(
          (rule: CloudflareTunnelIngressRule) =>
            rule.hostname &&
            rule.hostname !== entry.desiredState.hostname &&
            !desiredHostnames.has(rule.hostname) &&
            rule.service === entry.desiredState.service,
        )
        .map((rule: CloudflareTunnelIngressRule): CloudflareTunnelIngressSyncResult => ({
          action: "delete",
          hostname: rule.hostname as string,
          desiredService: "",
          currentService: rule.service,
          service: entry.service,
          serviceId: entry.service.id,
          server: this.server,
        })),
    );

    for (const duplicateEntry of duplicateRemoteEntries) {
      if (
        !results.some(
          (result: CloudflareTunnelIngressSyncResult) =>
            result.action === "delete" && result.hostname === duplicateEntry.hostname,
        )
      ) {
        results.push(duplicateEntry);
      }
    }

    const nextIngress = this.buildNextIngress(
      existingIngress,
      desiredEntries.map((entry) => entry.desiredRule),
      new Set<string>(
        Object.values(previousManagedIngress).map(
          (ingressState: ManagedCloudflareIngressState) => ingressState.hostname,
        ),
      ),
      new Set<string>([...desiredServiceUrlsByServiceId.values()]),
    );
    const currentSerialized = existingIngress.map(serializeIngressRule);
    const nextSerialized = nextIngress.map(serializeIngressRule);

    if (!this.arraysEqual(currentSerialized, nextSerialized)) {
      await this.updateIngressRules(nextIngress);
    }

    return {
      lockState: Object.fromEntries(
        desiredEntries.map((entry) => [entry.service.id, entry.desiredState]),
      ),
      results,
    };
  }

  private async syncPublicDnsRecords(
    services: ServiceEntry[],
    previousManagedPublicDns: ManagedCloudflareTunnelServerState["publicDns"],
  ): Promise<SyncPublicDnsRoutesResult> {
    const results: CloudflarePublicDnsSyncResult[] = [];
    const lockStateEntries: Array<[string, ManagedCloudflarePublicDnsState]> = [];
    const desiredHostnamesByServiceId = new Map<string, string>();

    for (const service of this.sortServices(services)) {
      const hostname = this.getCloudflareHostname(service);
      const zone = await this.resolveZone(hostname);
      const currentRecords = await this.listDnsRecords(zone.id, hostname);
      const currentRecord = currentRecords[0];
      const action = this.determineDnsRecordAction(currentRecord);
      let nextRecord = currentRecord;

      if (action === "create") {
        nextRecord = await this.createDnsRecord(zone.id, hostname, service.id);
      } else if (action === "update" && currentRecord?.id) {
        nextRecord = await this.updateDnsRecord(zone.id, currentRecord.id, hostname, service.id);
      }

      if (currentRecords.length > 1) {
        for (const duplicateRecord of currentRecords.slice(1)) {
          if (duplicateRecord.id) {
            await this.deleteDnsRecord(zone.id, duplicateRecord.id);
          }
        }
      }

      desiredHostnamesByServiceId.set(service.id, hostname);
      results.push({
        action,
        hostname,
        desiredTunnelId: this.tunnelId,
        currentTunnelId: this.extractTunnelIdFromRecord(currentRecord),
        recordId: nextRecord?.id,
        service,
        serviceId: service.id,
        server: this.server,
      });
      lockStateEntries.push([
        service.id,
        {
          hostname,
          tunnelId: this.tunnelId,
          zoneId: zone.id,
          recordId: nextRecord?.id,
        },
      ]);
    }

    const removedManagedEntries = Object.entries(previousManagedPublicDns)
      .filter(([serviceId, recordState]) => desiredHostnamesByServiceId.get(serviceId) !== recordState.hostname)
      .sort(([left], [right]) => left.localeCompare(right));

    for (const [serviceId, recordState] of removedManagedEntries) {
      const deletedRecordIds = await this.deleteManagedDnsRecords(recordState);
      results.push({
        action: "delete",
        hostname: recordState.hostname,
        desiredTunnelId: this.tunnelId,
        currentTunnelId: recordState.tunnelId,
        recordId: deletedRecordIds[0],
        serviceId,
        server: this.server,
      });
    }

    return {
      lockState: Object.fromEntries(lockStateEntries),
      results,
    };
  }

  private async listIngressRules(): Promise<CloudflareTunnelIngressRule[]> {
    const response = await this.request<CloudflareTunnelConfigurationResponse>(
      `accounts/${this.accountId}/cfd_tunnel/${this.tunnelId}/configurations`,
    );

    return response.config?.ingress ?? [];
  }

  private async updateIngressRules(ingress: CloudflareTunnelIngressRule[]): Promise<void> {
    await this.request<CloudflareTunnelConfigurationResponse>(
      `accounts/${this.accountId}/cfd_tunnel/${this.tunnelId}/configurations`,
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

  private async resolveZone(hostname: string): Promise<{ id: string; name: string }> {
    const labels = hostname.split(".");

    for (let index = 0; index < labels.length - 1; index += 1) {
      const candidateZoneName = labels.slice(index).join(".");
      const cachedZoneId = this.zoneIdsByName.get(candidateZoneName);
      if (cachedZoneId) {
        return {
          id: cachedZoneId,
          name: candidateZoneName,
        };
      }

      const zones = await this.request<CloudflareZone[]>("zones", {
        searchParams: {
          "account.id": this.accountId,
          match: "all",
          name: candidateZoneName,
          per_page: "1",
        },
      });
      const zone = zones.find((entry: CloudflareZone) => entry.name === candidateZoneName && entry.id);
      if (zone?.id) {
        this.zoneIdsByName.set(candidateZoneName, zone.id);
        return {
          id: zone.id,
          name: candidateZoneName,
        };
      }
    }

    throw new Error(`Unable to resolve a Cloudflare zone for hostname '${hostname}'.`);
  }

  private async listDnsRecords(zoneId: string, hostname: string): Promise<CloudflareDnsRecord[]> {
    const response = await this.request<CloudflareDnsRecord[]>(
      `zones/${zoneId}/dns_records`,
      {
        searchParams: {
          name: hostname,
          per_page: "100",
          type: "CNAME",
        },
      },
    );

    return response.filter(
      (record: CloudflareDnsRecord) => record.type === "CNAME" && record.name === hostname,
    );
  }

  private async createDnsRecord(
    zoneId: string,
    hostname: string,
    serviceId: string,
  ): Promise<CloudflareDnsRecord> {
    return await this.request<CloudflareDnsRecord>(`zones/${zoneId}/dns_records`, {
      method: "POST",
      json: {
        comment: this.buildDnsRecordComment(serviceId),
        content: this.buildTunnelDnsTarget(),
        name: hostname,
        proxied: true,
        ttl: 1,
        type: "CNAME",
      },
    });
  }

  private async updateDnsRecord(
    zoneId: string,
    recordId: string,
    hostname: string,
    serviceId: string,
  ): Promise<CloudflareDnsRecord> {
    return await this.request<CloudflareDnsRecord>(`zones/${zoneId}/dns_records/${recordId}`, {
      method: "PUT",
      json: {
        comment: this.buildDnsRecordComment(serviceId),
        content: this.buildTunnelDnsTarget(),
        name: hostname,
        proxied: true,
        ttl: 1,
        type: "CNAME",
      },
    });
  }

  private async deleteDnsRecord(zoneId: string, recordId: string): Promise<void> {
    await this.request<CloudflareDnsRecord>(`zones/${zoneId}/dns_records/${recordId}`, {
      method: "DELETE",
    });
  }

  private async deleteManagedDnsRecords(
    recordState: ManagedCloudflarePublicDnsState,
  ): Promise<string[]> {
    const zoneId = recordState.zoneId ?? (await this.resolveZone(recordState.hostname)).id;

    if (recordState.recordId) {
      await this.deleteDnsRecord(zoneId, recordState.recordId);
      return [recordState.recordId];
    }

    const records = await this.listDnsRecords(zoneId, recordState.hostname);
    const matchingRecords = records.filter(
      (record: CloudflareDnsRecord) =>
        record.id &&
        record.name === recordState.hostname &&
        record.content === `${recordState.tunnelId}.cfargotunnel.com`,
    );

    for (const record of matchingRecords) {
      await this.deleteDnsRecord(zoneId, record.id as string);
    }

    return matchingRecords.map((record: CloudflareDnsRecord) => record.id as string);
  }

  private buildNextIngress(
    existingIngress: CloudflareTunnelIngressRule[],
    desiredIngress: CloudflareTunnelIngressRule[],
    managedHostnames: Set<string>,
    desiredManagedServices: Set<string>,
  ): CloudflareTunnelIngressRule[] {
    const desiredByHostname = new Map<string, CloudflareTunnelIngressRule>();

    for (const rule of desiredIngress) {
      if (rule.hostname) {
        desiredByHostname.set(rule.hostname, rule);
      }
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

      if (managedHostnames.has(rule.hostname)) {
        continue;
      }

      if (desiredManagedServices.has(rule.service)) {
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

  private buildManagedIngressState(service: ServiceEntry): ManagedCloudflareIngressState {
    return {
      hostname: this.getCloudflareHostname(service),
      path: normalizePath(service.publish["cloudflare-tunnel"]?.path),
      service: this.buildOriginServiceUrl(service),
    };
  }

  private buildIngressRule(
    state: ManagedCloudflareIngressState,
    existingRule?: CloudflareTunnelIngressRule,
  ): CloudflareTunnelIngressRule {
    return {
      hostname: state.hostname,
      path: state.path,
      service: state.service,
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

  private determineDnsRecordAction(
    currentRecord: CloudflareDnsRecord | undefined,
  ): CloudflareTunnelSyncAction {
    if (!currentRecord) {
      return "create";
    }

    const desiredTarget = this.buildTunnelDnsTarget();
    const currentTunnelId = this.extractTunnelIdFromRecord(currentRecord);
    return currentRecord.content === desiredTarget && currentRecord.proxied === true && currentTunnelId === this.tunnelId
      ? "unchanged"
      : "update";
  }

  private buildTunnelDnsTarget(): string {
    return `${this.tunnelId}.cfargotunnel.com`;
  }

  private extractTunnelIdFromRecord(record: CloudflareDnsRecord | undefined): string | undefined {
    const content = record?.content;
    if (!content || !content.endsWith(".cfargotunnel.com")) {
      return undefined;
    }

    return content.slice(0, -".cfargotunnel.com".length);
  }

  private buildDnsRecordComment(serviceId: string): string {
    return `Managed by home-lab-machine-syncer (${serviceId})`;
  }

  private sortServices(services: ServiceEntry[]): ServiceEntry[] {
    return services
      .slice()
      .sort((left: ServiceEntry, right: ServiceEntry) => left.id.localeCompare(right.id));
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
      const requestUrl = error.request.url;
      if (error.response.status === 403 && requestUrl.includes("/dns_records")) {
        return [
          "Cloudflare DNS API request was forbidden.",
          "cloudflare-tunnels.options.sync_public_dns requires a token with Cloudflare DNS permissions",
          "(at minimum DNS Read/DNS Write for the target zone).",
          `Request: ${error.request.method} ${requestUrl}`,
        ].join(" ");
      }

      if (error.response.status === 403 && requestUrl.includes("/zones")) {
        return [
          "Cloudflare zone lookup was forbidden.",
          "Resolving public DNS zones requires a token with Zone Read permission.",
          `Request: ${error.request.method} ${requestUrl}`,
        ].join(" ");
      }

      return `Cloudflare API request failed: ${error.message}`;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
