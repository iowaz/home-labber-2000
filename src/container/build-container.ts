import { Container } from "inversify";

import { ApplyCommand } from "../commands/apply-command.ts";
import { ApplyCommandRunner } from "../commands/apply-command-runner.ts";
import { YamlConfigLoader } from "../config/config-loader.ts";
import type { CloudflareTunnelsConfig, ConfigLoader, DnsConfig, ServerEntry } from "../config/types.ts";
import { JsonLockfileStore } from "../lockfile/json-lockfile-store.ts";
import type { LockfileStore } from "../lockfile/types.ts";
import { CaddyService } from "../services/caddy/caddy-service.ts";
import type { CaddyServiceFactory } from "../services/caddy/types.ts";
import { CloudflareTunnelService } from "../services/cloudflare/cloudflare-tunnel-service.ts";
import type { CloudflareTunnelServiceFactory } from "../services/cloudflare/types.ts";
import { AdGuardHomeDnsService } from "../services/dns/adguard-home-dns-service.ts";
import type { DnsServiceFactory } from "../services/dns/types.ts";
import type { HttpTraceLogger } from "../services/http-trace.ts";
import { TYPES } from "./identifiers.ts";

export function buildContainer(defaultConfigDirectory: string, defaultLockfilePath: string): Container {
  const container = new Container();

  container.bind<string>(TYPES.DefaultConfigDirectory).toConstantValue(defaultConfigDirectory);
  container.bind<string>(TYPES.DefaultLockfilePath).toConstantValue(defaultLockfilePath);
  container.bind<ConfigLoader>(TYPES.ConfigLoader).to(YamlConfigLoader).inSingletonScope();
  container.bind<LockfileStore>(TYPES.LockfileStore).to(JsonLockfileStore).inSingletonScope();
  container
    .bind<CaddyServiceFactory>(TYPES.CaddyServiceFactory)
    .toConstantValue(
      (server: ServerEntry, servers: ServerEntry[], httpTraceLogger?: HttpTraceLogger) =>
        new CaddyService(server, servers, httpTraceLogger),
    );
  container
    .bind<CloudflareTunnelServiceFactory>(TYPES.CloudflareTunnelServiceFactory)
    .toConstantValue(
      (
        config: CloudflareTunnelsConfig,
        server: ServerEntry,
        servers: ServerEntry[],
        httpTraceLogger?: HttpTraceLogger,
      ) => new CloudflareTunnelService(config, server, servers, httpTraceLogger),
    );
  container
    .bind<DnsServiceFactory>(TYPES.DnsServiceFactory)
    .toConstantValue(
      (config: DnsConfig, httpTraceLogger?: HttpTraceLogger) =>
        new AdGuardHomeDnsService(config, httpTraceLogger),
    );
  container.bind<ApplyCommandRunner>(TYPES.ApplyCommandRunner).to(ApplyCommandRunner);
  container.bind<ApplyCommand>(TYPES.ApplyCommand).to(ApplyCommand);

  return container;
}
