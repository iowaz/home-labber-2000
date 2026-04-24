<div align="center">
  <img src="./logo-en.png" alt="Home Labber 2000 logo" width="380" />

  <h1>home-lab-machine-syncer</h1>

  <p>
    <strong>Config-driven homelab publication sync for Caddy and local DNS.</strong>
  </p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-Strict%20Mode-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript badge" />
    <img src="https://img.shields.io/badge/Node.js-ESM%20CLI-5FA04E?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js badge" />
    <img src="https://img.shields.io/badge/Caddy-API%20Sync-1F88C0?style=for-the-badge&logo=caddy&logoColor=white" alt="Caddy badge" />
    <img src="https://img.shields.io/badge/AdGuard%20Home-DNS%20Rewrites-68BC71?style=for-the-badge&logo=adguard&logoColor=white" alt="AdGuard badge" />
    <img src="https://img.shields.io/badge/Cloudflare%20Tunnel-TBD-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Cloudflare Tunnel TBD badge" />
  </p>

  <p>
    <sub>Reusable brand block: <a href="./logo.md">logo.md</a></sub>
  </p>
</div>

> Organize. Protect. Expose. Keep the homelab tidy without hand-editing reverse proxy and DNS rules every time a service moves.

## Overview

**English:** `home-lab-machine-syncer` is a small TypeScript CLI that reads YAML configuration from `config/`, validates it, and syncs homelab service publication data into Caddy API targets plus AdGuard Home DNS rewrites. It is designed to keep service origins, published hostnames, and local DNS behavior consistent from one source of truth.

**Português:** `home-lab-machine-syncer` é uma CLI em TypeScript que lê configurações YAML em `config/`, valida a estrutura e sincroniza a publicação dos serviços do homelab com alvos do Caddy API e reescritas de DNS no AdGuard Home. A ideia é manter origem, hostname publicado e comportamento de DNS local alinhados a partir de uma única fonte de verdade.

> `Cloudflare Tunnel` support is currently modeled in config, but real publication sync is still `TBD`.

## How to Configure

The project expects a repo-level `.env` file and a `config/` directory with three YAML files:

```text
.
├── .env
└── config
    ├── dns.yaml
    ├── servers.yaml
    └── services.yaml
```

### Environment file

The CLI loads `.env` automatically before startup. In the current setup, `dns.yaml` references AdGuard Home credentials through environment variable names such as:

```env
ADGUARD_USERNAME=your-username
ADGUARD_PASSWORD=your-password
```

### Config file map

| File | Purpose |
| --- | --- |
| `config/dns.yaml` | Defines the DNS provider integration, API URL, credential env var names, and rewrite behavior. |
| `config/servers.yaml` | Declares your server inventory, server ids, IPs, descriptions, and publication capabilities like `caddy-api` and `cloudflare-tunnel` (`TBD`). |
| `config/services.yaml` | Declares each service, where it actually runs, how it should be published through Caddy, optional Cloudflare Tunnel metadata (`TBD`), and whether DNS should follow the Caddy publication target. |

### Expected config shape

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
    connector_id: your-connector-id # TBD
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
      path: "*" # TBD
  dns:
    from_publish: caddy
```

### Important behavior

- `origin.server` and `origin.port` describe where the app is really running.
- `publish.caddy.via` describes which server should expose that service through Caddy.
- `dns.from_publish: caddy` means DNS rewrites should target the Caddy publish server IP, not the origin server IP.
- `cloudflare-tunnel` entries are configuration-only today and should be treated as `TBD` for live sync behavior.

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
