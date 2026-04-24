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

    const serviceLines = this.buildServiceLines(event.config);
    for (const line of serviceLines) {
      console.log(chalk.dim(line));
    }
  }

  private onTargetsResolved(event: ApplyTargetsResolvedEvent): void {
    const summary = event.targets
      .map((target: ApplyTarget): string => `${target.server.id} (${target.services.length})`)
      .join(", ");

    console.log(chalk.dim(`Target servers: ${summary}`));
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

  private formatServiceLine(service: ServiceEntry, server: ServerEntry): string {
    const upstreamIp = service.ip_override ?? server.ip;
    const target = `${upstreamIp}:${service.port} (${server.id})`;
    const serviceDescription = chalk.cyan(service.description);
    const serverDescription = chalk.gray(server.description);

    return `${service.id} | ${service.domain} | ${target} | ${serviceDescription} | ${serverDescription}`;
  }

  private buildServiceLines(config: HomelabConfig): string[] {
    const serversById = new Map<string, ServerEntry>(
      config.servers.map((server: ServerEntry): [string, ServerEntry] => [server.id, server]),
    );

    return config.services.map((service: ServiceEntry): string => {
      const server = serversById.get(service.server);
      if (!server) {
        throw new Error(`Service '${service.id}' references unknown server '${service.server}'.`);
      }

      return this.formatServiceLine(service, server);
    });
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
