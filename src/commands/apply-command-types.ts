import Emittery from "emittery";

import type { HomelabConfig, ServerEntry, ServiceEntry } from "../config/types.ts";
import type { CaddyApplyResult } from "../services/caddy/types.ts";
import type { CloudflareTunnelSyncResult } from "../services/cloudflare/types.ts";
import type { DnsRewriteSyncResult } from "../services/dns/types.ts";

export interface ApplyOptions {
  config: string;
  dryRun?: boolean;
  lockfile: string;
  recreateLockfile?: boolean;
  server?: string;
  slowRunning?: boolean;
}

export interface ApplyTarget {
  server: ServerEntry;
  services: ServiceEntry[];
}

export interface ApplyConfigLoadStartEvent {
  configDirectory: string;
}

export interface ApplyConfigLoadedEvent {
  config: HomelabConfig;
  configDirectory: string;
}

export interface ApplyTargetsResolvedEvent {
  targets: ApplyTarget[];
}

export interface ApplyTargetEvent {
  target: ApplyTarget;
}

export interface ApplyTargetSkippedEvent extends ApplyTargetEvent {
  reason: string;
}

export interface ApplyCaddyDryRunEvent extends ApplyTargetEvent {
  loadUrl: string;
}

export interface ApplyCaddySyncSuccessEvent extends ApplyTargetEvent {
  response: CaddyApplyResult;
}

export interface ApplyDnsSyncSuccessEvent extends ApplyTargetEvent {
  results: DnsRewriteSyncResult[];
}

export interface ApplyCloudflareDryRunEvent extends ApplyTargetEvent {
  publicDnsEnabled: boolean;
}

export interface ApplyCloudflareSyncSuccessEvent extends ApplyTargetEvent {
  result: CloudflareTunnelSyncResult;
}

export interface ApplyTargetErrorEvent extends ApplyTargetEvent {
  error: unknown;
}

export interface ApplyCompletedEvent {
  processedTargets: number;
  dryRun: boolean;
}

export const APPLY_COMMAND_EVENTS = {
  configLoadStart: "config-load-start",
  configLoaded: "config-loaded",
  targetsResolved: "targets-resolved",
  caddySyncStart: "caddy-sync-start",
  caddyDryRun: "caddy-dry-run",
  caddySyncSkipped: "caddy-sync-skipped",
  caddySyncSuccess: "caddy-sync-success",
  caddySyncFailed: "caddy-sync-failed",
  cloudflareSyncStart: "cloudflare-sync-start",
  cloudflareDryRun: "cloudflare-dry-run",
  cloudflareSyncSkipped: "cloudflare-sync-skipped",
  cloudflareSyncSuccess: "cloudflare-sync-success",
  cloudflareSyncFailed: "cloudflare-sync-failed",
  dnsSyncStart: "dns-sync-start",
  dnsDryRun: "dns-dry-run",
  dnsSyncSkipped: "dns-sync-skipped",
  dnsSyncSuccess: "dns-sync-success",
  dnsSyncFailed: "dns-sync-failed",
  completed: "completed",
} as const;

export interface ApplyCommandEvents {
  [APPLY_COMMAND_EVENTS.configLoadStart]: ApplyConfigLoadStartEvent;
  [APPLY_COMMAND_EVENTS.configLoaded]: ApplyConfigLoadedEvent;
  [APPLY_COMMAND_EVENTS.targetsResolved]: ApplyTargetsResolvedEvent;
  [APPLY_COMMAND_EVENTS.caddySyncStart]: ApplyTargetEvent;
  [APPLY_COMMAND_EVENTS.caddyDryRun]: ApplyCaddyDryRunEvent;
  [APPLY_COMMAND_EVENTS.caddySyncSkipped]: ApplyTargetSkippedEvent;
  [APPLY_COMMAND_EVENTS.caddySyncSuccess]: ApplyCaddySyncSuccessEvent;
  [APPLY_COMMAND_EVENTS.caddySyncFailed]: ApplyTargetErrorEvent;
  [APPLY_COMMAND_EVENTS.cloudflareSyncStart]: ApplyTargetEvent;
  [APPLY_COMMAND_EVENTS.cloudflareDryRun]: ApplyCloudflareDryRunEvent;
  [APPLY_COMMAND_EVENTS.cloudflareSyncSkipped]: ApplyTargetSkippedEvent;
  [APPLY_COMMAND_EVENTS.cloudflareSyncSuccess]: ApplyCloudflareSyncSuccessEvent;
  [APPLY_COMMAND_EVENTS.cloudflareSyncFailed]: ApplyTargetErrorEvent;
  [APPLY_COMMAND_EVENTS.dnsSyncStart]: ApplyTargetEvent;
  [APPLY_COMMAND_EVENTS.dnsDryRun]: ApplyTargetEvent;
  [APPLY_COMMAND_EVENTS.dnsSyncSkipped]: ApplyTargetSkippedEvent;
  [APPLY_COMMAND_EVENTS.dnsSyncSuccess]: ApplyDnsSyncSuccessEvent;
  [APPLY_COMMAND_EVENTS.dnsSyncFailed]: ApplyTargetErrorEvent;
  [APPLY_COMMAND_EVENTS.completed]: ApplyCompletedEvent;
}

export type ApplyCommandEventBus = Emittery<ApplyCommandEvents>;

export function createApplyCommandEventBus(): ApplyCommandEventBus {
  return new Emittery<ApplyCommandEvents>();
}
