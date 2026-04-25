import chalk from "chalk";
import type { UnsubscribeFunction } from "emittery";
import ora, { type Ora } from "ora";

import type { ServiceEntry } from "../config/types.ts";
import type {
  CloudflarePublicDnsSyncResult,
  CloudflareTunnelIngressSyncResult,
} from "../services/cloudflare/types.ts";
import type { DnsRewriteSyncResult } from "../services/dns/types.ts";
import {
  APPLY_COMMAND_EVENTS,
  type ApplyCaddyDryRunEvent,
  type ApplyCaddySyncSuccessEvent,
  type ApplyCloudflareDryRunEvent,
  type ApplyCloudflareSyncProgressEvent,
  type ApplyCloudflareSyncStartEvent,
  type ApplyCloudflareSyncSuccessEvent,
  type ApplyCommandEventBus,
  type ApplyCompletedEvent,
  type ApplyConfigLoadedEvent,
  type ApplyConfigLoadStartEvent,
  type ApplyDnsSyncProgressEvent,
  type ApplyDnsSyncSuccessEvent,
  type ApplyTarget,
  type ApplyTargetErrorEvent,
  type ApplyTargetSkippedEvent,
  type ApplyTargetsResolvedEvent,
} from "./apply-command-types.ts";
import {
  buildCaddyDryRunResultLine,
  buildCaddyIntentLine,
  buildCaddyResultLine,
  buildCloudflareDryRunResultLine,
  buildCloudflareIntentLine,
  buildCloudflareResultLine,
  buildDnsDryRunResultLine,
  buildDnsIntentLine,
  buildDnsResultLine,
  buildProgressLine,
  buildServiceSummaryLines,
  buildSkippedResultLine,
  createProgressState,
  formatCloudflareIngressResult,
  formatCloudflarePublicDnsResult,
  formatDnsResult,
  formatOperationLabel,
  formatPhaseLabel,
  formatServerLabel,
  type OperationProgressState,
} from "./apply-command-output.ts";

type SyncAction = "create" | "delete" | "update" | "unchanged";

export class ApplyCliReporter {
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
      `${formatOperationLabel("config")} | Loading homelab config...`,
    ).start();
  }

  private onConfigLoaded(event: ApplyConfigLoadedEvent): void {
    this.loadSpinner?.succeed(
      `${formatOperationLabel("config")} | Loaded ${event.config.services.length} services from ${chalk.cyan(event.configDirectory)}.`,
    );

    console.log(`${formatOperationLabel("config")} | ${chalk.bold("Origins")}`);
    const serviceLines = buildServiceSummaryLines(event.config);
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

    console.log(`${formatOperationLabel("apply")} | ${chalk.bold("Targets")} ${summary}`);
  }

  private onCaddySyncStart({ target }: { target: ApplyTarget }): void {
    console.log(buildCaddyIntentLine(target.server, target.services));
    this.caddySpinner = ora(
      `${formatPhaseLabel("caddy")} | ${formatServerLabel(target.server)} | building Caddy payload...`,
    ).start();
    this.caddySpinner.text = `${formatPhaseLabel("caddy")} | ${formatServerLabel(target.server)} | applying ${target.services.length} route(s)...`;
  }

  private onCaddyDryRun(event: ApplyCaddyDryRunEvent): void {
    this.caddySpinner?.stop();
    console.log(`${formatPhaseLabel("caddy")} | ${chalk.gray(`POST ${event.loadUrl}`)}`);
    console.log(buildCaddyDryRunResultLine(event.target.server, event.target.services));
  }

  private onCaddySyncSuccess(event: ApplyCaddySyncSuccessEvent): void {
    this.caddySpinner?.stop();
    console.log(
      buildCaddyResultLine(event.target.server, event.target.services, event.response.transport),
    );
  }

  private onCaddySyncSkipped(event: ApplyTargetSkippedEvent): void {
    this.caddySpinner?.stop();
    console.log(buildSkippedResultLine("caddy", event.target.server, event.reason));
  }

  private onCaddySyncFailed(event: ApplyTargetErrorEvent): void {
    this.caddySpinner?.fail(
      `${formatPhaseLabel("caddy")} | ${formatServerLabel(event.target.server)} | update failed.`,
    );
  }

  private onCloudflareSyncStart(event: ApplyCloudflareSyncStartEvent): void {
    const { target } = event;
    console.log(buildCloudflareIntentLine(target.server, target.services));
    this.cloudflareProgress = createProgressState(
      "cloudflare",
      target.server,
      target.services.length * (event.publicDnsEnabled ? 2 : 1),
    );
    this.cloudflareSpinner = ora(
      `${formatPhaseLabel("cloudflare")} | ${formatServerLabel(target.server)} | syncing Cloudflare Tunnel routes...`,
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
      buildCloudflareDryRunResultLine(
        event.target.server,
        event.target.services,
        event.publicDnsEnabled,
      ),
    );
  }

  private onCloudflareSyncSuccess(event: ApplyCloudflareSyncSuccessEvent): void {
    this.cloudflareSpinner?.stop();
    this.cloudflareProgress = undefined;
    console.log(buildCloudflareResultLine(event.target.server, event.result));

    this.logCloudflareIngressResults(event.result.ingress);

    if (event.result.publicDnsEnabled) {
      this.logCloudflarePublicDnsResults(event.result.publicDns);
    }
  }

  private onCloudflareSyncSkipped(event: ApplyTargetSkippedEvent): void {
    this.cloudflareSpinner?.stop();
    this.cloudflareProgress = undefined;
    console.log(buildSkippedResultLine("cloudflare", event.target.server, event.reason));
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
      `${formatPhaseLabel("cloudflare")} | ${formatServerLabel(event.target.server)} | sync failed.`,
    );
    this.cloudflareProgress = undefined;
  }

  private onDnsSyncStart({ target }: { target: ApplyTarget }): void {
    console.log(buildDnsIntentLine(target.server, target.services));
    this.dnsProgress = createProgressState("dns", target.server, target.services.length);
    this.dnsSpinner = ora(
      `${formatPhaseLabel("dns")} | ${formatServerLabel(target.server)} | syncing AdGuard DNS rewrites...`,
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
    console.log(buildDnsDryRunResultLine(target.server));
  }

  private onDnsSyncSuccess(event: ApplyDnsSyncSuccessEvent): void {
    this.dnsSpinner?.stop();
    this.dnsProgress = undefined;
    console.log(buildDnsResultLine(event.target.server, event.results));

    this.logDnsResults(event.results);
  }

  private onDnsSyncSkipped(event: ApplyTargetSkippedEvent): void {
    this.dnsSpinner?.stop();
    this.dnsProgress = undefined;
    console.log(buildSkippedResultLine("dns", event.target.server, event.reason));
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
      `${formatPhaseLabel("dns")} | ${formatServerLabel(event.target.server)} | rewrite sync failed.`,
    );
    this.dnsProgress = undefined;
  }

  private onCompleted(event: ApplyCompletedEvent): void {
    console.log(
      `${formatOperationLabel("apply")} | ${chalk.green(`Finished APPLY for ${event.processedTargets} publication target(s).`)}`,
    );
  }

  private refreshProgressSpinner(
    spinner: Ora | undefined,
    progress: OperationProgressState,
    label: string,
  ): void {
    if (!spinner) {
      return;
    }

    spinner.text = buildProgressLine(progress, label);
  }

  private logDnsResults(results: DnsRewriteSyncResult[]): void {
    this.logActionableResults(
      results,
      (result: DnsRewriteSyncResult): string => formatDnsResult(result),
      formatPhaseLabel("dns"),
      "domain rewrite",
    );
  }

  private logCloudflareIngressResults(results: CloudflareTunnelIngressSyncResult[]): void {
    this.logActionableResults(
      results,
      (result: CloudflareTunnelIngressSyncResult): string =>
        formatCloudflareIngressResult(result),
      formatPhaseLabel("cloudflare"),
      "ingress",
    );
  }

  private logCloudflarePublicDnsResults(results: CloudflarePublicDnsSyncResult[]): void {
    this.logActionableResults(
      results,
      (result: CloudflarePublicDnsSyncResult): string =>
        formatCloudflarePublicDnsResult(result),
      formatOperationLabel("cloudflareDns"),
      "public DNS",
    );
  }

  private logActionableResults<T extends { action: SyncAction }>(
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
}
