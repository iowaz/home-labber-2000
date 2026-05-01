# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript on Node.js with ESM and `--experimental-strip-types`  
**Primary Dependencies**: Commander, Inversify, ky, yaml, cli-progress, ora, chalk  
**Storage**: YAML config files and repo-root `homelab.lock.json` lockfile  
**Testing**: Node's built-in test runner via `npm run test:e2e`  
**Target Platform**: Local CLI and self-hosted GitHub Actions runner on trusted LAN  
**Project Type**: Single TypeScript CLI  
**Performance Goals**: [target apply/dry-run duration, remote call budget, or NEEDS CLARIFICATION]  
**Constraints**: Strict TypeScript, ESM imports, no live infra writes during default validation,
sanitized output, lockfile no-op skips, bounded target/resource loops  
**Scale/Scope**: [number of servers, services, managed DNS records/routes, or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Code Quality**: Does the design preserve strict TypeScript, ESM imports, existing command/container/service
  boundaries, and typed config/provider data structures?
- **Configuration Safety**: Are YAML validation, cross-file references, hostnames, ports, URLs, credentials,
  provider capabilities, and lockfile semantics handled before remote writes?
- **Testing Standards**: Are automated tests planned for CLI behavior, config validation, provider payloads,
  DNS/Cloudflare/Caddy sync, lockfile behavior, and user-visible output changes? If not, is the exception
  documented with residual risk?
- **Operator Experience**: Does CLI output keep operation labels, aggregated unchanged results, service
  descriptions, consistent flag/error wording, and secret-safe diagnostics?
- **Performance and Reliability**: Are dry-run behavior, no-op skips, target filtering, stale-resource cleanup,
  remote call budgets, and provider failure reporting preserved or improved?

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── commands/
├── config/
├── container/
├── services/
└── cli.mts

tests/
└── e2e/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
