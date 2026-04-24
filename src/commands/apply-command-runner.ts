import { decorate, inject, injectable } from "inversify";
import { setTimeout as delay } from "node:timers/promises";

import type { ConfigLoader, HomelabConfig, ServerEntry, ServiceEntry } from "../config/types.ts";
import { TYPES } from "../container/identifiers.ts";
import type { CaddyServiceFactory } from "../services/caddy/types.ts";
import type { DnsRewriteSyncResult, DnsServiceFactory } from "../services/dns/types.ts";
import {
  APPLY_COMMAND_EVENTS,
  type ApplyCommandEventBus,
  type ApplyOptions,
  type ApplyTarget,
} from "./apply-command-types.ts";

export class ApplyCommandRunner {
  private static readonly slowRunningDelayMs = 700;

  private readonly configLoader: ConfigLoader;
  private readonly caddyServiceFactory: CaddyServiceFactory;
  private readonly dnsServiceFactory: DnsServiceFactory;

  public constructor(
    configLoader: ConfigLoader,
    caddyServiceFactory: CaddyServiceFactory,
    dnsServiceFactory: DnsServiceFactory,
  ) {
    this.configLoader = configLoader;
    this.caddyServiceFactory = caddyServiceFactory;
    this.dnsServiceFactory = dnsServiceFactory;
  }

  public async run(options: ApplyOptions, eventBus: ApplyCommandEventBus): Promise<void> {
    await eventBus.emit(APPLY_COMMAND_EVENTS.configLoadStart, {
      configDirectory: options.config,
    });

    await this.delayIfSlowRunning(options.slowRunning);
    const config = await this.configLoader.load(options.config);
    await eventBus.emit(APPLY_COMMAND_EVENTS.configLoaded, {
      config,
      configDirectory: options.config,
    });

    const targets = this.groupServicesByServer(config.servers, config.services, options.server);
    if (targets.length === 0) {
      throw new Error("No active services matched the selected server scope.");
    }

    await eventBus.emit(APPLY_COMMAND_EVENTS.targetsResolved, {
      targets,
    });

    let processedTargets = 0;

    for (const target of targets) {
      await this.applyTarget(target, config, options, eventBus);
      processedTargets += 1;
    }

    await eventBus.emit(APPLY_COMMAND_EVENTS.completed, {
      processedTargets,
      dryRun: Boolean(options.dryRun),
    });
  }

  private groupServicesByServer(
    servers: ServerEntry[],
    services: ServiceEntry[],
    requestedServerId?: string,
  ): ApplyTarget[] {
    const relevantServers: ServerEntry[] = requestedServerId
      ? servers.filter((server: ServerEntry) => server.id === requestedServerId)
      : servers;

    if (requestedServerId && relevantServers.length === 0) {
      throw new Error(`Server '${requestedServerId}' was not found in config.`);
    }

    return relevantServers
      .map(
        (server: ServerEntry): ApplyTarget => ({
          server,
          services: services.filter((service: ServiceEntry) => service.server === server.id),
        }),
      )
      .filter((target: ApplyTarget) => target.services.length > 0);
  }

  private async applyTarget(
    target: ApplyTarget,
    config: HomelabConfig,
    options: ApplyOptions,
    eventBus: ApplyCommandEventBus,
  ): Promise<void> {
    await eventBus.emit(APPLY_COMMAND_EVENTS.caddySyncStart, {
      target,
    });

    try {
      const caddyService = this.caddyServiceFactory(target.server);
      const loadUrl = caddyService.getLoadUrl();

      await this.delayIfSlowRunning(options.slowRunning);

      if (options.dryRun) {
        caddyService.buildConfigPayload(target.services);
        await eventBus.emit(APPLY_COMMAND_EVENTS.caddyDryRun, {
          target,
          loadUrl,
        });

        if (config.dns.options.create_dns_rewrites) {
          await eventBus.emit(APPLY_COMMAND_EVENTS.dnsDryRun, {
            target,
          });
        }

        return;
      }

      const response = await caddyService.apply(target.services);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Request to ${loadUrl} failed with ${response.statusCode}.\n${response.body}`);
      }

      await eventBus.emit(APPLY_COMMAND_EVENTS.caddySyncSuccess, {
        target,
        response,
      });
    } catch (error) {
      await eventBus.emit(APPLY_COMMAND_EVENTS.caddySyncFailed, {
        target,
        error,
      });
      throw error;
    }

    await this.syncDnsRewrites(target, config, options, eventBus);
  }

  private async syncDnsRewrites(
    target: ApplyTarget,
    config: HomelabConfig,
    options: ApplyOptions,
    eventBus: ApplyCommandEventBus,
  ): Promise<DnsRewriteSyncResult[]> {
    if (!config.dns.options.create_dns_rewrites) {
      return [];
    }

    if (config.dns.type !== "ADGUARD_HOME") {
      throw new Error(`Unsupported dns.type '${config.dns.type}' for DNS rewrite sync.`);
    }

    await eventBus.emit(APPLY_COMMAND_EVENTS.dnsSyncStart, {
      target,
    });

    try {
      await this.delayIfSlowRunning(options.slowRunning);
      const dnsService = this.dnsServiceFactory(config.dns);
      const results = await dnsService.syncServiceRewrites(target.server, target.services);

      await eventBus.emit(APPLY_COMMAND_EVENTS.dnsSyncSuccess, {
        target,
        results,
      });

      return results;
    } catch (error) {
      await eventBus.emit(APPLY_COMMAND_EVENTS.dnsSyncFailed, {
        target,
        error,
      });
      throw error;
    }
  }

  private async delayIfSlowRunning(slowRunning?: boolean): Promise<void> {
    if (!slowRunning) {
      return;
    }

    await delay(ApplyCommandRunner.slowRunningDelayMs);
  }
}

decorate(injectable(), ApplyCommandRunner);
decorate(inject(TYPES.ConfigLoader), ApplyCommandRunner, 0);
decorate(inject(TYPES.CaddyServiceFactory), ApplyCommandRunner, 1);
decorate(inject(TYPES.DnsServiceFactory), ApplyCommandRunner, 2);
