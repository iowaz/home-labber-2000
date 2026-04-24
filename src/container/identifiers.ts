export const TYPES = {
  ApplyCommand: Symbol.for("ApplyCommand"),
  ApplyCommandRunner: Symbol.for("ApplyCommandRunner"),
  ConfigLoader: Symbol.for("ConfigLoader"),
  CaddyServiceFactory: Symbol.for("CaddyServiceFactory"),
  DnsServiceFactory: Symbol.for("DnsServiceFactory"),
  DefaultConfigDirectory: Symbol.for("DefaultConfigDirectory"),
} as const;
