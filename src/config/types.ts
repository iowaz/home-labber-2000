export interface DnsConfig {
  type: string;
  api_url: string;
  auth: {
    username_env: string;
    password_env: string;
  };
  options: {
    ttl_seconds: number;
    create_dns_rewrites: boolean;
  };
}

export interface CloudflareTunnelsConfig {
  account_id: string;
  auth: {
    api_token_env: string;
  };
  options: {
    sync_public_dns: boolean;
  };
}

export interface ServerEntry {
  id: string;
  ip: string;
  os: string;
  description: string;
  "cloudflare-tunnel"?: {
    connector_id?: string;
    tunnel_id?: string;
  };
  "caddy-api"?: {
    url: string;
  };
  caddy?: {
    caddyfile_path: string;
    reload_command: string;
  };
  ssh?: {
    user: string;
    private_key_path?: string;
    port?: number;
  };
  winrm?: {
    user: string;
    password_file: string;
    port: number;
    transport: string;
  };
}

export interface ServiceOrigin {
  server: string;
  port: number;
  healthcheck?: {
    url_path: string;
  };
}

export interface ServiceCaddyPublication {
  via: string;
  hostname: string;
  aliases?: string[];
}

export interface ServiceCloudflareTunnelPublication {
  via: string;
  hostname: string;
  path?: string;
}

export interface ServiceEntry {
  id: string;
  description: string;
  origin: ServiceOrigin;
  publish: {
    caddy?: ServiceCaddyPublication;
    "cloudflare-tunnel"?: ServiceCloudflareTunnelPublication;
  };
  dns?: {
    from_publish: "caddy";
  };
}

export interface HomelabConfig {
  dns: DnsConfig;
  cloudflareTunnels: CloudflareTunnelsConfig;
  servers: ServerEntry[];
  services: ServiceEntry[];
}

export interface ConfigLoader {
  load(configDirectory: string): Promise<HomelabConfig>;
}
