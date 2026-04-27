import type { DnsConfig, ServerEntry, ServiceEntry } from "../../config/types.ts";
import type { ManagedDnsServerState } from "../../lockfile/types.ts";
import type { HttpTraceLogger } from "../http-trace.ts";
import type { AdGuardHomeDnsService } from "./adguard-home-dns-service.ts";

export interface AdGuardRewriteEntry {
  domain: string;
  answer: string;
  enabled?: boolean;
}

export type DnsRewriteAction = "create" | "delete" | "update" | "unchanged";

export interface DnsRewritePlan {
  domain: string;
  desiredAnswer: string;
  currentAnswers: string[];
  action: DnsRewriteAction;
}

export interface DnsRewriteSyncResult extends DnsRewritePlan {
  service?: ServiceEntry;
  serviceId: string;
  server: ServerEntry;
}

export interface DnsSyncResult {
  lockState: ManagedDnsServerState;
  results: DnsRewriteSyncResult[];
}

export type DnsSyncProgressHandler = (
  result: DnsRewriteSyncResult,
) => Promise<void> | void;

export type DnsServiceFactory = (
  config: DnsConfig,
  httpTraceLogger?: HttpTraceLogger,
) => AdGuardHomeDnsService;
