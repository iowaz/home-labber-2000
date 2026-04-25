export const TYPES = {
  ApplyCommand: Symbol.for("ApplyCommand"),
  ApplyCommandRunner: Symbol.for("ApplyCommandRunner"),
  ConfigLoader: Symbol.for("ConfigLoader"),
  CaddyServiceFactory: Symbol.for("CaddyServiceFactory"),
  CloudflareTunnelServiceFactory: Symbol.for("CloudflareTunnelServiceFactory"),
  DnsServiceFactory: Symbol.for("DnsServiceFactory"),
  DefaultConfigDirectory: Symbol.for("DefaultConfigDirectory"),
  DefaultLockfilePath: Symbol.for("DefaultLockfilePath"),
  LockfileStore: Symbol.for("LockfileStore"),
} as const;
