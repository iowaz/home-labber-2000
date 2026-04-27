export interface ManagedCaddyServiceState {
  hostnames: string[];
  upstream: string;
}

export interface ManagedCaddyServerState {
  adminUrl: string;
  payloadHash: string;
  services: Record<string, ManagedCaddyServiceState>;
}

export interface ManagedCloudflareIngressState {
  hostname: string;
  path?: string;
  service: string;
}

export interface ManagedCloudflarePublicDnsState {
  hostname: string;
  tunnelId: string;
  zoneId?: string;
  recordId?: string;
}

export interface ManagedCloudflareTunnelServerState {
  tunnelId: string;
  ingress: Record<string, ManagedCloudflareIngressState>;
  publicDns: Record<string, ManagedCloudflarePublicDnsState>;
}

export interface ManagedDnsServiceState {
  domains: string[];
  answer: string;
}

export interface ManagedDnsServerState {
  provider: "ADGUARD_HOME";
  services: Record<string, ManagedDnsServiceState>;
}

export interface HomelabLockfile {
  version: 1;
  updatedAt: string;
  caddy: Record<string, ManagedCaddyServerState>;
  cloudflareTunnel: Record<string, ManagedCloudflareTunnelServerState>;
  dns: Record<string, ManagedDnsServerState>;
}

export interface LoadLockfileOptions {
  ignoreInvalidFile?: boolean;
}

export interface LockfileStore {
  createEmpty(): HomelabLockfile;
  load(lockfilePath: string, options?: LoadLockfileOptions): Promise<HomelabLockfile>;
  save(lockfilePath: string, lockfile: HomelabLockfile): Promise<void>;
}
