# Contract: Service Configuration Layout

## Accepted Layouts

### Single File

```text
config/
├── cloudflare-tunnels.yaml
├── dns.yaml
├── servers.yaml
└── services.yaml
```

`config/services.yaml` contains a YAML list of service declarations.

### Folder

```text
config/
├── cloudflare-tunnels.yaml
├── dns.yaml
├── servers.yaml
└── services/
    ├── downloads.yaml
    ├── media.yaml
    ├── network.yaml
    └── observability.yaml
```

Each direct `.yaml` or `.yml` file in `config/services/` contains a YAML list of service declarations using the same schema as the single-file layout.

## Rejected Layouts

- Both `config/services.yaml` and `config/services/` exist.
- Neither `config/services.yaml` nor `config/services/` exists.
- `config/services/` exists but contains no direct `.yaml` or `.yml` files.
- A service file contains anything other than a YAML list.
- More than one service declaration uses the same `id`.

## Folder File Ordering

The loader reads service files in deterministic path order. Operators may rename or reorder files for readability, but service identity and managed behavior are based on service IDs and service content, not file names.

## Service Schema

The service object schema is unchanged:

```yaml
- id: jellyfin
  description: Jellyfin Media Server
  origin:
    server: nucbox
    port: 8096
    healthcheck:
      url_path: /
  publish:
    caddy:
      via: nucbox
      hostname: jellyfin.rede.local
    cloudflare-tunnel:
      via: nucbox
      hostname: jellyfin.diogocasteluber.com.br
      path: "*"
  dns:
    from_publish: caddy
```

## Error Behavior

- Invalid layouts fail before remote provider writes and before lockfile updates.
- Split-file parse errors identify the file path.
- Per-entry schema errors identify the file path and service index when the service ID is unavailable.
- Cross-reference errors identify the service ID and invalid server/hostname/publish value.

## Migration Contract

The repository's current services will be split as:

```text
config/services/media.yaml
  jellyfin, sonarr, radarr, readarr, prowlarr, bazarr, flaresolverr

config/services/downloads.yaml
  transmission, flood, qbittorrent, qbittorrent-exporter

config/services/observability.yaml
  grafana, prometheus, node-exporter

config/services/network.yaml
  adguardhome, adguard
```

No service ID, origin, publish hostname, alias, DNS setting, or Cloudflare setting should change during migration.
