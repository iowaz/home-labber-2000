import type {
  CloudflareTunnelsConfig,
  ServerEntry,
  ServiceEntry,
} from "../../config/types.ts";
import type { ManagedCloudflareTunnelServerState } from "../../lockfile/types.ts";
import type { HttpTraceLogger } from "../http-trace.ts";
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

export type CloudflareTunnelSyncProgress =
  | {
      scope: "ingress";
      result: CloudflareTunnelIngressSyncResult;
    }
  | {
      scope: "publicDns";
      result: CloudflarePublicDnsSyncResult;
    };

export type CloudflareTunnelSyncProgressHandler = (
  progress: CloudflareTunnelSyncProgress,
) => Promise<void> | void;

export type CloudflareTunnelServiceFactory = (
  config: CloudflareTunnelsConfig,
  server: ServerEntry,
  servers: ServerEntry[],
  httpTraceLogger?: HttpTraceLogger,
) => CloudflareTunnelService;
