import { decorate, inject, injectable } from "inversify";
import { setTimeout as delay } from "node:timers/promises";

import type { ConfigLoader, HomelabConfig, ServerEntry, ServiceEntry } from "../config/types.ts";
import { TYPES } from "../container/identifiers.ts";
import type { CaddyServiceFactory } from "../services/caddy/types.ts";
import type { CloudflareTunnelServiceFactory } from "../services/cloudflare/types.ts";
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
  private readonly cloudflareTunnelServiceFactory: CloudflareTunnelServiceFactory;
  private readonly dnsServiceFactory: DnsServiceFactory;

  public constructor(
    configLoader: ConfigLoader,
    caddyServiceFactory: CaddyServiceFactory,
    cloudflareTunnelServiceFactory: CloudflareTunnelServiceFactory,
    dnsServiceFactory: DnsServiceFactory,
  ) {
    this.configLoader = configLoader;
    this.caddyServiceFactory = caddyServiceFactory;
    this.cloudflareTunnelServiceFactory = cloudflareTunnelServiceFactory;
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
      throw new Error("No published services matched the selected server scope.");
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
          services: services.filter(
            (service: ServiceEntry) =>
              service.publish.caddy?.via === server.id ||
              service.publish["cloudflare-tunnel"]?.via === server.id,
          ),
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
    const caddyServices = this.getCaddyServicesForTarget(target);
    if (caddyServices.length > 0) {
      await this.syncCaddy(
        {
          server: target.server,
          services: caddyServices,
        },
        config,
        options,
        eventBus,
      );
    }

    const cloudflareServices = this.getCloudflareTunnelServicesForTarget(target);
    if (cloudflareServices.length > 0) {
      await this.syncCloudflareTunnel(
        {
          server: target.server,
          services: cloudflareServices,
        },
        config,
        options,
        eventBus,
      );
    }

    await this.syncDnsRewrites(target, config, options, eventBus);
  }

  private async syncCaddy(
    target: ApplyTarget,
    config: HomelabConfig,
    options: ApplyOptions,
    eventBus: ApplyCommandEventBus,
  ): Promise<void> {
    await eventBus.emit(APPLY_COMMAND_EVENTS.caddySyncStart, {
      target,
    });

    try {
      const caddyService = this.caddyServiceFactory(target.server, config.servers);
      const loadUrl = caddyService.getLoadUrl();

      await this.delayIfSlowRunning(options.slowRunning);

      if (options.dryRun) {
        caddyService.buildConfigPayload(target.services);
        await eventBus.emit(APPLY_COMMAND_EVENTS.caddyDryRun, {
          target,
          loadUrl,
        });
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
  }

  private async syncCloudflareTunnel(
    target: ApplyTarget,
    config: HomelabConfig,
    options: ApplyOptions,
    eventBus: ApplyCommandEventBus,
  ): Promise<void> {
    await eventBus.emit(APPLY_COMMAND_EVENTS.cloudflareSyncStart, {
      target,
    });

    try {
      await this.delayIfSlowRunning(options.slowRunning);

      if (options.dryRun) {
        await eventBus.emit(APPLY_COMMAND_EVENTS.cloudflareDryRun, {
          target,
          publicDnsEnabled: config.cloudflareTunnels.options.sync_public_dns,
        });
        return;
      }

      const cloudflareService = this.cloudflareTunnelServiceFactory(
        config.cloudflareTunnels,
        target.server,
        config.servers,
      );
      const result = await cloudflareService.syncPublishedApplications(target.services);

      await eventBus.emit(APPLY_COMMAND_EVENTS.cloudflareSyncSuccess, {
        target,
        result,
      });
    } catch (error) {
      await eventBus.emit(APPLY_COMMAND_EVENTS.cloudflareSyncFailed, {
        target,
        error,
      });
      throw error;
    }
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

    const dnsServices = this.getDnsServicesForTarget(target);
    if (dnsServices.length === 0) {
      return [];
    }

    if (options.dryRun) {
      await eventBus.emit(APPLY_COMMAND_EVENTS.dnsDryRun, {
        target: {
          server: target.server,
          services: dnsServices,
        },
      });
      return [];
    }

    if (config.dns.type !== "ADGUARD_HOME") {
      throw new Error(`Unsupported dns.type '${config.dns.type}' for DNS rewrite sync.`);
    }

    await eventBus.emit(APPLY_COMMAND_EVENTS.dnsSyncStart, {
      target: {
        server: target.server,
        services: dnsServices,
      },
    });

    try {
      await this.delayIfSlowRunning(options.slowRunning);
      const dnsService = this.dnsServiceFactory(config.dns);
      const results = await dnsService.syncServiceRewrites(target.server, dnsServices);

      await eventBus.emit(APPLY_COMMAND_EVENTS.dnsSyncSuccess, {
        target: {
          server: target.server,
          services: dnsServices,
        },
        results,
      });

      return results;
    } catch (error) {
      await eventBus.emit(APPLY_COMMAND_EVENTS.dnsSyncFailed, {
        target: {
          server: target.server,
          services: dnsServices,
        },
        error,
      });
      throw error;
    }
  }

  private getDnsServicesForTarget(target: ApplyTarget): ServiceEntry[] {
    return target.services.filter(
      (service: ServiceEntry) =>
        service.dns?.from_publish === "caddy" && service.publish.caddy?.via === target.server.id,
    );
  }

  private getCaddyServicesForTarget(target: ApplyTarget): ServiceEntry[] {
    return target.services.filter(
      (service: ServiceEntry) => service.publish.caddy?.via === target.server.id,
    );
  }

  private getCloudflareTunnelServicesForTarget(target: ApplyTarget): ServiceEntry[] {
    return target.services.filter(
      (service: ServiceEntry) => service.publish["cloudflare-tunnel"]?.via === target.server.id,
    );
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
decorate(inject(TYPES.CloudflareTunnelServiceFactory), ApplyCommandRunner, 2);
decorate(inject(TYPES.DnsServiceFactory), ApplyCommandRunner, 3);
