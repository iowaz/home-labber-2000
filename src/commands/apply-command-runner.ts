import { decorate, inject, injectable } from "inversify";
import { setTimeout as delay } from "node:timers/promises";

import type { ConfigLoader, HomelabConfig } from "../config/types.ts";
import { TYPES } from "../container/identifiers.ts";
import type { HomelabLockfile, LockfileStore, ManagedCloudflareTunnelServerState } from "../lockfile/types.ts";
import type { CaddyServiceFactory } from "../services/caddy/types.ts";
import type { CloudflareTunnelServiceFactory } from "../services/cloudflare/types.ts";
import type { DnsRewriteSyncResult, DnsServiceFactory } from "../services/dns/types.ts";
import {
  getCaddyServicesForTarget,
  getCloudflareTunnelServicesForTarget,
  getDnsServicesForTarget,
  resolveApplyTargets,
} from "./apply-command-targets.ts";
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
  private readonly lockfileStore: LockfileStore;

  public constructor(
    configLoader: ConfigLoader,
    caddyServiceFactory: CaddyServiceFactory,
    cloudflareTunnelServiceFactory: CloudflareTunnelServiceFactory,
    dnsServiceFactory: DnsServiceFactory,
    lockfileStore: LockfileStore,
  ) {
    this.configLoader = configLoader;
    this.caddyServiceFactory = caddyServiceFactory;
    this.cloudflareTunnelServiceFactory = cloudflareTunnelServiceFactory;
    this.dnsServiceFactory = dnsServiceFactory;
    this.lockfileStore = lockfileStore;
  }

  public async run(options: ApplyOptions, eventBus: ApplyCommandEventBus): Promise<void> {
    await eventBus.emit(APPLY_COMMAND_EVENTS.configLoadStart, {
      configDirectory: options.config,
    });

    await this.delayIfSlowRunning(options.slowRunning);
    const config = await this.configLoader.load(options.config);
    const lockfile = await this.lockfileStore.load(options.lockfile, {
      ignoreInvalidFile: Boolean(options.recreateLockfile),
    });

    await eventBus.emit(APPLY_COMMAND_EVENTS.configLoaded, {
      config,
      configDirectory: options.config,
    });

    const targets = resolveApplyTargets(config.servers, config.services, lockfile, options.server);
    if (targets.length === 0) {
      throw new Error("No published services matched the selected server scope.");
    }

    await eventBus.emit(APPLY_COMMAND_EVENTS.targetsResolved, {
      targets,
    });

    let processedTargets = 0;

    for (const target of targets) {
      await this.applyTarget(target, config, lockfile, options, eventBus);
      processedTargets += 1;
    }

    await eventBus.emit(APPLY_COMMAND_EVENTS.completed, {
      processedTargets,
      dryRun: Boolean(options.dryRun),
    });
  }

  private async applyTarget(
    target: ApplyTarget,
    config: HomelabConfig,
    lockfile: HomelabLockfile,
    options: ApplyOptions,
    eventBus: ApplyCommandEventBus,
  ): Promise<void> {
    const caddyServices = getCaddyServicesForTarget(target);
    if (caddyServices.length > 0 || lockfile.caddy[target.server.id]) {
      await this.syncCaddy(
        {
          server: target.server,
          services: caddyServices,
        },
        config,
        lockfile,
        options,
        eventBus,
      );
    }

    const cloudflareServices = getCloudflareTunnelServicesForTarget(target);
    if (cloudflareServices.length > 0 || lockfile.cloudflareTunnel[target.server.id]) {
      await this.syncCloudflareTunnel(
        {
          server: target.server,
          services: cloudflareServices,
        },
        config,
        lockfile,
        options,
        eventBus,
      );
    }

    await this.syncDnsRewrites(target, config, lockfile, options, eventBus);
  }

  private async syncCaddy(
    target: ApplyTarget,
    config: HomelabConfig,
    lockfile: HomelabLockfile,
    options: ApplyOptions,
    eventBus: ApplyCommandEventBus,
  ): Promise<void> {
    await eventBus.emit(APPLY_COMMAND_EVENTS.caddySyncStart, {
      target,
    });

    try {
      const caddyService = this.caddyServiceFactory(target.server, config.servers);
      const loadUrl = caddyService.getLoadUrl();
      const desiredState = caddyService.buildManagedState(target.services);
      const previousState = lockfile.caddy[target.server.id];

      if (options.dryRun) {
        caddyService.buildConfigPayload(target.services);
        await eventBus.emit(APPLY_COMMAND_EVENTS.caddyDryRun, {
          target,
          loadUrl,
        });
        return;
      }

      if (!options.recreateLockfile && previousState && this.jsonEquals(previousState, desiredState)) {
        await eventBus.emit(APPLY_COMMAND_EVENTS.caddySyncSkipped, {
          target,
          reason: "lockfile unchanged",
        });
        return;
      }

      await this.delayIfSlowRunning(options.slowRunning);
      const response = await caddyService.apply(target.services);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw new Error(`Request to ${loadUrl} failed with ${response.statusCode}.\n${response.body}`);
      }

      this.updateCaddyLockState(lockfile, target.server.id, desiredState);
      await this.persistLockfile(options.lockfile, lockfile);

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
    lockfile: HomelabLockfile,
    options: ApplyOptions,
    eventBus: ApplyCommandEventBus,
  ): Promise<void> {
    await eventBus.emit(APPLY_COMMAND_EVENTS.cloudflareSyncStart, {
      target,
      publicDnsEnabled: config.cloudflareTunnels.options.sync_public_dns,
    });

    try {
      const cloudflareService = this.cloudflareTunnelServiceFactory(
        config.cloudflareTunnels,
        target.server,
        config.servers,
      );
      const previousState = lockfile.cloudflareTunnel[target.server.id];
      const desiredState = cloudflareService.buildManagedState(target.services, previousState);

      if (options.dryRun) {
        await eventBus.emit(APPLY_COMMAND_EVENTS.cloudflareDryRun, {
          target,
          publicDnsEnabled: config.cloudflareTunnels.options.sync_public_dns,
        });
        return;
      }

      if (
        !options.recreateLockfile &&
        previousState &&
        this.cloudflareStateEquals(
          previousState,
          desiredState,
          config.cloudflareTunnels.options.sync_public_dns,
        )
      ) {
        await eventBus.emit(APPLY_COMMAND_EVENTS.cloudflareSyncSkipped, {
          target,
          reason: "lockfile unchanged",
        });
        return;
      }

      await this.delayIfSlowRunning(options.slowRunning);
      const result = await cloudflareService.syncPublishedApplications(
        target.services,
        previousState,
        (progress) => {
          return eventBus.emit(APPLY_COMMAND_EVENTS.cloudflareSyncProgress, {
            target,
            progress,
          });
        },
      );
      this.updateCloudflareLockState(lockfile, target.server.id, result.lockState);
      await this.persistLockfile(options.lockfile, lockfile);

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
    lockfile: HomelabLockfile,
    options: ApplyOptions,
    eventBus: ApplyCommandEventBus,
  ): Promise<DnsRewriteSyncResult[]> {
    if (!config.dns.options.create_dns_rewrites) {
      return [];
    }

    const dnsServices = getDnsServicesForTarget(target);
    const previousState = lockfile.dns[target.server.id];
    if (dnsServices.length === 0 && !previousState) {
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
      const dnsService = this.dnsServiceFactory(config.dns);
      const desiredState = dnsService.buildManagedState(target.server, dnsServices);

      if (!options.recreateLockfile && previousState && this.jsonEquals(previousState, desiredState)) {
        await eventBus.emit(APPLY_COMMAND_EVENTS.dnsSyncSkipped, {
          target: {
            server: target.server,
            services: dnsServices,
          },
          reason: "lockfile unchanged",
        });
        return [];
      }

      await this.delayIfSlowRunning(options.slowRunning);
      const dnsTarget = {
        server: target.server,
        services: dnsServices,
      };
      const result = await dnsService.syncServiceRewrites(
        target.server,
        dnsServices,
        previousState,
        (rewriteResult) => {
          return eventBus.emit(APPLY_COMMAND_EVENTS.dnsSyncProgress, {
            target: dnsTarget,
            result: rewriteResult,
          });
        },
      );
      this.updateDnsLockState(lockfile, target.server.id, result.lockState);
      await this.persistLockfile(options.lockfile, lockfile);

      await eventBus.emit(APPLY_COMMAND_EVENTS.dnsSyncSuccess, {
        target: {
          server: target.server,
          services: dnsServices,
        },
        results: result.results,
      });

      return result.results;
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

  private updateCaddyLockState(
    lockfile: HomelabLockfile,
    serverId: string,
    nextState: HomelabLockfile["caddy"][string],
  ): void {
    if (Object.keys(nextState.services).length === 0) {
      delete lockfile.caddy[serverId];
      return;
    }

    lockfile.caddy[serverId] = nextState;
  }

  private updateCloudflareLockState(
    lockfile: HomelabLockfile,
    serverId: string,
    nextState: ManagedCloudflareTunnelServerState,
  ): void {
    if (Object.keys(nextState.ingress).length === 0 && Object.keys(nextState.publicDns).length === 0) {
      delete lockfile.cloudflareTunnel[serverId];
      return;
    }

    lockfile.cloudflareTunnel[serverId] = nextState;
  }

  private updateDnsLockState(
    lockfile: HomelabLockfile,
    serverId: string,
    nextState: HomelabLockfile["dns"][string],
  ): void {
    if (Object.keys(nextState.services).length === 0) {
      delete lockfile.dns[serverId];
      return;
    }

    lockfile.dns[serverId] = nextState;
  }

  private cloudflareStateEquals(
    left: ManagedCloudflareTunnelServerState,
    right: ManagedCloudflareTunnelServerState,
    publicDnsEnabled: boolean,
  ): boolean {
    const normalizePublicDns = (state: ManagedCloudflareTunnelServerState) =>
      Object.fromEntries(
        Object.entries(state.publicDns)
          .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
          .map(([serviceId, routeState]) => [
            serviceId,
            {
              hostname: routeState.hostname,
              tunnelId: routeState.tunnelId,
            },
          ]),
      );

    return this.jsonEquals(
      {
        tunnelId: left.tunnelId,
        ingress: left.ingress,
        publicDns: publicDnsEnabled ? normalizePublicDns(left) : undefined,
      },
      {
        tunnelId: right.tunnelId,
        ingress: right.ingress,
        publicDns: publicDnsEnabled ? normalizePublicDns(right) : undefined,
      },
    );
  }

  private jsonEquals(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private async persistLockfile(lockfilePath: string, lockfile: HomelabLockfile): Promise<void> {
    await this.lockfileStore.save(lockfilePath, lockfile);
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
decorate(inject(TYPES.LockfileStore), ApplyCommandRunner, 4);
