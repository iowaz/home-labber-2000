<!--
Sync Impact Report
Version change: template -> 1.0.0
Modified principles:
- template principle 1 -> I. Maintainable TypeScript Architecture
- template principle 2 -> II. Configuration Safety Is Product Safety
- template principle 3 -> III. Behavior Is Proven With Tests
- template principle 4 -> IV. Consistent Operator Experience
- template principle 5 -> V. Performance and Reliability Budgets
Added sections:
- Project Constraints
- Delivery Workflow
Removed sections:
- None
Templates requiring updates:
- updated .specify/templates/plan-template.md
- updated .specify/templates/spec-template.md
- updated .specify/templates/tasks-template.md
- reviewed .specify/templates/checklist-template.md
- reviewed .specify/templates/constitution-template.md
- no .specify/templates/commands directory present
Runtime guidance:
- updated AGENTS.md
- reviewed README.md
- reviewed tests/e2e/README.md
Follow-up TODOs:
- None
-->
# home-lab-machine-syncer Constitution

## Core Principles

### I. Maintainable TypeScript Architecture
Production code MUST preserve the existing strict TypeScript, Node ESM, and dependency injection
patterns. New behavior MUST fit the current command, container, config, and service boundaries unless
the implementation plan explicitly justifies a narrower, safer change to those boundaries. YAML parsing,
HTTP payload generation, lockfile handling, and provider clients MUST use typed structures instead of
ad hoc string manipulation. Rationale: this CLI can change live routing and DNS state, so maintainable
types and small architecture-preserving diffs are safety controls.

### II. Configuration Safety Is Product Safety
Configuration changes MUST validate references, hostnames, ports, URLs, credentials, and provider
capabilities before any remote write is attempted. Error messages MUST identify the invalid file,
field, and safe-to-print value. Environment variable changes MUST update `.env.sample` with
scrubbed names, and managed state changes MUST preserve `homelab.lock.json` semantics. Rationale:
the repository is the source of truth for homelab publication state, and bad config must fail before it
can affect Caddy, Cloudflare, AdGuard, or the lockfile.

### III. Behavior Is Proven With Tests
Every change that affects CLI apply behavior, config loading, validation, provider payloads, DNS
rewrites, Cloudflare Tunnel publication, Caddy publication, lockfile skip/update behavior, or user-visible
output MUST include focused automated coverage unless the implementation plan records why testing is
not feasible. E2E coverage with local fixtures is REQUIRED for behavior that would otherwise touch live
infrastructure. Tests MUST be runnable with repository scripts, and the safest relevant validation command
MUST be reported with the change. Rationale: local fixtures give confidence in operator-visible behavior
without writing to production infrastructure.

### IV. Consistent Operator Experience
CLI output MUST remain predictable, readable, and action-oriented. Apply reporter output MUST keep every
log line prefixed by its operation label, aggregate unchanged per-resource results, and lead service rows
with the trimmed service description. New flags, errors, and progress states MUST be consistent with the
existing Commander and reporter style, and user-facing wording MUST avoid leaking secrets or unsanitized
HTTP details. Rationale: operators use this tool during infrastructure changes, so consistency and
sanitization reduce mistakes.

### V. Performance and Reliability Budgets
The apply flow MUST avoid unnecessary remote calls by respecting dry-run behavior, lockfile no-op skips,
target filtering, and stale-resource reconciliation from the union of config and lockfile servers. New
work loops MUST stay deterministic, bounded by the selected targets and managed resources, and resilient
to per-provider failures with clear reporting. Any feature expected to add network calls or large config
processing MUST define a performance budget in the plan and include validation evidence. Rationale:
homelab automation MUST stay fast enough for routine use and reliable enough for unattended self-hosted
runner execution.

## Project Constraints

This project is a TypeScript CLI running on Node with ESM enabled. Implementations MUST preserve strict
typing, the `.ts`/`.mts` import style, the existing container/service wiring, and the repository scripts
used for apply and E2E validation. Live infrastructure writes MUST NOT be used as the default validation
path; dry-run and local fixture tests are the expected safety baseline. Secrets MUST remain outside git,
and diagnostic output MUST redact credentials, tokens, and authorization headers.

Configuration is loaded from YAML under `config/`, with repo-root `.env` values loaded before CLI startup.
Changes to `servers.yaml`, `services.yaml`, `dns.yaml`, or `cloudflare-tunnels.yaml` semantics MUST keep
cross-file references consistent and update documentation or examples that describe the accepted shape.
DNS rewrites MUST map published Caddy hostnames to the Caddy publication server IP, not the origin server
IP, unless a future constitution amendment changes that model.

## Delivery Workflow

Plans MUST complete the Constitution Check before Phase 0 research and repeat it after Phase 1 design.
The check MUST cover code quality, configuration safety, required tests, operator experience, and
performance or reliability impact. Tasks MUST be grouped so each user story remains independently
implementable and testable, with test tasks appearing before implementation tasks for behavior changes.

Pull requests and local changes MUST include the smallest useful verification evidence. For live-infra
behavior this normally means `npm run test:e2e` and, when appropriate, `npm run apply:dry-run`. Any
exception to required testing, dry-run validation, or performance evidence MUST be documented in the plan
or final change summary with a concrete reason and residual risk.

## Governance

This constitution supersedes conflicting project guidance for feature planning and delivery. Amendments
MUST update this file, include a Sync Impact Report, propagate required changes to Spec Kit templates and
runtime guidance, and explain the semantic version bump. Principle removals or incompatible redefinitions
require a MAJOR version bump. New principles, new mandatory sections, or materially expanded governance
require a MINOR version bump. Clarifications and wording-only changes require a PATCH version bump.

Compliance review is required during planning, task generation, implementation review, and final reporting.
Reviewers and maintainers MUST verify that code quality, testing, user experience consistency, and
performance or reliability requirements are either satisfied or explicitly justified before a change is
considered complete.

**Version**: 1.0.0 | **Ratified**: 2026-05-01 | **Last Amended**: 2026-05-01
