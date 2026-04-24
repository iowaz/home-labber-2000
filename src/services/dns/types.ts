import type { DnsConfig, ServerEntry, ServiceEntry } from "../../config/types.ts";
import type { AdGuardHomeDnsService } from "./adguard-home-dns-service.ts";

export interface AdGuardRewriteEntry {
  domain: string;
  answer: string;
  enabled?: boolean;
}

export type DnsRewriteAction = "create" | "update" | "unchanged";

export interface DnsRewritePlan {
  domain: string;
  desiredAnswer: string;
  currentAnswers: string[];
  action: DnsRewriteAction;
}

export interface DnsRewriteSyncResult extends DnsRewritePlan {
  service: ServiceEntry;
  server: ServerEntry;
}

export type DnsSyncProgressHandler = (result: DnsRewriteSyncResult) => void;

export type DnsServiceFactory = (config: DnsConfig) => AdGuardHomeDnsService;
