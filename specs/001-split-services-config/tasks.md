# Tasks: Split Services Configuration

**Input**: Design documents from `/specs/001-split-services-config/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/service-config-layout.md, quickstart.md

**Tests**: Required by the specification and constitution because this feature changes config loading, apply behavior, and lockfile safety.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other marked tasks because it touches different files or only reads/verifies state
- **[Story]**: Which user story this task belongs to: US1, US2, US3, US4
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the current config and test harness details before behavior changes.

- [ ] T001 Review current service IDs in `config/services.yaml` against the migration contract in `specs/001-split-services-config/contracts/service-config-layout.md`
- [ ] T002 Review current config parsing and validation boundaries in `src/config/config-loader.ts`
- [ ] T003 Review current E2E helper patterns for config file writing, apply execution, and lockfile assertions in `tests/e2e/apply-command.e2e.mts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Prepare shared config-loader structure used by all stories.

**CRITICAL**: No user story implementation can begin until this phase is complete.

- [ ] T004 Add internal service source metadata types for single-file and folder layouts in `src/config/config-loader.ts`
- [ ] T005 Add direct YAML service-file discovery helpers for `services.yaml` and `services/` in `src/config/config-loader.ts`
- [ ] T006 Refactor service parsing diagnostics in `src/config/config-loader.ts` so parsed service files can report a source label while preserving existing single-file wording

**Checkpoint**: Foundation ready - user story implementation can now begin.

---

## Phase 3: User Story 1 - Keep Existing Single File Working (Priority: P1) MVP

**Goal**: Preserve current `config/services.yaml` behavior without requiring migration.

**Independent Test**: Use the existing E2E single-file fixture and confirm apply still loads one service, writes expected Caddy/DNS state, and skips a second apply from unchanged lockfile.

### Tests for User Story 1

- [ ] T007 [US1] Add or update E2E assertions for single-file service loading in `tests/e2e/apply-command.e2e.mts`
- [ ] T008 [US1] Add or update E2E assertions that a second single-file apply skips Caddy and DNS calls via unchanged lockfile in `tests/e2e/apply-command.e2e.mts`

### Implementation for User Story 1

- [ ] T009 [US1] Implement single-file service source selection in `src/config/config-loader.ts`
- [ ] T010 [US1] Ensure `YamlConfigLoader.load` still parses `config/services.yaml` into the same `HomelabConfig.services` array in `src/config/config-loader.ts`
- [ ] T011 [US1] Run the single-file focused E2E path with `npm run test:e2e` using `package.json`

**Checkpoint**: User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Organize Services Across Folder Files (Priority: P1)

**Goal**: Allow operators to replace `config/services.yaml` with direct YAML files under `config/services/`.

**Independent Test**: Split E2E services across folder files and confirm all services are aggregated exactly once with deterministic apply intent.

### Tests for User Story 2

- [ ] T012 [US2] Add E2E coverage for loading multiple direct YAML files from `config/services/` in `tests/e2e/apply-command.e2e.mts`
- [ ] T013 [US2] Add E2E coverage proving split service file rename/order does not change apply intent or lockfile state in `tests/e2e/apply-command.e2e.mts`
- [ ] T014 [US2] Add E2E coverage that non-YAML files in `config/services/` are ignored in `tests/e2e/apply-command.e2e.mts`

### Implementation for User Story 2

- [ ] T015 [US2] Implement folder service source selection and deterministic direct-file sorting in `src/config/config-loader.ts`
- [ ] T016 [US2] Aggregate parsed services from all split files into one `HomelabConfig.services` array in `src/config/config-loader.ts`
- [ ] T017 [US2] Ensure `.yaml` and `.yml` split files are accepted and nested directories are not loaded in `src/config/config-loader.ts`
- [ ] T018 [US2] Run split-folder focused E2E coverage with `npm run test:e2e` using `package.json`

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Migrate Current Repository Config Safely (Priority: P2)

**Goal**: Move the repository's current services into the planned folder layout and prove real apply and lockfile behavior.

**Independent Test**: Run automated E2E tests, production dry-run, inspect `homelab.lock.json`, run operator-approved real apply, then inspect `homelab.lock.json` again for path-only churn.

### Tests for User Story 3

- [ ] T019 [US3] Add E2E coverage proving split-folder real fixture apply writes expected Caddy and DNS lockfile state in `tests/e2e/apply-command.e2e.mts`
- [ ] T020 [US3] Add E2E coverage proving a second split-folder fixture apply skips provider calls via unchanged lockfile in `tests/e2e/apply-command.e2e.mts`

### Implementation for User Story 3

- [ ] T021 [P] [US3] Create `config/services/media.yaml` with Jellyfin, Sonarr, Radarr, Readarr, Prowlarr, Bazarr, and FlareSolverr entries from `config/services.yaml`
- [ ] T022 [P] [US3] Create `config/services/downloads.yaml` with Transmission, Flood, qBittorrent, and qBittorrent exporter entries from `config/services.yaml`
- [ ] T023 [P] [US3] Create `config/services/observability.yaml` with Grafana, Prometheus, and Node Exporter entries from `config/services.yaml`
- [ ] T024 [P] [US3] Create `config/services/network.yaml` with AdGuard Home admin interface and AdGuard Home DNS entries from `config/services.yaml`
- [ ] T025 [US3] Remove the migrated single-file source `config/services.yaml`
- [ ] T026 [US3] Verify migrated service IDs, hostnames, aliases, origins, publish settings, and DNS settings against `specs/001-split-services-config/contracts/service-config-layout.md`
- [ ] T027 [US3] Run full E2E validation with `npm run test:e2e` using `package.json`
- [ ] T028 [US3] Run production dry-run validation with `npm run apply:dry-run` using `package.json`
- [ ] T029 [US3] Inspect dry-run managed-state safety with `git diff -- homelab.lock.json` against `homelab.lock.json`
- [ ] T030 [US3] Run operator-approved real apply with `npm run apply` using `package.json`
- [ ] T031 [US3] Inspect post-apply lockfile behavior with `git diff -- homelab.lock.json` against `homelab.lock.json`

**Checkpoint**: The repository uses the split folder layout and lockfile behavior has been verified.

---

## Phase 6: User Story 4 - Diagnose Invalid Split Config Clearly (Priority: P3)

**Goal**: Fail invalid layouts and split-file config errors before remote writes or lockfile updates, with actionable messages.

**Independent Test**: Create invalid E2E configs and confirm the CLI exits non-zero, reports the failing layout/file/service context, and does not create or update the lockfile.

### Tests for User Story 4

- [ ] T032 [US4] Add E2E coverage rejecting both `services.yaml` and `services/` existing together in `tests/e2e/apply-command.e2e.mts`
- [ ] T033 [US4] Add E2E coverage rejecting a missing service source and an empty `services/` folder in `tests/e2e/apply-command.e2e.mts`
- [ ] T034 [US4] Add E2E coverage rejecting a split service file that does not contain a YAML list in `tests/e2e/apply-command.e2e.mts`
- [ ] T035 [US4] Add E2E coverage rejecting duplicate service IDs across split files in `tests/e2e/apply-command.e2e.mts`
- [ ] T036 [US4] Add E2E coverage rejecting split-file services with unknown server references before lockfile creation in `tests/e2e/apply-command.e2e.mts`

### Implementation for User Story 4

- [ ] T037 [US4] Implement mutually exclusive layout validation errors in `src/config/config-loader.ts`
- [ ] T038 [US4] Implement missing-source and empty-folder validation errors in `src/config/config-loader.ts`
- [ ] T039 [US4] Implement non-list split-file validation errors with file path context in `src/config/config-loader.ts`
- [ ] T040 [US4] Implement duplicate service ID diagnostics with split-file context in `src/config/config-loader.ts`
- [ ] T041 [US4] Ensure invalid split config exits before remote writes and lockfile updates in `src/config/config-loader.ts`
- [ ] T042 [US4] Run invalid-config E2E coverage with `npm run test:e2e` using `package.json`

**Checkpoint**: Invalid split configuration is safely rejected and diagnosable.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, maintainability, and final verification across all stories.

- [ ] T043 [P] Update accepted service layout documentation in `README.md`
- [ ] T044 [P] Update project memory for `config/services.yaml` or `config/services/` support in `AGENTS.md`
- [ ] T045 [P] Update E2E testing notes for split service fixtures and lockfile validation in `tests/e2e/README.md`
- [ ] T046 Review `src/config/config-loader.ts` for strict TypeScript, ESM import style, deterministic sorting, and small helper boundaries
- [ ] T047 Run full E2E suite with `npm run test:e2e` using `package.json`
- [ ] T048 Run final production dry-run with `npm run apply:dry-run` using `package.json`
- [ ] T049 Inspect final dry-run lockfile state with `git diff -- homelab.lock.json` against `homelab.lock.json`
- [ ] T050 Run final operator-approved real apply with `npm run apply` using `package.json`
- [ ] T051 Inspect final post-apply lockfile state with `git diff -- homelab.lock.json` against `homelab.lock.json`
- [ ] T052 Confirm no unresolved Spec Kit template markers remain in `specs/001-split-services-config/tasks.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion and blocks all user stories.
- **User Stories (Phase 3+)**: Depend on Foundational completion.
- **Polish (Phase 7)**: Depends on desired user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Starts after Foundational and is the MVP compatibility slice.
- **User Story 2 (P1)**: Starts after Foundational and can be implemented after or alongside US1, but must not break US1.
- **User Story 3 (P2)**: Depends on US2 because repository migration requires folder loading.
- **User Story 4 (P3)**: Starts after Foundational and can be implemented alongside US1/US2, but final invalid-layout checks should be validated after folder loading exists.

### Within Each User Story

- Write or update E2E tests before implementation.
- Implement config-loader behavior before migrating repository config.
- Run story-specific validation before moving to the next priority.
- For live infrastructure validation, run dry-run before real apply and inspect `homelab.lock.json` before and after real apply.

---

## Parallel Opportunities

- T021, T022, T023, and T024 can run in parallel because they create separate migration files.
- T043, T044, and T045 can run in parallel because they update separate documentation files.
- US4 test tasks T032 through T036 can be drafted in parallel conceptually, but they all edit `tests/e2e/apply-command.e2e.mts`, so coordinate carefully if multiple agents work on them.
- After T004 through T006 complete, US1 and US2 test drafting can proceed while config-loader implementation is underway.

## Parallel Example: Repository Migration Files

```text
Task: "Create config/services/media.yaml with Jellyfin, Sonarr, Radarr, Readarr, Prowlarr, Bazarr, and FlareSolverr entries from config/services.yaml"
Task: "Create config/services/downloads.yaml with Transmission, Flood, qBittorrent, and qBittorrent exporter entries from config/services.yaml"
Task: "Create config/services/observability.yaml with Grafana, Prometheus, and Node Exporter entries from config/services.yaml"
Task: "Create config/services/network.yaml with AdGuard Home admin interface and AdGuard Home DNS entries from config/services.yaml"
```

## Parallel Example: Documentation

```text
Task: "Update accepted service layout documentation in README.md"
Task: "Update project memory for config/services.yaml or config/services/ support in AGENTS.md"
Task: "Update E2E testing notes for split service fixtures and lockfile validation in tests/e2e/README.md"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 to prove the existing single-file path still works.
3. Stop and validate with `npm run test:e2e` from `package.json`.

### Incremental Delivery

1. Deliver US1 for backward compatibility.
2. Deliver US2 for split-folder support.
3. Deliver US3 by migrating this repository and validating dry-run, real apply, and lockfile behavior.
4. Deliver US4 invalid-config diagnostics before final polish.

### Validation Strategy

1. Run `npm run test:e2e` from `package.json`.
2. Run `npm run apply:dry-run` from `package.json`.
3. Inspect `homelab.lock.json` with `git diff -- homelab.lock.json`.
4. Run operator-approved `npm run apply` from `package.json`.
5. Inspect `homelab.lock.json` again with `git diff -- homelab.lock.json`.

## Notes

- All task descriptions include file paths.
- Tasks marked `[P]` avoid file write conflicts.
- User-story tasks include `[US1]`, `[US2]`, `[US3]`, or `[US4]`.
- Tests are intentionally included because this feature affects config loading, live-infra apply behavior, and lockfile safety.
