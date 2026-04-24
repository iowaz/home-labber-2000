<div align="center">
  <img src="./logo-en2.png" alt="Home Labber 2000 logo" width="380" />

  <h1>home-lab-machine-syncer</h1>

  <p>
    <strong>Config-driven homelab publication sync for Caddy, Cloudflare Tunnels, and DNS.</strong>
  </p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-Strict%20Mode-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript badge" />
    <img src="https://img.shields.io/badge/Node.js-ESM%20CLI-5FA04E?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js badge" />
    <img src="https://img.shields.io/badge/Caddy-API%20Sync-1F88C0?style=for-the-badge&logo=caddy&logoColor=white" alt="Caddy badge" />
    <img src="https://img.shields.io/badge/AdGuard%20Home-DNS%20Rewrites-68BC71?style=for-the-badge&logo=adguard&logoColor=white" alt="AdGuard badge" />
    <img src="https://img.shields.io/badge/Cloudflare%20Tunnel-Ingress%20%26%20DNS%20Sync-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Tunnel badge" />
  </p>

  <p>
    <sub>Reusable brand block: <a href="./logo.md">logo.md</a></sub>
  </p>
</div>

> Organize. Protect. Expose. Keep the homelab tidy without hand-editing reverse proxy and DNS rules every time a service moves.

## Overview

**English:** `home-lab-machine-syncer` is a small TypeScript CLI that reads YAML configuration from `config/`, validates it, and syncs homelab service publication data into Caddy API targets, Cloudflare Tunnel ingress, optional Cloudflare public hostname routes, and AdGuard Home DNS rewrites. It is designed to keep service origins, published hostnames, and DNS behavior consistent from one source of truth.

**Português:** `home-lab-machine-syncer` é uma CLI em TypeScript que lê configurações YAML em `config/`, valida a estrutura e sincroniza a publicação dos serviços do homelab com alvos do Caddy API, ingress do Cloudflare Tunnel, rotas públicas opcionais no Cloudflare e reescritas de DNS no AdGuard Home. A ideia é manter origem, hostname publicado e comportamento de DNS alinhados a partir de uma única fonte de verdade.

## How to Configure

The project expects a repo-level `.env` file and a `config/` directory with four YAML files:

```text
.
├── .env
└── config
    ├── cloudflare-tunnels.yaml
    ├── dns.yaml
    ├── servers.yaml
    └── services.yaml
```

### Environment file

The CLI loads `.env` automatically before startup. In the current setup, `dns.yaml` references AdGuard Home credentials and `cloudflare-tunnels.yaml` references the Cloudflare API token through environment variable names such as:

```env
ADGUARD_USERNAME=your-username
ADGUARD_PASSWORD=your-password
CLOUDFLARE_API_TOKEN=your-api-token
```

### Config file map

| File | Purpose |
| --- | --- |
| `config/cloudflare-tunnels.yaml` | Declares the Cloudflare account id, the API token env var name, and whether public hostname routes should also be synced. |
| `config/dns.yaml` | Defines the DNS provider integration, API URL, credential env var names, and rewrite behavior. |
| `config/servers.yaml` | Declares your server inventory, server ids, IPs, descriptions, and publication capabilities like `caddy-api` and `cloudflare-tunnel`. |
| `config/services.yaml` | Declares each service, where it actually runs, how it should be published through Caddy, how it should be published through Cloudflare Tunnel, and whether DNS should follow the Caddy publication target. |

### Expected config shape

`config/cloudflare-tunnels.yaml`

```yaml
account_id: your-cloudflare-account-id
auth:
  api_token_env: CLOUDFLARE_API_TOKEN
options:
  sync_public_dns: true
```

`config/dns.yaml`

```yaml
type: ADGUARD_HOME
api_url: http://192.168.x.x:3001/control
auth:
  username_env: ADGUARD_USERNAME
  password_env: ADGUARD_PASSWORD
options:
  create_dns_rewrites: true
```

`config/servers.yaml`

```yaml
- id: raspberry-pi-5-ethernet
  description: Raspberry Pi 5 (Ethernet)
  ip: 192.168.x.x
  os: caddy-api
  caddy-api:
    url: http://127.0.0.1:2019/
  cloudflare-tunnel:
    tunnel_id: your-tunnel-id
    connector_id: your-connector-id
```

`config/services.yaml`

```yaml
- id: grafana
  description: Grafana dashboards
  origin:
    server: raspberry-pi-5-ethernet
    port: 3110
    healthcheck:
      url_path: /api/health
  publish:
    caddy:
      via: raspberry-pi-5-ethernet
      hostname: grafana.rede.local
    cloudflare-tunnel:
      via: raspberry-pi-5-ethernet
      hostname: grafana.example.com
      path: "*"
  dns:
    from_publish: caddy
```

### Important behavior

- `origin.server` and `origin.port` describe where the app is really running.
- `publish.caddy.via` describes which server should expose that service through Caddy.
- `publish.cloudflare-tunnel.via` describes which server's Cloudflare tunnel should publish that service externally.
- `cloudflare-tunnels.options.sync_public_dns: true` also syncs public Cloudflare hostname routes to the selected tunnel.
- `dns.from_publish: caddy` means DNS rewrites should target the Caddy publish server IP, not the origin server IP.
- `publish.cloudflare-tunnel.path` must be `"*"` or start with `/`.

## How to Use

Install dependencies first:

```bash
npm install
```

Validate your setup without touching live infrastructure:

```bash
npm run apply:dry-run
```

Apply the configuration for real:

```bash
npm run apply
```

Run only for one server:

```bash
npm run apply -- --server raspberry-pi-5-ethernet
```

Simulate a slower flow for CLI UX validation:

```bash
npm run apply -- --slow-running
```

Use a custom config directory:

```bash
npm run apply -- --config ./config
```

Inspect the command help:

```bash
node --experimental-strip-types src/cli.mts apply --help
```

### Operational note

Prefer `npm run apply:dry-run` before a real apply whenever you are changing routing, DNS, or server publication data.

---

<div align="center">
  <strong>Made with Love - Diogo Casteluber</strong>
  <br />
  <a href="https://www.linkedin.com/in/diogo-c-laass/">LinkedIn</a>
  ·
  <a href="https://diogocasteluber.com.br">diogocasteluber.com.br</a>
</div>
