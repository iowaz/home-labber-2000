import chalk from "chalk";
import type { UnsubscribeFunction } from "emittery";
import ora, { type Ora } from "ora";

import type { HomelabConfig, ServerEntry, ServiceEntry } from "../config/types.ts";
import type { DnsRewriteSyncResult } from "../services/dns/types.ts";
import type {
  ApplyCommandEventBus,
  ApplyCaddyDryRunEvent,
  ApplyCaddySyncSuccessEvent,
  ApplyCompletedEvent,
  ApplyConfigLoadedEvent,
  ApplyConfigLoadStartEvent,
  ApplyDnsSyncSuccessEvent,
  ApplyTarget,
  ApplyTargetErrorEvent,
  ApplyTargetsResolvedEvent,
} from "./apply-command-types.ts";
import {
  APPLY_COMMAND_EVENTS,
} from "./apply-command-types.ts";

export class ApplyCliReporter {
  private loadSpinner?: Ora;
  private caddySpinner?: Ora;
  private dnsSpinner?: Ora;

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
      eventBus.on(APPLY_COMMAND_EVENTS.caddySyncSuccess, (event) => {
        this.onCaddySyncSuccess(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.caddySyncFailed, (event) => {
        this.onCaddySyncFailed(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.dnsSyncStart, (event) => {
        this.onDnsSyncStart(event.data);
      }),
      eventBus.on(APPLY_COMMAND_EVENTS.dnsDryRun, (event) => {
        this.onDnsDryRun(event.data);
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
    this.loadSpinner = ora("Loading homelab config...").start();
  }

  private onConfigLoaded(event: ApplyConfigLoadedEvent): void {
    this.loadSpinner?.succeed(
      `Loaded ${event.config.services.length} services from ${chalk.cyan(event.configDirectory)}.`,
    );

    console.log(chalk.bold("Origins"));
    const serviceLines = this.buildServiceSummaryLines(event.config);
    for (const line of serviceLines) {
      console.log(line);
    }
  }

  private onTargetsResolved(event: ApplyTargetsResolvedEvent): void {
    const summary = event.targets
      .map((target: ApplyTarget): string => `${chalk.blue(target.server.id)} ${chalk.yellow(`x${target.services.length}`)}`)
      .join(", ");

    console.log(`${chalk.bold("Caddy Targets")} ${summary}`);
  }

  private onCaddySyncStart({ target }: { target: ApplyTarget }): void {
    console.log(this.buildCaddyIntentLine(target.server, target.services));
    this.caddySpinner = ora(`Building Caddy payload for ${target.server.id}...`).start();
    this.caddySpinner.text = `Applying ${target.services.length} routes to ${target.server.id}...`;
  }

  private onCaddyDryRun(event: ApplyCaddyDryRunEvent): void {
    this.caddySpinner?.stop();
    console.log(chalk.gray(`POST ${event.loadUrl}`));
    console.log(this.buildCaddyDryRunResultLine(event.target.server, event.target.services));
  }

  private onCaddySyncSuccess(event: ApplyCaddySyncSuccessEvent): void {
    this.caddySpinner?.stop();
    console.log(
      this.buildCaddyResultLine(event.target.server, event.target.services, event.response.transport),
    );
  }

  private onCaddySyncFailed(event: ApplyTargetErrorEvent): void {
    this.caddySpinner?.fail(`Caddy update failed for ${event.target.server.id}.`);
  }

  private onDnsSyncStart({ target }: { target: ApplyTarget }): void {
    console.log(this.buildDnsIntentLine(target.server, target.services));
    this.dnsSpinner = ora(`Syncing AdGuard DNS rewrites for ${target.server.id}...`).start();
  }

  private onDnsDryRun({ target }: { target: ApplyTarget }): void {
    console.log(this.buildDnsDryRunResultLine(target.server));
  }

  private onDnsSyncSuccess(event: ApplyDnsSyncSuccessEvent): void {
    this.dnsSpinner?.stop();
    console.log(this.buildDnsResultLine(event.target.server, event.results));

    for (const result of event.results) {
      console.log(chalk.dim(this.formatDnsResult(result)));
    }
  }

  private onDnsSyncFailed(event: ApplyTargetErrorEvent): void {
    this.dnsSpinner?.fail(`DNS rewrite sync failed for ${event.target.server.id}.`);
  }

  private onCompleted(event: ApplyCompletedEvent): void {
    console.log(chalk.green(`Finished APPLY for ${event.processedTargets} Caddy target(s).`));
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

    originEntries.forEach(([originServerId, services], index: number) => {
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

      if (index < originEntries.length - 1) {
        lines.push("");
      }
    });

    return lines;
  }

  private buildOriginHeaderLine(originServer: ServerEntry, serviceCount: number): string {
    const countLabel = serviceCount === 1 ? "service" : "services";
    return `${chalk.bold(originServer.id)} ${chalk.gray(`(${originServer.description})`)} ${chalk.yellow(`:${serviceCount} ${countLabel}`)}`;
  }

  private buildServiceDetailLine(
    service: ServiceEntry,
    caddyServer?: ServerEntry,
    cloudflareServer?: ServerEntry,
  ): string {
    const caddyPublication = service.publish.caddy;
    const cloudflarePublication = service.publish["cloudflare-tunnel"];

    const details: string[] = [
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

    details.push(chalk.gray(service.description));

    return `  ${details.join("  ")}`;
  }

  private formatDnsResult(result: DnsRewriteSyncResult): string {
    const actionColor =
      result.action === "create"
        ? chalk.green
        : result.action === "update"
          ? chalk.yellow
          : chalk.gray;
    const actionLabel = actionColor(result.action.toUpperCase());
    const currentAnswer =
      result.currentAnswers.length > 0 ? result.currentAnswers.join(", ") : "missing";

    return `${result.domain} | ${actionLabel} | ${currentAnswer} -> ${result.desiredAnswer}`;
  }

  private summarizeDnsResults(results: DnsRewriteSyncResult[]): string {
    const counts = {
      create: 0,
      update: 0,
      unchanged: 0,
    };

    for (const result of results) {
      counts[result.action] += 1;
    }

    return [
      chalk.green(`${counts.create} create`),
      chalk.yellow(`${counts.update} update`),
      chalk.gray(`${counts.unchanged} unchanged`),
    ].join(", ");
  }

  private formatPhaseLabel(phase: "caddy" | "dns"): string {
    return phase === "caddy" ? chalk.blue("Caddy") : chalk.magenta("AdGuard DNS");
  }

  private formatServerLabel(server: ServerEntry): string {
    return `${chalk.blue(server.id)} ${chalk.gray(`(${server.description})`)}`;
  }

  private buildCaddyIntentLine(server: ServerEntry, services: ServiceEntry[]): string {
    return `${this.formatPhaseLabel("caddy")} | ${this.formatServerLabel(server)} | syncing ${services.length} route(s)`;
  }

  private buildDnsIntentLine(server: ServerEntry, services: ServiceEntry[]): string {
    return `${this.formatPhaseLabel("dns")} | ${this.formatServerLabel(server)} | checking ${services.length} domain rewrite(s)`;
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

  private buildCaddyDryRunResultLine(server: ServerEntry, services: ServiceEntry[]): string {
    return `${this.formatPhaseLabel("caddy")} | ${this.formatServerLabel(server)} | ${chalk.green(`${services.length} routes prepared`)} (dry run)`;
  }

  private buildDnsDryRunResultLine(server: ServerEntry): string {
    return `${this.formatPhaseLabel("dns")} | ${this.formatServerLabel(server)} | ${chalk.gray("skipped (dry run)")}`;
  }
}
