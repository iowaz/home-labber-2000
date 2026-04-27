import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { decorate, injectable } from "inversify";

import type {
  HomelabLockfile,
  LoadLockfileOptions,
  LockfileStore,
  ManagedCaddyServerState,
  ManagedCloudflareTunnelServerState,
  ManagedDnsServerState,
} from "./types.ts";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function isCloudflareDnsRecordId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/i.test(value);
}

function normalizeCaddyState(value: unknown): Record<string, ManagedCaddyServerState> {
  if (!isRecord(value)) {
    return {};
  }

  return sortRecord(
    Object.fromEntries(
      Object.entries(value)
        .filter(([, serverState]) => isRecord(serverState))
        .map(([serverId, serverState]): [string, ManagedCaddyServerState] => {
          const services = isRecord(serverState.services) ? serverState.services : {};

          return [
            serverId,
            {
              adminUrl: typeof serverState.adminUrl === "string" ? serverState.adminUrl : "",
              payloadHash: typeof serverState.payloadHash === "string" ? serverState.payloadHash : "",
              services: sortRecord(
                Object.fromEntries(
                  Object.entries(services)
                    .filter(([, serviceState]) => isRecord(serviceState))
                    .map(([serviceId, serviceState]) => [
                      serviceId,
                      {
                        hostnames: Array.isArray(serviceState.hostnames)
                          ? serviceState.hostnames.filter(
                              (hostname: unknown): hostname is string => typeof hostname === "string",
                            )
                          : [],
                        upstream:
                          typeof serviceState.upstream === "string" ? serviceState.upstream : "",
                      },
                    ]),
                ),
              ),
            },
          ];
        }),
    ),
  );
}

function normalizeCloudflareState(
  value: unknown,
): Record<string, ManagedCloudflareTunnelServerState> {
  if (!isRecord(value)) {
    return {};
  }

  return sortRecord(
    Object.fromEntries(
      Object.entries(value)
        .filter(([, serverState]) => isRecord(serverState))
        .map(([serverId, serverState]): [string, ManagedCloudflareTunnelServerState] => {
          const ingress = isRecord(serverState.ingress) ? serverState.ingress : {};
          const publicDns = isRecord(serverState.publicDns) ? serverState.publicDns : {};

          return [
            serverId,
            {
              tunnelId: typeof serverState.tunnelId === "string" ? serverState.tunnelId : "",
              ingress: sortRecord(
                Object.fromEntries(
                  Object.entries(ingress)
                    .filter(([, ingressState]) => isRecord(ingressState))
                    .map(([serviceId, ingressState]) => [
                      serviceId,
                      {
                        hostname:
                          typeof ingressState.hostname === "string" ? ingressState.hostname : "",
                        path: typeof ingressState.path === "string" ? ingressState.path : undefined,
                        service: typeof ingressState.service === "string" ? ingressState.service : "",
                      },
                    ]),
                ),
              ),
              publicDns: sortRecord(
                Object.fromEntries(
                  Object.entries(publicDns)
                    .filter(([, routeState]) => isRecord(routeState))
                    .map(([serviceId, routeState]) => [
                      serviceId,
                      {
                        hostname: typeof routeState.hostname === "string" ? routeState.hostname : "",
                        tunnelId: typeof routeState.tunnelId === "string" ? routeState.tunnelId : "",
                        zoneId: typeof routeState.zoneId === "string" ? routeState.zoneId : undefined,
                        recordId:
                          typeof routeState.recordId === "string"
                            ? routeState.recordId
                            : isCloudflareDnsRecordId(routeState.routeId)
                              ? routeState.routeId
                              : undefined,
                      },
                    ]),
                ),
              ),
            },
          ];
        }),
    ),
  );
}

function normalizeDnsState(value: unknown): Record<string, ManagedDnsServerState> {
  if (!isRecord(value)) {
    return {};
  }

  return sortRecord(
    Object.fromEntries(
      Object.entries(value)
        .filter(([, serverState]) => isRecord(serverState))
        .map(([serverId, serverState]): [string, ManagedDnsServerState] => {
          const services = isRecord(serverState.services) ? serverState.services : {};

          return [
            serverId,
            {
              provider: "ADGUARD_HOME",
              services: sortRecord(
                Object.fromEntries(
                  Object.entries(services)
                    .filter(([, serviceState]) => isRecord(serviceState))
                    .map(([serviceId, serviceState]) => [
                      serviceId,
                      {
                        domains: Array.isArray(serviceState.domains)
                          ? [...new Set(serviceState.domains.filter((domain): domain is string => typeof domain === "string"))].sort((left, right) =>
                              left.localeCompare(right),
                            )
                          : typeof serviceState.domain === "string"
                            ? [serviceState.domain]
                            : [],
                        answer: typeof serviceState.answer === "string" ? serviceState.answer : "",
                      },
                    ]),
                ),
              ),
            },
          ];
        }),
    ),
  );
}

function normalizeLockfile(value: unknown): HomelabLockfile {
  if (!isRecord(value)) {
    throw new Error("Lockfile must contain a JSON object.");
  }

  if (value.version !== 1) {
    throw new Error(`Unsupported lockfile version '${String(value.version)}'.`);
  }

  return {
    version: 1,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    caddy: normalizeCaddyState(value.caddy),
    cloudflareTunnel: normalizeCloudflareState(value.cloudflareTunnel),
    dns: normalizeDnsState(value.dns),
  };
}

export class JsonLockfileStore implements LockfileStore {
  public createEmpty(): HomelabLockfile {
    return {
      version: 1,
      updatedAt: "",
      caddy: {},
      cloudflareTunnel: {},
      dns: {},
    };
  }

  public async load(
    lockfilePath: string,
    options?: LoadLockfileOptions,
  ): Promise<HomelabLockfile> {
    try {
      const raw = await readFile(lockfilePath, "utf8");
      return normalizeLockfile(JSON.parse(raw) as unknown);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        return this.createEmpty();
      }

      if (options?.ignoreInvalidFile) {
        return this.createEmpty();
      }

      if (error instanceof SyntaxError) {
        throw new Error(`Lockfile '${lockfilePath}' contains invalid JSON.`);
      }

      if (error instanceof Error) {
        throw new Error(`Failed to load lockfile '${lockfilePath}': ${error.message}`);
      }

      throw error;
    }
  }

  public async save(lockfilePath: string, lockfile: HomelabLockfile): Promise<void> {
    const directory = path.dirname(lockfilePath);
    const tempPath = `${lockfilePath}.tmp`;
    const nextLockfile: HomelabLockfile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      caddy: sortRecord(lockfile.caddy),
      cloudflareTunnel: sortRecord(lockfile.cloudflareTunnel),
      dns: sortRecord(lockfile.dns),
    };

    await mkdir(directory, { recursive: true });
    await writeFile(tempPath, `${JSON.stringify(nextLockfile, null, 2)}\n`, "utf8");
    await rename(tempPath, lockfilePath);
  }
}

decorate(injectable(), JsonLockfileStore);
