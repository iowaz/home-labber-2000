import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

import { decorate, injectable } from "inversify";
import { parse } from "yaml";

import type {
  CloudflareTunnelsConfig,
  ConfigLoader,
  DnsConfig,
  HomelabConfig,
  ServerEntry,
  ServiceCaddyPublication,
  ServiceCloudflareTunnelPublication,
  ServiceEntry,
  ServiceOrigin,
} from "./types.ts";

type UnknownRecord = Record<string, unknown>;

const compoundPublicSuffixes = new Set<string>([
  "com.br",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectString(value: unknown, field: string, issues: string[]): string {
  if (typeof value === "string") {
    return value;
  }

  issues.push(`${field} must be a string.`);
  return "";
}

function expectNumber(value: unknown, field: string, issues: string[]): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  issues.push(`${field} must be a number.`);
  return 0;
}

function expectBoolean(value: unknown, field: string, issues: string[]): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  issues.push(`${field} must be a boolean.`);
  return false;
}

function expectOptionalString(value: unknown, field: string, issues: string[]): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  issues.push(`${field} must be a string.`);
  return undefined;
}

function validateHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253) {
    return false;
  }

  const labels: string[] = hostname.split(".");
  return labels.every((label: string) =>
    /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(label),
  );
}

function validateUrlPath(urlPath: string): boolean {
  return urlPath.startsWith("/");
}

function validateCloudflareTunnelPath(value: string): boolean {
  return value === "*" || value.startsWith("/");
}

function isCloudflareUniversalSslCoveredHostname(hostname: string): boolean {
  const labels = hostname.toLowerCase().split(".");
  const publicSuffixLabelCount = compoundPublicSuffixes.has(labels.slice(-2).join(".")) ? 2 : 1;
  const registrableDomainLabelCount = publicSuffixLabelCount + 1;
  const coveredLabelCount = registrableDomainLabelCount + 1;

  return labels.length <= coveredLabelCount;
}

function validateHttpUrl(url: string, field: string, issues: string[]): void {
  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      issues.push(`${field} must use http or https.`);
    }
  } catch {
    issues.push(`${field} must be a valid URL.`);
  }
}

async function parseYamlFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return parse(raw) as unknown;
}

async function parseOptionalYamlFile(filePath: string): Promise<unknown> {
  try {
    return await parseYamlFile(filePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function parseDnsConfig(value: unknown, issues: string[]): DnsConfig {
  if (!isRecord(value)) {
    issues.push("dns.yaml must contain an object.");
    return {
      type: "",
      api_url: "",
      auth: {
        username_env: "",
        password_env: "",
      },
      options: {
        ttl_seconds: 0,
        create_dns_rewrites: false,
      },
    };
  }

  const auth: UnknownRecord = isRecord(value.auth) ? value.auth : {};
  const options: UnknownRecord = isRecord(value.options) ? value.options : {};
  const apiUrl = expectString(value.api_url, "dns.api_url", issues);
  validateHttpUrl(apiUrl, "dns.api_url", issues);

  return {
    type: expectString(value.type, "dns.type", issues),
    api_url: apiUrl,
    auth: {
      username_env: expectString(auth.username_env, "dns.auth.username_env", issues),
      password_env: expectString(auth.password_env, "dns.auth.password_env", issues),
    },
    options: {
      ttl_seconds:
        options.ttl_seconds === undefined
          ? 0
          : expectNumber(options.ttl_seconds, "dns.options.ttl_seconds", issues),
      create_dns_rewrites: expectBoolean(
        options.create_dns_rewrites,
        "dns.options.create_dns_rewrites",
        issues,
      ),
    },
  };
}

function parseCloudflareTunnelsConfig(
  value: unknown,
  issues: string[],
): CloudflareTunnelsConfig {
  if (value === undefined) {
    return {
      account_id: "",
      auth: {
        api_token_env: "CLOUDFLARE_API_TOKEN",
      },
      options: {
        sync_public_dns: true,
      },
    };
  }

  if (!isRecord(value)) {
    issues.push("cloudflare-tunnels.yaml must contain an object.");
    return {
      account_id: "",
      auth: {
        api_token_env: "CLOUDFLARE_API_TOKEN",
      },
      options: {
        sync_public_dns: true,
      },
    };
  }

  const auth: UnknownRecord = isRecord(value.auth) ? value.auth : {};
  const options: UnknownRecord = isRecord(value.options) ? value.options : {};

  return {
    account_id: value.account_id === undefined
      ? ""
      : expectString(value.account_id, "cloudflare-tunnels.account_id", issues),
    auth: {
      api_token_env:
        auth.api_token_env === undefined
          ? "CLOUDFLARE_API_TOKEN"
          : expectString(auth.api_token_env, "cloudflare-tunnels.auth.api_token_env", issues),
    },
    options: {
      sync_public_dns:
        options.sync_public_dns === undefined
          ? true
          : expectBoolean(
              options.sync_public_dns,
              "cloudflare-tunnels.options.sync_public_dns",
              issues,
            ),
    },
  };
}

function parseServers(value: unknown, issues: string[]): ServerEntry[] {
  if (!Array.isArray(value)) {
    issues.push("servers.yaml must contain a list.");
    return [];
  }

  return value.flatMap((entry: unknown, index: number): ServerEntry[] => {
    if (!isRecord(entry)) {
      issues.push(`servers[${index}] must be an object.`);
      return [];
    }

    const server: ServerEntry = {
      id: expectString(entry.id, `servers[${index}].id`, issues),
      ip: expectString(entry.ip, `servers[${index}].ip`, issues),
      os: expectString(entry.os, `servers[${index}].os`, issues),
      description: expectString(entry.description, `servers[${index}].description`, issues),
    };

    if (server.ip && isIP(server.ip) === 0) {
      issues.push(`servers[${index}].ip must be a valid IP address.`);
    }

    const caddyApi = isRecord(entry["caddy-api"]) ? entry["caddy-api"] : undefined;
    if (caddyApi) {
      const url = expectString(caddyApi.url, `servers[${index}].caddy-api.url`, issues);
      validateHttpUrl(url, `servers[${index}].caddy-api.url`, issues);
      server["caddy-api"] = { url };
    }

    const cloudflareTunnel = isRecord(entry["cloudflare-tunnel"])
      ? entry["cloudflare-tunnel"]
      : undefined;
    if (cloudflareTunnel) {
      const tunnelId = expectOptionalString(
        cloudflareTunnel.tunnel_id,
        `servers[${index}].cloudflare-tunnel.tunnel_id`,
        issues,
      );
      if (!tunnelId) {
        issues.push(`servers[${index}].cloudflare-tunnel.tunnel_id is required.`);
      }

      server["cloudflare-tunnel"] = {
        connector_id: expectOptionalString(
          cloudflareTunnel.connector_id,
          `servers[${index}].cloudflare-tunnel.connector_id`,
          issues,
        ),
        tunnel_id: tunnelId,
      };
    }

    const caddy = isRecord(entry.caddy) ? entry.caddy : undefined;
    if (caddy) {
      server.caddy = {
        caddyfile_path: expectString(
          caddy.caddyfile_path,
          `servers[${index}].caddy.caddyfile_path`,
          issues,
        ),
        reload_command: expectString(
          caddy.reload_command,
          `servers[${index}].caddy.reload_command`,
          issues,
        ),
      };
    }

    const ssh = isRecord(entry.ssh) ? entry.ssh : undefined;
    if (ssh) {
      server.ssh = {
        user: expectString(ssh.user, `servers[${index}].ssh.user`, issues),
        private_key_path:
          typeof ssh.private_key_path === "string" ? ssh.private_key_path : undefined,
        port: typeof ssh.port === "number" && Number.isFinite(ssh.port) ? ssh.port : undefined,
      };
    }

    const winrm = isRecord(entry.winrm) ? entry.winrm : undefined;
    if (winrm) {
      server.winrm = {
        user: expectString(winrm.user, `servers[${index}].winrm.user`, issues),
        password_file: expectString(
          winrm.password_file,
          `servers[${index}].winrm.password_file`,
          issues,
        ),
        port: expectNumber(winrm.port, `servers[${index}].winrm.port`, issues),
        transport: expectString(winrm.transport, `servers[${index}].winrm.transport`, issues),
      };
    }

    return [server];
  });
}

function parseServices(value: unknown, issues: string[]): ServiceEntry[] {
  if (!Array.isArray(value)) {
    issues.push("services.yaml must contain a list.");
    return [];
  }

  return value.flatMap((entry: unknown, index: number): ServiceEntry[] => {
    if (!isRecord(entry)) {
      issues.push(`services[${index}] must be an object.`);
      return [];
    }

    const originRecord = isRecord(entry.origin) ? entry.origin : undefined;
    if (!originRecord) {
      issues.push(`services[${index}].origin must be an object.`);
      return [];
    }

    const origin: ServiceOrigin = {
      server: expectString(originRecord.server, `services[${index}].origin.server`, issues),
      port: expectNumber(originRecord.port, `services[${index}].origin.port`, issues),
    };

    if (!Number.isInteger(origin.port) || origin.port < 1 || origin.port > 65535) {
      issues.push(`services[${index}].origin.port must be an integer between 1 and 65535.`);
    }

    const healthcheck = isRecord(originRecord.healthcheck) ? originRecord.healthcheck : undefined;
    if (healthcheck) {
      const urlPath = expectString(
        healthcheck.url_path,
        `services[${index}].origin.healthcheck.url_path`,
        issues,
      );
      if (!validateUrlPath(urlPath)) {
        issues.push(`services[${index}].origin.healthcheck.url_path must start with '/'.`);
      }
      origin.healthcheck = { url_path: urlPath };
    }

    const publishRecord = isRecord(entry.publish) ? entry.publish : undefined;
    if (!publishRecord) {
      issues.push(`services[${index}].publish must be an object.`);
      return [];
    }

    const service: ServiceEntry = {
      id: expectString(entry.id, `services[${index}].id`, issues),
      description: expectString(entry.description, `services[${index}].description`, issues),
      origin,
      publish: {},
    };

    const caddyPublish = isRecord(publishRecord.caddy) ? publishRecord.caddy : undefined;
    if (caddyPublish) {
      const hostname = expectString(
        caddyPublish.hostname,
        `services[${index}].publish.caddy.hostname`,
        issues,
      );
      if (!validateHostname(hostname)) {
        issues.push(`services[${index}].publish.caddy.hostname must be a valid hostname.`);
      }

      const publication: ServiceCaddyPublication = {
        via: expectString(caddyPublish.via, `services[${index}].publish.caddy.via`, issues),
        hostname,
      };

      if (caddyPublish.aliases !== undefined) {
        if (!Array.isArray(caddyPublish.aliases)) {
          issues.push(`services[${index}].publish.caddy.aliases must be a list.`);
        } else {
          const aliases = caddyPublish.aliases.map((alias: unknown, aliasIndex: number): string =>
            expectString(alias, `services[${index}].publish.caddy.aliases[${aliasIndex}]`, issues),
          );
          publication.aliases = aliases;

          for (const alias of aliases) {
            if (!validateHostname(alias)) {
              issues.push(
                `services[${index}].publish.caddy.aliases contains an invalid hostname: ${alias}`,
              );
            }
          }
        }
      }

      service.publish.caddy = publication;
    }

    const cloudflareTunnel = isRecord(publishRecord["cloudflare-tunnel"])
      ? publishRecord["cloudflare-tunnel"]
      : undefined;
    if (cloudflareTunnel) {
      const hostname = expectString(
        cloudflareTunnel.hostname,
        `services[${index}].publish.cloudflare-tunnel.hostname`,
        issues,
      );
      if (!validateHostname(hostname)) {
        issues.push(
          `services[${index}].publish.cloudflare-tunnel.hostname must be a valid hostname.`,
        );
      } else if (!isCloudflareUniversalSslCoveredHostname(hostname)) {
        issues.push(
          `services[${index}].publish.cloudflare-tunnel.hostname '${hostname}' is too deep for default Cloudflare Universal SSL coverage. Use a one-label public hostname such as service.diogocasteluber.com.br or service-mac.diogocasteluber.com.br, or provision matching edge certificate coverage before adding nested hostnames.`,
        );
      }

      const publication: ServiceCloudflareTunnelPublication = {
        via: expectString(
          cloudflareTunnel.via,
          `services[${index}].publish.cloudflare-tunnel.via`,
          issues,
        ),
        hostname,
      };

      if (cloudflareTunnel.path !== undefined) {
        publication.path = expectString(
          cloudflareTunnel.path,
          `services[${index}].publish.cloudflare-tunnel.path`,
          issues,
        );
        if (
          publication.path.length === 0 ||
          !validateCloudflareTunnelPath(publication.path)
        ) {
          issues.push(
            `services[${index}].publish.cloudflare-tunnel.path must be '*' or start with '/'.`,
          );
        }
      }

      service.publish["cloudflare-tunnel"] = publication;
    }

    if (!service.publish.caddy && !service.publish["cloudflare-tunnel"]) {
      issues.push(`services[${index}].publish must define at least one publication.`);
    }

    const dnsRecord = isRecord(entry.dns) ? entry.dns : undefined;
    if (dnsRecord) {
      const fromPublish = expectString(
        dnsRecord.from_publish,
        `services[${index}].dns.from_publish`,
        issues,
      );
      if (fromPublish !== "caddy") {
        issues.push(`services[${index}].dns.from_publish must be 'caddy'.`);
      } else {
        service.dns = {
          from_publish: "caddy",
        };
      }
    }

    return [service];
  });
}

function validateReferences(config: HomelabConfig, issues: string[]): void {
  const serverIds = new Set<string>();
  const serversById = new Map<string, ServerEntry>();
  const serviceIds = new Set<string>();
  const hostnames = new Set<string>();
  const cloudflareHostnames = new Map<string, string>();

  for (const server of config.servers) {
    if (serverIds.has(server.id)) {
      issues.push(`Duplicate server id found: ${server.id}`);
    }
    serverIds.add(server.id);
    serversById.set(server.id, server);
  }

  for (const service of config.services) {
    if (serviceIds.has(service.id)) {
      issues.push(`Duplicate service id found: ${service.id}`);
    }
    serviceIds.add(service.id);

    if (!serverIds.has(service.origin.server)) {
      issues.push(`services.${service.id} references unknown origin server '${service.origin.server}'.`);
    }

    const caddyPublication = service.publish.caddy;
    if (caddyPublication) {
      if (!serverIds.has(caddyPublication.via)) {
        issues.push(`services.${service.id} references unknown caddy publish server '${caddyPublication.via}'.`);
      } else if (!serversById.get(caddyPublication.via)?.["caddy-api"]?.url) {
        issues.push(
          `services.${service.id} references caddy publish server '${caddyPublication.via}' without caddy-api.url.`,
        );
      }

      const names: string[] = [caddyPublication.hostname, ...(caddyPublication.aliases ?? [])];
      for (const hostname of names) {
        if (hostnames.has(hostname)) {
          issues.push(`Duplicate hostname found: ${hostname}`);
        }
        hostnames.add(hostname);
      }
    }

    const cloudflareTunnelPublication = service.publish["cloudflare-tunnel"];
    if (cloudflareTunnelPublication) {
      if (!serverIds.has(cloudflareTunnelPublication.via)) {
        issues.push(
          `services.${service.id} references unknown cloudflare tunnel publish server '${cloudflareTunnelPublication.via}'.`,
        );
      } else if (!serversById.get(cloudflareTunnelPublication.via)?.["cloudflare-tunnel"]) {
        issues.push(
          `services.${service.id} references cloudflare tunnel publish server '${cloudflareTunnelPublication.via}' without cloudflare-tunnel config.`,
        );
      }

      const existingCloudflareServiceId = cloudflareHostnames.get(cloudflareTunnelPublication.hostname);
      if (existingCloudflareServiceId) {
        issues.push(
          `services.${service.id} reuses Cloudflare Tunnel hostname '${cloudflareTunnelPublication.hostname}' already used by services.${existingCloudflareServiceId}. Multiple services cannot share publish.cloudflare-tunnel.hostname, even with different paths.`,
        );
      } else {
        cloudflareHostnames.set(cloudflareTunnelPublication.hostname, service.id);
      }

      if (hostnames.has(cloudflareTunnelPublication.hostname)) {
        issues.push(`Duplicate hostname found: ${cloudflareTunnelPublication.hostname}`);
      }
      hostnames.add(cloudflareTunnelPublication.hostname);
    }

    if (service.dns?.from_publish === "caddy" && !caddyPublication) {
      issues.push(`services.${service.id} dns.from_publish references missing caddy publication.`);
    }
  }
}

export class YamlConfigLoader implements ConfigLoader {
  public async load(configDirectory: string): Promise<HomelabConfig> {
    const dnsPath = path.join(configDirectory, "dns.yaml");
    const cloudflareTunnelsPath = path.join(configDirectory, "cloudflare-tunnels.yaml");
    const serversPath = path.join(configDirectory, "servers.yaml");
    const servicesPath = path.join(configDirectory, "services.yaml");

    const [dnsRaw, cloudflareTunnelsRaw, serversRaw, servicesRaw] = await Promise.all([
      parseYamlFile(dnsPath),
      parseOptionalYamlFile(cloudflareTunnelsPath),
      parseYamlFile(serversPath),
      parseYamlFile(servicesPath),
    ]);

    const issues: string[] = [];
    const config: HomelabConfig = {
      dns: parseDnsConfig(dnsRaw, issues),
      cloudflareTunnels: parseCloudflareTunnelsConfig(cloudflareTunnelsRaw, issues),
      servers: parseServers(serversRaw, issues),
      services: parseServices(servicesRaw, issues),
    };

    validateReferences(config, issues);

    if (issues.length > 0) {
      throw new Error(`Invalid config:\n- ${issues.join("\n- ")}`);
    }

    return config;
  }
}

decorate(injectable(), YamlConfigLoader);
