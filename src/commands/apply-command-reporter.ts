import chalk from "chalk";
import type { UnsubscribeFunction } from "emittery";
import ora, { type Ora } from "ora";

import type { HomelabConfig, ServerEntry, ServiceEntry } from "../config/types.ts";
import type {
  CloudflarePublicDnsSyncResult,
  CloudflareTunnelIngressSyncResult,
  CloudflareTunnelSyncResult,
} from "../services/cloudflare/types.ts";
import type { DnsRewriteSyncResult } from "../services/dns/types.ts";
import type {
  ApplyCommandEventBus,
  ApplyCaddyDryRunEvent,
  ApplyCaddySyncSuccessEvent,
  ApplyCompletedEvent,
  ApplyCloudflareDryRunEvent,
  ApplyCloudflareSyncProgressEvent,
  ApplyCloudflareSyncStartEvent,
  ApplyCloudflareSyncSuccessEvent,
  ApplyConfigLoadedEvent,
  ApplyConfigLoadStartEvent,
  ApplyDnsSyncProgressEvent,
  ApplyDnsSyncSuccessEvent,
  ApplyTarget,
  ApplyTargetErrorEvent,
  ApplyTargetSkippedEvent,
  ApplyTargetsResolvedEvent,
} from "./apply-command-types.ts";
import {
  APPLY_COMMAND_EVENTS,
} from "./apply-command-types.ts";

interface OperationProgressState {
  failed: number;
  operation: "cloudflare" | "dns";
  server: ServerEntry;
  successful: number;
  total: number;
}

export class ApplyCliReporter {
  private static readonly serviceLabelLength = 18;
  private static readonly progressBarWidth = 16;

  private loadSpinner?: Ora;
  private caddySpinner?: Ora;
  private cloudflareSpinner?: Ora;
  private dnsSpinner?: Ora;
  private cloudflareProgress?: OperationProgressState;
  private dnsProgress?: OperationProgressState;

  public attach(eventBus: ApplyCommandEventBus): () => void {
    const unsubscribers: UnsubscribeFunction[] = [
      eventBus.on(APPLY_COMMAND_EVENTS.configLoadStart, (event) => {
        this.onConfigLoadStart(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.configLoaded, (event) => {
        this.onConfigLoaded(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.targetsResolved, (event) => {
        this.onTargetsResolved(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.caddySyncStart, (event) => {
        this.onCaddySyncStart(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.caddyDryRun, (event) => {
        this.onCaddyDryRun(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.caddySyncSkipped, (event) => {
        this.onCaddySyncSkipped(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.caddySyncSuccess, (event) => {
        this.onCaddySyncSuccess(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.caddySyncFailed, (event) => {
        this.onCaddySyncFailed(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.cloudflareSyncStart, (event) => {
        this.onCloudflareSyncStart(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.cloudflareSyncProgress, (event) => {
        this.onCloudflareSyncProgress(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.cloudflareDryRun, (event) => {
        this.onCloudflareDryRun(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.cloudflareSyncSkipped, (event) => {
        this.onCloudflareSyncSkipped(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.cloudflareSyncSuccess, (event) => {
        this.onCloudflareSyncSuccess(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.cloudflareSyncFailed, (event) => {
        this.onCloudflareSyncFailed(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.dnsSyncStart, (event) => {
        this.onDnsSyncStart(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.dnsSyncProgress, (event) => {
        this.onDnsSyncProgress(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.dnsDryRun, (event) => {
        this.onDnsDryRun(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.dnsSyncSkipped, (event) => {
        this.onDnsSyncSkipped(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.dnsSyncSuccess, (event) => {
        this.onDnsSyncSuccess(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.dnsSyncFailed, (event) => {
        this.onDnsSyncFailed(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.completed, (event) => {
        this.onCompleted(event.data);
      }),
    ];

    return (): void => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }

  private onConfigLoadStart(_event: ApplyConfigLoadStartEvent): void {
    this.loadSpinner = ora(
      `${this.formatOperationLabel("config")} | Loading homelab config...`,
    ).start();
  }

  private onConfigLoaded(event: ApplyConfigLoadedEvent): void {
    this.loadSpinner?.succeed(
      `${this.formatOperationLabel("config")} | Loaded ${event.config.services.length} services from ${chalk.cyan(event.configDirectory)}.`,
    );

    console.log(`${this.formatOperationLabel("config")} | ${chalk.bold("Origins")}`);
    const serviceLines = this.buildServiceSummaryLines(event.config);
    for (const line of serviceLines) {
      console.log(line);
    }
  }

  private onTargetsResolved(event: ApplyTargetsResolvedEvent): void {
    const summary = event.targets
      .map((target: ApplyTarget): string => {
        const caddyCount = target.services.filter(
          (service: ServiceEntry) => service.publish.caddy?.via === target.server.id,
        ).length;
        const cloudflareCount = target.services.filter(
          (service: ServiceEntry) => service.publish["cloudflare-tunnel"]?.via === target.server.id,
        ).length;

        return [
          chalk.blue(target.server.id),
          chalk.blue(`C:${caddyCount}`),
          chalk.yellow(`CF:${cloudflareCount}`),
        ].join(" ");
      })
      .join(", ");

    console.log(`${this.formatOperationLabel("apply")} | ${chalk.bold("Targets")} ${summary}`);
  }

  private onCaddySyncStart({ target }: { target: ApplyTarget }): void {
    console.log(this.buildCaddyIntentLine(target.server, target.services));
    this.caddySpinner = ora(
      `${this.formatPhaseLabel("caddy")} | ${this.formatServerLabel(target.server)} | building Caddy payload...`,
    ).start();
    this.caddySpinner.text = `${this.formatPhaseLabel("caddy")} | ${this.formatServerLabel(target.server)} | applying ${target.services.length} route(s)...`;
  }

  private onCaddyDryRun(event: ApplyCaddyDryRunEvent): void {
    this.caddySpinner?.stop();
    console.log(`${this.formatPhaseLabel("caddy")} | ${chalk.gray(`POST ${event.loadUrl}`)}`);
    console.log(this.buildCaddyDryRunResultLine(event.target.server, event.target.services));
  }

  private onCaddySyncSuccess(event: ApplyCaddySyncSuccessEvent): void {
    this.caddySpinner?.stop();
    console.log(
      this.buildCaddyResultLine(event.target.server, event.target.services, event.response.transport),
    );
  }

  private onCaddySyncSkipped(event: ApplyTargetSkippedEvent): void {
    this.caddySpinner?.stop();
    console.log(this.buildSkippedResultLine("caddy", event.target.server, event.reason));
  }

  private onCaddySyncFailed(event: ApplyTargetErrorEvent): void {
    this.caddySpinner?.fail(
      `${this.formatPhaseLabel("caddy")} | ${this.formatServerLabel(event.target.server)} | update failed.`,
    );
  }

  private onCloudflareSyncStart(event: ApplyCloudflareSyncStartEvent): void {
    const { target } = event;
    console.log(this.buildCloudflareIntentLine(target.server, target.services));
    this.cloudflareProgress = this.createProgressState(
      "cloudflare",
      target.server,
      target.services.length * (event.publicDnsEnabled ? 2 : 1),
    );
    this.cloudflareSpinner = ora(
      `${this.formatPhaseLabel("cloudflare")} | ${this.formatServerLabel(target.server)} | syncing Cloudflare Tunnel routes...`,
    ).start();
  }

  private onCloudflareSyncProgress(_event: ApplyCloudflareSyncProgressEvent): void {
    if (!this.cloudflareProgress) {
      return;
    }

    this.cloudflareProgress.successful += 1;
    this.refreshProgressSpinner(
      this.cloudflareSpinner,
      this.cloudflareProgress,
      "syncing Cloudflare Tunnel routes",
    );
  }

  private onCloudflareDryRun(event: ApplyCloudflareDryRunEvent): void {
    this.cloudflareSpinner?.stop();
    console.log(
      this.buildCloudflareDryRunResultLine(
        event.target.server,
        event.target.services,
        event.publicDnsEnabled,
      ),
    );
  }

  private onCloudflareSyncSuccess(event: ApplyCloudflareSyncSuccessEvent): void {
    this.cloudflareSpinner?.stop();
    this.cloudflareProgress = undefined;
    console.log(this.buildCloudflareResultLine(event.target.server, event.result));

    this.logCloudflareIngressResults(event.result.ingress);

    if (event.result.publicDnsEnabled) {
      this.logCloudflarePublicDnsResults(event.result.publicDns);
    }
  }

  private onCloudflareSyncSkipped(event: ApplyTargetSkippedEvent): void {
    this.cloudflareSpinner?.stop();
    this.cloudflareProgress = undefined;
    console.log(this.buildSkippedResultLine("cloudflare", event.target.server, event.reason));
  }

  private onCloudflareSyncFailed(event: ApplyTargetErrorEvent): void {
    if (this.cloudflareProgress) {
      this.cloudflareProgress.failed += 1;
      this.refreshProgressSpinner(
        this.cloudflareSpinner,
        this.cloudflareProgress,
        "syncing Cloudflare Tunnel routes",
      );
    }
    this.cloudflareSpinner?.fail(
      `${this.formatPhaseLabel("cloudflare")} | ${this.formatServerLabel(event.target.server)} | sync failed.`,
    );
    this.cloudflareProgress = undefined;
  }

  private onDnsSyncStart({ target }: { target: ApplyTarget }): void {
    console.log(this.buildDnsIntentLine(target.server, target.services));
    this.dnsProgress = this.createProgressState("dns", target.server, target.services.length);
    this.dnsSpinner = ora(
      `${this.formatPhaseLabel("dns")} | ${this.formatServerLabel(target.server)} | syncing AdGuard DNS rewrites...`,
    ).start();
  }

  private onDnsSyncProgress(_event: ApplyDnsSyncProgressEvent): void {
    if (!this.dnsProgress) {
      return;
    }

    this.dnsProgress.successful += 1;
    this.refreshProgressSpinner(
      this.dnsSpinner,
      this.dnsProgress,
      "syncing AdGuard DNS rewrites",
    );
  }

  private onDnsDryRun({ target }: { target: ApplyTarget }): void {
    console.log(this.buildDnsDryRunResultLine(target.server));
  }

  private onDnsSyncSuccess(event: ApplyDnsSyncSuccessEvent): void {
    this.dnsSpinner?.stop();
    this.dnsProgress = undefined;
    console.log(this.buildDnsResultLine(event.target.server, event.results));

    this.logDnsResults(event.results);
  }

  private onDnsSyncSkipped(event: ApplyTargetSkippedEvent): void {
    this.dnsSpinner?.stop();
    this.dnsProgress = undefined;
    console.log(this.buildSkippedResultLine("dns", event.target.server, event.reason));
  }

  private onDnsSyncFailed(event: ApplyTargetErrorEvent): void {
    if (this.dnsProgress) {
      this.dnsProgress.failed += 1;
      this.refreshProgressSpinner(
        this.dnsSpinner,
        this.dnsProgress,
        "syncing AdGuard DNS rewrites",
      );
    }
    this.dnsSpinner?.fail(
      `${this.formatPhaseLabel("dns")} | ${this.formatServerLabel(event.target.server)} | rewrite sync failed.`,
    );
    this.dnsProgress = undefined;
  }

  private onCompleted(event: ApplyCompletedEvent): void {
    console.log(
      `${this.formatOperationLabel("apply")} | ${chalk.green(`Finished APPLY for ${event.processedTargets} publication target(s).`)}`,
    );
  }

  private buildServiceSummaryLines(config: HomelabConfig): string[] {
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

      lines.push(this.buildOriginHeaderLine(originServer, services.length));

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

        lines.push(this.buildServiceDetailLine(service, caddyServer, cloudflareServer));
      }
    });

    return lines;
  }

  private buildOriginHeaderLine(originServer: ServerEntry, serviceCount: number): string {
    const countLabel = serviceCount === 1 ? "service" : "services";
    return `${this.formatOperationLabel("config")} | ${chalk.bold(originServer.id)} ${chalk.gray(`(${originServer.description})`)} ${chalk.yellow(`:${serviceCount} ${countLabel}`)}`;
  }

  private buildServiceDetailLine(
    service: ServiceEntry,
    caddyServer?: ServerEntry,
    cloudflareServer?: ServerEntry,
  ): string {
    const caddyPublication = service.publish.caddy;
    const cloudflarePublication = service.publish["cloudflare-tunnel"];

    const details: string[] = [
      this.formatServiceLabel(service),
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

    return `${this.formatOperationLabel("config")} | ${details.join("  ")}`;
  }

  private formatDnsResult(result: DnsRewriteSyncResult): string {
    const actionLabel = this.formatActionLabel(result.action);
    const currentAnswer =
      result.currentAnswers.length > 0 ? result.currentAnswers.join(", ") : "missing";
    const prefix = `${this.formatPhaseLabel("dns")} | ${this.formatServiceLabel(result.service, result.serviceId)} |`;

    if (result.action === "delete") {
      return `${prefix} ${result.domain} | ${actionLabel} | removing ${currentAnswer}`;
    }

    return `${prefix} ${result.domain} | ${actionLabel} | ${currentAnswer} -> ${result.desiredAnswer}`;
  }

  private formatCloudflareIngressResult(result: CloudflareTunnelIngressSyncResult): string {
    const actionLabel = this.formatActionLabel(result.action);
    const currentService = result.currentService ?? "missing";
    const prefix = `${this.formatPhaseLabel("cloudflare")} | ${this.formatServiceLabel(result.service, result.serviceId)} |`;

    if (result.action === "delete") {
      return `${prefix} ${result.hostname} | ${actionLabel} | removing ${currentService}`;
    }

    return `${prefix} ${result.hostname} | ${actionLabel} | ${currentService} -> ${result.desiredService}`;
  }

  private formatCloudflarePublicDnsResult(result: CloudflarePublicDnsSyncResult): string {
    const actionLabel = this.formatActionLabel(result.action);
    const currentTunnel = result.currentTunnelId ?? "missing";
    const prefix = `${this.formatOperationLabel("cloudflareDns")} | ${this.formatServiceLabel(result.service, result.serviceId)} |`;

    if (result.action === "delete") {
      return `${prefix} ${result.hostname} | ${actionLabel} | removing ${currentTunnel}`;
    }

    return `${prefix} ${result.hostname} | ${actionLabel} | ${currentTunnel} -> ${result.desiredTunnelId}`;
  }

  private logDnsResults(results: DnsRewriteSyncResult[]): void {
    this.logActionableResults(
      results,
      (result: DnsRewriteSyncResult): string => this.formatDnsResult(result),
      this.formatPhaseLabel("dns"),
      "domain rewrite",
    );
  }

  private logCloudflareIngressResults(results: CloudflareTunnelIngressSyncResult[]): void {
    this.logActionableResults(
      results,
      (result: CloudflareTunnelIngressSyncResult): string =>
        this.formatCloudflareIngressResult(result),
      this.formatPhaseLabel("cloudflare"),
      "ingress",
    );
  }

  private logCloudflarePublicDnsResults(results: CloudflarePublicDnsSyncResult[]): void {
    this.logActionableResults(
      results,
      (result: CloudflarePublicDnsSyncResult): string =>
        this.formatCloudflarePublicDnsResult(result),
      this.formatOperationLabel("cloudflareDns"),
      "public DNS",
    );
  }

  private logActionableResults<T extends { action: "create" | "delete" | "update" | "unchanged" }>(
    results: T[],
    formatResult: (result: T) => string,
    operationLabel: string,
    noun: string,
  ): void {
    let unchangedCount = 0;

    for (const result of results) {
      if (result.action === "unchanged") {
        unchangedCount += 1;
        continue;
      }

      console.log(chalk.dim(formatResult(result)));
    }

    if (unchangedCount > 0) {
      console.log(
        chalk.dim(
          `${operationLabel} | ${chalk.gray(`${unchangedCount} ${noun} operation(s) UNCHANGED`)}`,
        ),
      );
    }
  }

  private formatActionLabel(action: "create" | "delete" | "update" | "unchanged"): string {
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

  private summarizeDnsResults(results: DnsRewriteSyncResult[]): string {
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

  private summarizeCloudflareActions(
    results: Array<{ action: "create" | "delete" | "update" | "unchanged" }>,
  ): string {
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

  private formatOperationLabel(
    operation: "apply" | "caddy" | "cloudflare" | "cloudflareDns" | "config" | "dns",
  ): string {
    if (operation === "apply") {
      return chalk.green("Apply");
    }

    if (operation === "config") {
      return chalk.cyan("Config");
    }

    if (operation === "cloudflareDns") {
      return chalk.yellow("Cloudflare DNS");
    }

    return this.formatPhaseLabel(operation);
  }

  private formatPhaseLabel(phase: "caddy" | "cloudflare" | "dns"): string {
    if (phase === "caddy") {
      return chalk.blue("Caddy");
    }

    if (phase === "cloudflare") {
      return chalk.yellow("Cloudflare");
    }

    return chalk.magenta("AdGuard DNS");
  }

  private formatServerLabel(server: ServerEntry): string {
    return `${chalk.blue(server.id)} ${chalk.gray(`(${server.description})`)}`;
  }

  private formatServiceLabel(service?: ServiceEntry, fallbackId?: string): string {
    const label = this.truncateLabel(
      service?.description ?? fallbackId ?? "managed service",
      ApplyCliReporter.serviceLabelLength,
    );

    return chalk.cyan(label.padEnd(ApplyCliReporter.serviceLabelLength));
  }

  private truncateLabel(value: string, maxLength: number): string {
    const normalizedValue = value.trim();
    if (normalizedValue.length <= maxLength) {
      return normalizedValue;
    }

    return `${normalizedValue.slice(0, maxLength - 3)}...`;
  }

  private createProgressState(
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

  private refreshProgressSpinner(
    spinner: Ora | undefined,
    progress: OperationProgressState,
    label: string,
  ): void {
    if (!spinner) {
      return;
    }

    spinner.text = this.buildProgressLine(progress, label);
  }

  private buildProgressLine(progress: OperationProgressState, label: string): string {
    const total = Math.max(progress.total, progress.successful + progress.failed);

    if (total !== progress.total) {
      progress.total = total;
    }

    return [
      this.formatPhaseLabel(progress.operation),
      this.formatServerLabel(progress.server),
      `${label} ${this.formatProgressBar(progress)}`,
    ].join(" | ");
  }

  private formatProgressBar(progress: OperationProgressState): string {
    const total = Math.max(progress.total, progress.successful + progress.failed);
    const completed = Math.min(progress.successful + progress.failed, total);
    const filledCount = Math.round((completed / total) * ApplyCliReporter.progressBarWidth);
    const emptyCount = ApplyCliReporter.progressBarWidth - filledCount;
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

  private buildCaddyIntentLine(server: ServerEntry, services: ServiceEntry[]): string {
    return `${this.formatPhaseLabel("caddy")} | ${this.formatServerLabel(server)} | syncing ${services.length} route(s)`;
  }

  private buildDnsIntentLine(server: ServerEntry, services: ServiceEntry[]): string {
    return `${this.formatPhaseLabel("dns")} | ${this.formatServerLabel(server)} | checking ${services.length} domain rewrite(s)`;
  }

  private buildCloudflareIntentLine(server: ServerEntry, services: ServiceEntry[]): string {
    return `${this.formatPhaseLabel("cloudflare")} | ${this.formatServerLabel(server)} | syncing ${services.length} published application(s)`;
  }

  private buildCaddyResultLine(
    server: ServerEntry,
    services: ServiceEntry[],
    transport: "ky" | "native",
  ): string {
    const transportLabel = transport === "native" ? "native fallback" : "ky";
    return `${this.formatPhaseLabel("caddy")} | ${this.formatServerLabel(server)} | ${chalk.green(`${services.length} routes applied`)} via ${transportLabel}`;
  }

  private buildDnsResultLine(server: ServerEntry, results: DnsRewriteSyncResult[]): string {
    return `${this.formatPhaseLabel("dns")} | ${this.formatServerLabel(server)} | ${this.summarizeDnsResults(results)}`;
  }

  private buildCloudflareResultLine(
    server: ServerEntry,
    result: CloudflareTunnelSyncResult,
  ): string {
    const ingressSummary = this.summarizeCloudflareActions(result.ingress);
    const dnsSummary = result.publicDnsEnabled
      ? this.summarizeCloudflareActions(result.publicDns)
      : chalk.gray("public DNS disabled");

    return `${this.formatPhaseLabel("cloudflare")} | ${this.formatServerLabel(server)} | ingress ${ingressSummary} | dns ${dnsSummary}`;
  }

  private buildCaddyDryRunResultLine(server: ServerEntry, services: ServiceEntry[]): string {
    return `${this.formatPhaseLabel("caddy")} | ${this.formatServerLabel(server)} | ${chalk.green(`${services.length} routes prepared`)} (dry run)`;
  }

  private buildDnsDryRunResultLine(server: ServerEntry): string {
    return `${this.formatPhaseLabel("dns")} | ${this.formatServerLabel(server)} | ${chalk.gray("skipped (dry run)")}`;
  }

  private buildCloudflareDryRunResultLine(
    server: ServerEntry,
    services: ServiceEntry[],
    publicDnsEnabled: boolean,
  ): string {
    const dnsLabel = publicDnsEnabled ? "public DNS planned" : "public DNS disabled";
    return `${this.formatPhaseLabel("cloudflare")} | ${this.formatServerLabel(server)} | ${chalk.green(`${services.length} routes prepared`)} (${dnsLabel}, dry run)`;
  }

  private buildSkippedResultLine(
    phase: "caddy" | "cloudflare" | "dns",
    server: ServerEntry,
    reason: string,
  ): string {
    return `${this.formatPhaseLabel(phase)} | ${this.formatServerLabel(server)} | ${chalk.gray(`skipped (${reason})`)}`;
  }
}
