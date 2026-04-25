import type {
  CloudflareTunnelsConfig,
  ServerEntry,
  ServiceEntry,
} from "../../config/types.ts";
import type { ManagedCloudflareTunnelServerState } from "../../lockfile/types.ts";
import type { CloudflareTunnelService } from "./cloudflare-tunnel-service.ts";

export type CloudflareTunnelSyncAction = "create" | "delete" | "update" | "unchanged";

export interface CloudflareTunnelIngressRule {
  hostname?: string;
  path?: string;
  service: string;
  originRequest?: Record<string, unknown>;
}

export interface CloudflareTunnelIngressSyncResult {
  action: CloudflareTunnelSyncAction;
  hostname: string;
  desiredService: string;
  currentService?: string;
  service?: ServiceEntry;
  serviceId: string;
  server: ServerEntry;
}

export interface CloudflarePublicDnsSyncResult {
  action: CloudflareTunnelSyncAction;
  hostname: string;
  desiredTunnelId: string;
  currentTunnelId?: string;
  recordId?: string;
  service?: ServiceEntry;
  serviceId: string;
  server: ServerEntry;
}

export interface CloudflareTunnelSyncResult {
  ingress: CloudflareTunnelIngressSyncResult[];
  publicDns: CloudflarePublicDnsSyncResult[];
  publicDnsEnabled: boolean;
  lockState: ManagedCloudflareTunnelServerState;
}

export type CloudflareTunnelServiceFactory = (
  config: CloudflareTunnelsConfig,
  server: ServerEntry,
  servers: ServerEntry[],
) => CloudflareTunnelService;
