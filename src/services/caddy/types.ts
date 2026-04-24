import type { ServerEntry, ServiceEntry } from "../../config/types.ts";
import type { CaddyService } from "./caddy-service.ts";

export interface CaddyRoute {
  match: Array<{
    host: string[];
  }>;
  handle: Array<{
    handler: "reverse_proxy";
    upstreams: Array<{
      dial: string;
    }>;
  }>;
}

export interface CaddyConfigPayload {
  admin: {
    listen: string;
  };
  apps: {
    http: {
      servers: Record<
        string,
        {
          listen: string[];
          routes: CaddyRoute[];
        }
      >;
    };
  };
}

export interface CaddyApplyResult {
  statusCode: number;
  body: string;
  transport: "ky" | "native";
}

export interface CaddyApplyTarget {
  server: ServerEntry;
  services: ServiceEntry[];
}

export type CaddyServiceFactory = (server: ServerEntry, servers: ServerEntry[]) => CaddyService;
