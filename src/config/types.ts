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

export interface ServerEntry {
  id: string;
  ip: string;
  os: string;
  description: string;
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

export interface ServiceEntry {
  id: string;
  domain: string;
  description: string;
  aliases?: string[];
  server: string;
  ip_override?: string;
  port: number;
  healthcheck?: {
    url_path: string;
  };
}

export interface HomelabConfig {
  dns: DnsConfig;
  servers: ServerEntry[];
  services: ServiceEntry[];
}

export interface ConfigLoader {
  load(configDirectory: string): Promise<HomelabConfig>;
}
