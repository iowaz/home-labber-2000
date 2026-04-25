import type { ServerEntry, ServiceEntry } from "../config/types.ts";
import type { HomelabLockfile } from "../lockfile/types.ts";
import type { ApplyTarget } from "./apply-command-types.ts";

export function resolveApplyTargets(
  servers: ServerEntry[],
  services: ServiceEntry[],
  lockfile: HomelabLockfile,
  requestedServerId?: string,
): ApplyTarget[] {
  const serversById = new Map<string, ServerEntry>(
    servers.map((server: ServerEntry): [string, ServerEntry] => [server.id, server]),
  );
  const requestedServerIds = requestedServerId
    ? [requestedServerId]
    : resolveTargetServerIds(servers, lockfile);

  if (
    requestedServerId &&
    !serversById.has(requestedServerId) &&
    !hasManagedLockState(lockfile, requestedServerId)
  ) {
    throw new Error(`Server '${requestedServerId}' was not found in config or lockfile.`);
  }

  return requestedServerIds
    .map((serverId: string): ApplyTarget => {
      const server = serversById.get(serverId) ?? createLockfileCleanupServer(serverId, lockfile);
      return {
        server,
        services: services.filter(
          (service: ServiceEntry) =>
            service.publish.caddy?.via === server.id ||
            service.publish["cloudflare-tunnel"]?.via === server.id,
        ),
      };
    })
    .filter(
      (target: ApplyTarget) =>
        target.services.length > 0 || hasManagedLockState(lockfile, target.server.id),
    );
}

export function getDnsServicesForTarget(target: ApplyTarget): ServiceEntry[] {
  return target.services.filter(
    (service: ServiceEntry) =>
      service.dns?.from_publish === "caddy" && service.publish.caddy?.via === target.server.id,
  );
}

export function getCaddyServicesForTarget(target: ApplyTarget): ServiceEntry[] {
  return target.services.filter(
    (service: ServiceEntry) => service.publish.caddy?.via === target.server.id,
  );
}

export function getCloudflareTunnelServicesForTarget(target: ApplyTarget): ServiceEntry[] {
  return target.services.filter(
    (service: ServiceEntry) => service.publish["cloudflare-tunnel"]?.via === target.server.id,
  );
}

function hasManagedLockState(lockfile: HomelabLockfile, serverId: string): boolean {
  return Boolean(
    lockfile.caddy[serverId] || lockfile.cloudflareTunnel[serverId] || lockfile.dns[serverId],
  );
}

function resolveTargetServerIds(servers: ServerEntry[], lockfile: HomelabLockfile): string[] {
  const configServerIds = servers.map((server: ServerEntry) => server.id);
  const lockfileOnlyServerIds = [
    ...new Set<string>([
      ...Object.keys(lockfile.caddy),
      ...Object.keys(lockfile.cloudflareTunnel),
      ...Object.keys(lockfile.dns),
    ]),
  ]
    .filter((serverId: string) => !configServerIds.includes(serverId))
    .sort((left: string, right: string) => left.localeCompare(right));

  return [...configServerIds, ...lockfileOnlyServerIds];
}

function createLockfileCleanupServer(lockfileServerId: string, lockfile: HomelabLockfile): ServerEntry {
  const caddyState = lockfile.caddy[lockfileServerId];
  const cloudflareState = lockfile.cloudflareTunnel[lockfileServerId];

  return {
    id: lockfileServerId,
    ip: "0.0.0.0",
    os: "lockfile-cleanup",
    description: "Removed from config; applying lockfile cleanup",
    "caddy-api": caddyState
      ? {
          url: caddyState.adminUrl,
        }
      : undefined,
    "cloudflare-tunnel": cloudflareState
      ? {
          tunnel_id: cloudflareState.tunnelId,
        }
      : undefined,
  };
}
