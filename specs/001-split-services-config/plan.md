# Implementation Plan: Split Services Configuration

**Branch**: `001-split-services-config` | **Date**: 2026-05-01 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-split-services-config/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Allow the service catalog to be declared either as the existing `config/services.yaml` file or as a `config/services/` folder containing multiple direct YAML files. The config loader will discover exactly one active service source, parse every service through the existing typed service parser, aggregate split files deterministically, reject ambiguous or duplicate declarations before remote writes, and preserve apply/lockfile behavior because downstream code still receives the same `ServiceEntry[]` catalog.

The current repository config will be migrated to folder files as part of implementation:

- `config/services/media.yaml`: Jellyfin, Sonarr, Radarr, Readarr, Prowlarr, Bazarr, FlareSolverr
- `config/services/downloads.yaml`: Transmission, Flood, qBittorrent, qBittorrent exporter
- `config/services/observability.yaml`: Grafana, Prometheus, Node Exporter
- `config/services/network.yaml`: AdGuard Home admin interface, AdGuard Home DNS

## Technical Context

**Language/Version**: TypeScript on Node.js with ESM and `--experimental-strip-types`  
**Primary Dependencies**: Commander, Inversify, ky, yaml, cli-progress, ora, chalk, Node `fs/promises` and `path`  
**Storage**: YAML config files under `config/` and repo-root `homelab.lock.json` lockfile  
**Testing**: Node's built-in test runner via `npm run test:e2e`; production-like dry-run via `npm run apply:dry-run`; final operator-approved real apply via `npm run apply`  
**Target Platform**: Local CLI and self-hosted GitHub Actions runner on trusted LAN  
**Project Type**: Single TypeScript CLI  
**Performance Goals**: Loading split service files adds only local filesystem reads and must complete within 250ms for 50 direct YAML files on a typical developer machine; no additional remote calls are introduced.  
**Constraints**: Strict TypeScript, ESM imports, no live infra writes during default validation, sanitized output, lockfile no-op skips, bounded target/resource loops, and no new runtime dependencies.  
**Scale/Scope**: Current config has 3 servers and 16 services. The implementation should comfortably support at least 50 direct service YAML files and 250 services while keeping service aggregation deterministic.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: PASS. The plan keeps the existing CLI/container/service boundaries. The config loader remains the single source for YAML parsing and typed `HomelabConfig` creation.
- **Configuration Safety**: PASS. The loader will reject ambiguous layouts, invalid folder contents, duplicate service IDs, and existing reference/hostname/port errors before any apply step can perform remote writes or lockfile updates.
- **Testing Standards**: PASS. E2E tests will cover single-file compatibility, split-folder loading, ambiguous layout failure, duplicate ID failure, invalid reference failure, real apply fixture behavior, and lockfile no-op behavior.
- **Operator Experience**: PASS. No new CLI flags or reporter states are required. Existing config error wording will be extended with file-aware context while preserving operation-label output after successful loads.
- **Performance and Reliability**: PASS. The feature adds bounded local file discovery only. Remote call behavior, dry-run behavior, target filtering, stale cleanup, and lockfile skip logic stay downstream of the same aggregated service catalog.

## Project Structure

### Documentation (this feature)

```text
specs/001-split-services-config/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── service-config-layout.md
└── tasks.md
```

### Source Code (repository root)

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

src/
├── config/
│   ├── config-loader.ts
│   └── types.ts
├── commands/
├── container/
├── services/
└── cli.mts

tests/
└── e2e/
    └── apply-command.e2e.mts

README.md
AGENTS.md
```

**Structure Decision**: Keep the existing single CLI project structure. Implement the behavior in the current config loader, migrate the repository's service declarations from `config/services.yaml` to direct files under `config/services/`, update README/AGENTS config documentation, and extend the existing E2E suite rather than adding a new test harness.

## Phase 0: Research

Completed in [research.md](research.md). Key decisions:

- Use `config/services.yaml` or direct YAML files in `config/services/` as mutually exclusive layouts.
- Sort direct service files by relative path before parsing to make aggregation deterministic.
- Keep the service schema unchanged and reuse the existing parser for each file.
- Fail before remote writes for ambiguous layouts, empty folder layout, non-list YAML, duplicate IDs, or existing reference errors.
- Verify lockfile behavior through local fixture real applies and a final operator-approved production apply.

## Phase 1: Design and Contracts

Completed artifacts:

- [data-model.md](data-model.md)
- [contracts/service-config-layout.md](contracts/service-config-layout.md)
- [quickstart.md](quickstart.md)

Post-design Constitution Check:

- **Code Quality**: PASS. The design avoids new framework/dependency changes and keeps split-file discovery inside the config boundary.
- **Configuration Safety**: PASS. The contract requires file-aware validation and confirms invalid config fails before lockfile writes.
- **Testing Standards**: PASS. The quickstart and task plan require fixture E2E, dry-run, real apply, and lockfile checks.
- **Operator Experience**: PASS. Errors name the layout/file context; successful apply output remains unchanged except the existing config-loaded summary can still report the config directory and service count.
- **Performance and Reliability**: PASS. No additional provider calls are introduced, deterministic file ordering prevents order-dependent churn, and lockfile state remains keyed by service ID/server/provider state rather than source path.

## Phase 2: Planning Notes

The next `/speckit-tasks` phase should generate tasks in this order:

1. Add E2E tests for single-file compatibility and split-folder loading.
2. Add E2E tests for ambiguous layout, empty folder, non-list split file, duplicate IDs, and invalid references.
3. Add E2E coverage proving a real fixture apply from split files writes the expected Caddy/DNS lockfile state, then a second apply skips via unchanged lockfile.
4. Implement service source discovery and deterministic aggregation in `src/config/config-loader.ts`.
5. Migrate the repository services into the four planned `config/services/*.yaml` files and remove `config/services.yaml`.
6. Update README and AGENTS documentation for the accepted layouts.
7. Run `npm run test:e2e`, `npm run apply:dry-run`, `git diff -- homelab.lock.json`, then the operator-approved `npm run apply` and a final `git diff -- homelab.lock.json`.

## Complexity Tracking

No Constitution Check violations require justification.
