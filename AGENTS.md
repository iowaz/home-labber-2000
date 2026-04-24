# Codex Instructions for `home-lab-machine-syncer`

## Mission
- Work as a pragmatic maintainer for this repository.
- Optimize for safe changes, quick validation, and low-friction future sessions.
- Prefer shipping small, correct improvements over broad speculative refactors.

## Project Snapshot
- This is a TypeScript CLI project running in Node with ESM enabled.
- Entry point: `src/cli.mts`.
- Main command today: `apply`.
- The repository is intended to be published with conventional commit messages.
- Current npm scripts:
  - `npm run apply`
  - `npm run apply:dry-run`
- The `apply` command also supports `--slow-running` to inject a 700ms delay between work steps for CLI UX validation.
- Environment variables are loaded from the repo-root `.env` before CLI startup.
- Keep `.env` untracked and maintain a scrubbed `.env.sample` whenever environment variables change.
- Config is loaded from YAML files in `config/`:
  - `config/dns.yaml`
  - `config/servers.yaml`
  - `config/services.yaml`
- `servers.yaml` may declare provider-specific publication capabilities such as `caddy-api` and `cloudflare-tunnel.connector_id`.
- `services.yaml` now models each service with `origin`, `publish`, and optional `dns` sections:
  - `origin.server` and `origin.port` describe where the app actually runs.
  - `publish.caddy` describes the internal Caddy publication target and hostname(s).
  - `publish.cloudflare-tunnel` is config-only preparation for future external publication sync and is not applied yet.
  - `dns.from_publish: caddy` means AdGuard should point the Caddy hostname at the Caddy publish server IP.
- Dependency injection is wired in `src/container/build-container.ts`.
- The `apply` flow is split between `src/commands/apply-command.ts` (Commander registration), `src/commands/apply-command-runner.ts` (execution flow), and `src/commands/apply-command-reporter.ts` (CLI output), with typed lifecycle events defined in `src/commands/apply-command-types.ts`.
- Caddy payload/application logic lives in `src/services/caddy/`.
- AdGuard Home DNS rewrite sync logic lives in `src/services/dns/`.

## Working Style For This Repo
- Before changing code, quickly inspect the impacted command, service, and config types instead of guessing.
- Favor minimal diffs that preserve the existing architecture and naming conventions.
- Keep TypeScript strictness intact.
- Prefer explicit types when they improve readability in non-trivial logic.
- Preserve the current ESM + `.ts`/`.mts` import style.
- Reuse the container/service pattern rather than introducing one-off wiring.

## Validation Defaults
- For behavior that affects live infra, prefer validating with `npm run apply:dry-run` before suggesting or attempting a real apply.
- If a change affects config parsing or validation, inspect `src/config/config-loader.ts` and the related types first.
- If a change affects routing/payload generation, inspect `src/services/caddy/caddy-service.ts` first.
- If a change affects DNS rewrite sync, inspect `config/dns.yaml` and `src/services/dns/` first.
- When adding a new feature, also consider the safest local verification path and document it in the final response.

## Config Expectations
- Treat YAML validation as a first-class concern, not an afterthought.
- Preserve clear error messages when config is invalid.
- Keep references consistent across `servers.yaml` and `services.yaml`.
- Be careful with hostname, port, URL, and server-reference validation because these are core safety rails for the project.
- `servers.yaml` and `services.yaml` should include a human-friendly `description` string for operator-facing CLI output.
- DNS rewrites should map each service `publish.caddy.hostname` to the IP of `publish.caddy.via`, not to the origin server IP, because DNS should route clients into the reverse proxy layer.

## Efficiency Rules For Future Sessions
- Start by checking whether the request touches CLI registration, config loading, DI wiring, or Caddy service behavior.
- Prefer targeted reads with `rg` and small file slices instead of scanning the whole repository.
- Suggest the smallest useful verification command after changes.
- Avoid unnecessary dependency additions and avoid introducing new frameworks unless clearly justified.
- When the request is ambiguous, infer the most likely project-consistent path from the existing structure.

## Maintenance Rule For These Instructions
- On every meaningful project change, consider whether this instruction file should also be updated.
- Update these instructions when commands, workflows, architecture, validation rules, or important conventions change.
- If you notice repeated prompt/session friction, add a concise rule here to prevent that friction next time.
- Treat this file as living project memory that should evolve with the codebase.
