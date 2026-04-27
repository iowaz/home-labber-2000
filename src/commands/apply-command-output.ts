import chalk from "chalk";

import type { HomelabConfig, ServerEntry, ServiceEntry } from "../config/types.ts";
import type {
  CloudflarePublicDnsSyncResult,
  CloudflareTunnelIngressSyncResult,
  CloudflareTunnelSyncResult,
} from "../services/cloudflare/types.ts";
import type { DnsRewriteSyncResult } from "../services/dns/types.ts";
import type { HttpTraceExchange, HttpTraceOperation } from "../services/http-trace.ts";

export interface OperationProgressState {
  failed: number;
  operation: "cloudflare" | "dns";
  server: ServerEntry;
  successful: number;
  total: number;
}

type OperationLabel = "apply" | "caddy" | "cloudflare" | "cloudflareDns" | "config" | "dns";
type PhaseLabel = "caddy" | "cloudflare" | "dns";
type SyncAction = "create" | "delete" | "update" | "unchanged";

const serviceLabelLength = 18;
const progressBarWidth = 16;

export function buildServiceSummaryLines(config: HomelabConfig): string[] {
  const serversById = new Map<string, ServerEntry>(
    config.servers.map((server: ServerEntry): [string, ServerEntry] => [server.id, server]),
  );
  const servicesByOrigin = new Map<string, ServiceEntry[]>();

  for (const service of config.services) {
    const originServices = servicesByOrigin.get(service.origin.server) ?? [];
    originServices.push(service);
    servicesByOrigin.set(service.origin.server, originServices);
  }

  const lines: string[] = [];
  const originEntries = [...servicesByOrigin.entries()].sort(([leftId], [rightId]) =>
    leftId.localeCompare(rightId),
  );

  originEntries.forEach(([originServerId, services]) => {
    const originServer = serversById.get(originServerId);
    if (!originServer) {
      throw new Error(
        `Unknown origin server '${originServerId}' while building service summary.`,
      );
    }

    lines.push(buildOriginHeaderLine(originServer, services.length));

    const sortedServices = services
      .slice()
      .sort((left: ServiceEntry, right: ServiceEntry) => left.id.localeCompare(right.id));

    for (const service of sortedServices) {
      const caddyServer = service.publish.caddy
        ? serversById.get(service.publish.caddy.via)
        : undefined;
      const cloudflareServer = service.publish["cloudflare-tunnel"]
        ? serversById.get(service.publish["cloudflare-tunnel"].via)
        : undefined;

      lines.push(buildServiceDetailLine(service, caddyServer, cloudflareServer));
    }
  });

  return lines;
}

export function formatDnsResult(result: DnsRewriteSyncResult): string {
  const actionLabel = formatActionLabel(result.action);
  const currentAnswer =
    result.currentAnswers.length > 0 ? result.currentAnswers.join(", ") : "missing";
  const prefix = `${formatPhaseLabel("dns")} | ${formatServiceLabel(result.service, result.serviceId)} |`;

  if (result.action === "delete") {
    return `${prefix} ${result.domain} | ${actionLabel} | removing ${currentAnswer}`;
  }

  return `${prefix} ${result.domain} | ${actionLabel} | ${currentAnswer} -> ${result.desiredAnswer}`;
}

export function formatCloudflareIngressResult(
  result: CloudflareTunnelIngressSyncResult,
): string {
  const actionLabel = formatActionLabel(result.action);
  const currentService = result.currentService ?? "missing";
  const prefix = `${formatPhaseLabel("cloudflare")} | ${formatServiceLabel(result.service, result.serviceId)} |`;

  if (result.action === "delete") {
    return `${prefix} ${result.hostname} | ${actionLabel} | removing ${currentService}`;
  }

  return `${prefix} ${result.hostname} | ${actionLabel} | ${currentService} -> ${result.desiredService}`;
}

export function formatCloudflarePublicDnsResult(
  result: CloudflarePublicDnsSyncResult,
): string {
  const actionLabel = formatActionLabel(result.action);
  const currentTunnel = result.currentTunnelId ?? "missing";
  const prefix = `${formatOperationLabel("cloudflareDns")} | ${formatServiceLabel(result.service, result.serviceId)} |`;

  if (result.action === "delete") {
    return `${prefix} ${result.hostname} | ${actionLabel} | removing ${currentTunnel}`;
  }

  return `${prefix} ${result.hostname} | ${actionLabel} | ${currentTunnel} -> ${result.desiredTunnelId}`;
}

export function formatOperationLabel(operation: OperationLabel): string {
  if (operation === "apply") {
    return chalk.green("Apply");
  }

  if (operation === "config") {
    return chalk.cyan("Config");
  }

  if (operation === "cloudflareDns") {
    return chalk.yellow("Cloudflare DNS");
  }

  return formatPhaseLabel(operation);
}

export function formatPhaseLabel(phase: PhaseLabel): string {
  if (phase === "caddy") {
    return chalk.blue("Caddy");
  }

  if (phase === "cloudflare") {
    return chalk.yellow("Cloudflare");
  }

  return chalk.magenta("AdGuard DNS");
}

export function formatServerLabel(server: ServerEntry): string {
  return `${chalk.blue(server.id)} ${chalk.gray(`(${server.description})`)}`;
}

export function createProgressState(
  operation: "cloudflare" | "dns",
  server: ServerEntry,
  total: number,
): OperationProgressState {
  return {
    failed: 0,
    operation,
    server,
    successful: 0,
    total: Math.max(total, 1),
  };
}

export function buildProgressLine(progress: OperationProgressState, label: string): string {
  const total = Math.max(progress.total, progress.successful + progress.failed);

  if (total !== progress.total) {
    progress.total = total;
  }

  return [
    formatPhaseLabel(progress.operation),
    formatServerLabel(progress.server),
    `${label} ${formatProgressBar(progress)}`,
  ].join(" | ");
}

export function buildCaddyIntentLine(server: ServerEntry, services: ServiceEntry[]): string {
  return `${formatPhaseLabel("caddy")} | ${formatServerLabel(server)} | syncing ${services.length} route(s)`;
}

export function buildDnsIntentLine(server: ServerEntry, services: ServiceEntry[]): string {
  return `${formatPhaseLabel("dns")} | ${formatServerLabel(server)} | checking ${services.length} domain rewrite(s)`;
}

export function buildCloudflareIntentLine(server: ServerEntry, services: ServiceEntry[]): string {
  return `${formatPhaseLabel("cloudflare")} | ${formatServerLabel(server)} | syncing ${services.length} published application(s)`;
}

export function buildCaddyResultLine(
  server: ServerEntry,
  services: ServiceEntry[],
  transport: "ky" | "native",
): string {
  const transportLabel = transport === "native" ? "native fallback" : "ky";
  return `${formatPhaseLabel("caddy")} | ${formatServerLabel(server)} | ${chalk.green(`${services.length} routes applied`)} via ${transportLabel}`;
}

export function buildDnsResultLine(
  server: ServerEntry,
  results: DnsRewriteSyncResult[],
): string {
  return `${formatPhaseLabel("dns")} | ${formatServerLabel(server)} | ${summarizeDnsResults(results)}`;
}

export function buildCloudflareResultLine(
  server: ServerEntry,
  result: CloudflareTunnelSyncResult,
): string {
  const ingressSummary = summarizeCloudflareActions(result.ingress);
  const dnsSummary = result.publicDnsEnabled
    ? summarizeCloudflareActions(result.publicDns)
    : chalk.gray("public DNS disabled");

  return `${formatPhaseLabel("cloudflare")} | ${formatServerLabel(server)} | ingress ${ingressSummary} | dns ${dnsSummary}`;
}

export function buildCaddyDryRunResultLine(
  server: ServerEntry,
  services: ServiceEntry[],
): string {
  return `${formatPhaseLabel("caddy")} | ${formatServerLabel(server)} | ${chalk.green(`${services.length} routes prepared`)} (dry run)`;
}

export function buildDnsDryRunResultLine(server: ServerEntry): string {
  return `${formatPhaseLabel("dns")} | ${formatServerLabel(server)} | ${chalk.gray("skipped (dry run)")}`;
}

export function buildCloudflareDryRunResultLine(
  server: ServerEntry,
  services: ServiceEntry[],
  publicDnsEnabled: boolean,
): string {
  const dnsLabel = publicDnsEnabled ? "public DNS planned" : "public DNS disabled";
  return `${formatPhaseLabel("cloudflare")} | ${formatServerLabel(server)} | ${chalk.green(`${services.length} routes prepared`)} (${dnsLabel}, dry run)`;
}

export function buildSkippedResultLine(
  phase: PhaseLabel,
  server: ServerEntry,
  reason: string,
): string {
  return `${formatPhaseLabel(phase)} | ${formatServerLabel(server)} | ${chalk.gray(`skipped (${reason})`)}`;
}

export function buildHttpTraceLines(exchange: HttpTraceExchange): string[] {
  const lines = [
    buildHttpTraceSummaryLine(exchange),
    ...buildHttpTraceDetailLines(exchange.operation, "request headers", exchange.request.headers),
    ...buildHttpTraceBodyLines(exchange.operation, "request body", exchange.request.body),
  ];

  if (exchange.response) {
    lines.push(buildHttpTraceStatusLine(exchange));
    lines.push(...buildHttpTraceDetailLines(exchange.operation, "response headers", exchange.response.headers));
    lines.push(...buildHttpTraceBodyLines(exchange.operation, "response body", exchange.response.body));
  }

  if (exchange.error) {
    lines.push(
      `${formatHttpTraceLabel(exchange.operation)} | ${chalk.red("error")} ${chalk.white(exchange.error)}`,
    );
  }

  return lines;
}

function buildOriginHeaderLine(originServer: ServerEntry, serviceCount: number): string {
  const countLabel = serviceCount === 1 ? "service" : "services";
  return `${formatOperationLabel("config")} | ${chalk.bold(originServer.id)} ${chalk.gray(`(${originServer.description})`)} ${chalk.yellow(`:${serviceCount} ${countLabel}`)}`;
}

function buildHttpTraceSummaryLine(exchange: HttpTraceExchange): string {
  const methodColor = exchange.request.method === "GET" ? chalk.cyan : chalk.green;
  const transport = exchange.transport ? ` | ${chalk.gray("transport")} ${chalk.white(exchange.transport)}` : "";
  return `${formatHttpTraceLabel(exchange.operation)} | ${chalk.gray("request")} ${methodColor(exchange.request.method)} ${chalk.cyan(exchange.request.url)}${transport}`;
}

function buildHttpTraceStatusLine(exchange: HttpTraceExchange): string {
  const response = exchange.response;
  if (!response) {
    return `${formatHttpTraceLabel(exchange.operation)} | ${chalk.gray("status")} ${chalk.gray("n/a")}`;
  }

  const statusColor =
    response.statusCode >= 500 ? chalk.red : response.statusCode >= 400 ? chalk.yellow : chalk.green;
  const statusText = response.statusText ? ` ${chalk.gray(response.statusText)}` : "";
  return `${formatHttpTraceLabel(exchange.operation)} | ${chalk.gray("status")} ${statusColor(String(response.statusCode))}${statusText}`;
}

function buildHttpTraceDetailLines(
  operation: HttpTraceOperation,
  label: string,
  values?: Record<string, string>,
): string[] {
  if (!values || Object.keys(values).length === 0) {
    return [];
  }

  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, value]) =>
        `${formatHttpTraceLabel(operation)} | ${chalk.gray(label)} | ${chalk.yellow(name)}: ${chalk.white(value)}`,
    );
}

function buildHttpTraceBodyLines(
  operation: HttpTraceOperation,
  label: string,
  body?: string,
): string[] {
  if (!body) {
    return [];
  }

  return body
    .split("\n")
    .map(
      (line) =>
        `${formatHttpTraceLabel(operation)} | ${chalk.gray(label)} | ${chalk.white(line.length > 0 ? line : " ")}`,
    );
}

function formatHttpTraceLabel(operation: HttpTraceOperation): string {
  return `${formatPhaseLabel(operation)} ${chalk.gray("HTTP")}`;
}

function buildServiceDetailLine(
  service: ServiceEntry,
  caddyServer?: ServerEntry,
  cloudflareServer?: ServerEntry,
): string {
  const caddyPublication = service.publish.caddy;
  const cloudflarePublication = service.publish["cloudflare-tunnel"];

  const details: string[] = [
    formatServiceLabel(service),
    chalk.white(service.id),
    chalk.gray(`:${service.origin.port}`),
  ];

  if (caddyPublication) {
    details.push(
      `${chalk.blue("C")} ${chalk.cyan(caddyPublication.hostname)} ${chalk.gray(`via ${caddyServer?.id ?? caddyPublication.via}`)}`,
    );
  }

  if (service.dns?.from_publish === "caddy") {
    details.push(`${chalk.magenta("D")} ${chalk.magenta("caddy")}`);
  }

  if (cloudflarePublication) {
    details.push(
      `${chalk.yellow("CF")} ${chalk.yellow(cloudflarePublication.hostname)} ${chalk.gray(`via ${cloudflareServer?.id ?? cloudflarePublication.via}`)}`,
    );
  }

  return `${formatOperationLabel("config")} | ${details.join("  ")}`;
}

function formatServiceLabel(service?: ServiceEntry, fallbackId?: string): string {
  const label = truncateLabel(
    service?.description ?? fallbackId ?? "managed service",
    serviceLabelLength,
  );

  return chalk.cyan(label.padEnd(serviceLabelLength));
}

function truncateLabel(value: string, maxLength: number): string {
  const normalizedValue = value.trim();
  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength - 3)}...`;
}

function formatProgressBar(progress: OperationProgressState): string {
  const total = Math.max(progress.total, progress.successful + progress.failed);
  const completed = Math.min(progress.successful + progress.failed, total);
  const filledCount = Math.round((completed / total) * progressBarWidth);
  const emptyCount = progressBarWidth - filledCount;
  const bar = [
    chalk.green("=".repeat(filledCount)),
    chalk.gray("-".repeat(emptyCount)),
  ].join("");

  return [
    `${chalk.gray("[")}${bar}${chalk.gray("]")}`,
    chalk.green(String(progress.successful)),
    chalk.gray("|"),
    chalk.cyan(String(total)),
    chalk.red("!"),
    chalk.red(String(progress.failed)),
  ].join(" ");
}

function formatActionLabel(action: SyncAction): string {
  const actionColor =
    action === "create"
      ? chalk.green
      : action === "delete"
        ? chalk.red
      : action === "update"
        ? chalk.yellow
        : chalk.gray;

  return actionColor(action.toUpperCase());
}

function summarizeDnsResults(results: DnsRewriteSyncResult[]): string {
  const counts = {
    create: 0,
    delete: 0,
    update: 0,
    unchanged: 0,
  };

  for (const result of results) {
    counts[result.action] += 1;
  }

  return [
    chalk.green(`${counts.create} create`),
    chalk.red(`${counts.delete} delete`),
    chalk.yellow(`${counts.update} update`),
    chalk.gray(`${counts.unchanged} unchanged`),
  ].join(", ");
}

function summarizeCloudflareActions(results: Array<{ action: SyncAction }>): string {
  const counts = {
    create: 0,
    delete: 0,
    update: 0,
    unchanged: 0,
  };

  for (const result of results) {
    counts[result.action] += 1;
  }

  return [
    chalk.green(`${counts.create} create`),
    chalk.red(`${counts.delete} delete`),
    chalk.yellow(`${counts.update} update`),
    chalk.gray(`${counts.unchanged} unchanged`),
  ].join(", ");
}
