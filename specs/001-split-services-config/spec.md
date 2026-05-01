# Feature Specification: Split Services Configuration

**Feature Branch**: `001-split-services-config`  
**Created**: 2026-05-01  
**Status**: Draft  
**Input**: User description: "I want you to change the services declaration to be either an single file (services.yaml as it is) or as an folder that I can break by whatever order I would like, example: /services/media.yaml and inside media.yaml there will be Jellyfin, Sonarr, Radarr, etc - on the planning, make sure to include breaking the files for me (you may suggest the aggregation) and testing if it works (real APPLY) - make sure to also check if the lockfile is working as intended"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keep Existing Single File Working (Priority: P1)

As a homelab operator, I can keep declaring all services in the existing single services file so the current workflow continues to work without requiring any config migration.

**Why this priority**: Backward compatibility protects the current apply workflow and avoids forcing a risky config reshuffle before the new option is proven.

**Independent Test**: Use the current services declaration unchanged, run the normal validation/apply preparation flow, and confirm the same services are recognized with the same publication and DNS intent.

**Acceptance Scenarios**:

1. **Given** the repository has the existing single services declaration, **When** the operator runs an apply validation, **Then** all currently declared services are loaded exactly once.
2. **Given** the repository has the existing single services declaration, **When** the operator runs a no-change apply, **Then** managed resources and lockfile behavior remain equivalent to the current baseline.

---

### User Story 2 - Organize Services Across Folder Files (Priority: P1)

As a homelab operator, I can replace the single services file with a services folder containing multiple YAML files, grouped by any organization that makes sense to me, so the config stays readable as the lab grows.

**Why this priority**: This is the core value of the feature: splitting a growing service catalog into smaller, operator-owned files without changing service semantics.

**Independent Test**: Move the existing service declarations into multiple folder files, run validation, and confirm the tool sees the same complete service set as before.

**Acceptance Scenarios**:

1. **Given** services are split across files such as media, downloads, observability, and network/admin groupings, **When** the operator runs an apply validation, **Then** every service from every file is included in the planned work.
2. **Given** service files are named or ordered differently by the operator, **When** the operator runs an apply validation, **Then** the resulting managed service intent remains the same.
3. **Given** the same service identifier appears in more than one service file, **When** the operator runs validation, **Then** the command fails before remote changes and identifies the duplicate service and the relevant files.

---

### User Story 3 - Migrate Current Repository Config Safely (Priority: P2)

As the repository maintainer, I get the current service catalog split into suggested files as part of this change, so the new declaration mode is exercised immediately with real project data.

**Why this priority**: Migrating the current config proves the feature against the real service set and gives future sessions a cleaner default layout.

**Independent Test**: Review the committed service grouping and run the same apply validation used for the production workflow, including a real apply confirmation after safer automated checks pass.

**Acceptance Scenarios**:

1. **Given** the current service catalog, **When** the migration is planned, **Then** it includes a concrete grouping proposal for all existing services with no service omitted.
2. **Given** the migrated folder declaration contains the same service data, **When** a real apply is performed after automated and dry-run validation, **Then** remote managed resources do not change solely because the declarations moved between files.
3. **Given** the migrated folder declaration contains the same service data, **When** the lockfile is checked after apply, **Then** the lockfile records no path-only churn and continues to support no-op skips and stale managed resource cleanup.

---

### User Story 4 - Diagnose Invalid Split Config Clearly (Priority: P3)

As a homelab operator, I receive clear errors when the service declaration layout is ambiguous or invalid, so I can fix config problems before they touch live infrastructure.

**Why this priority**: Split files increase the number of places config can go wrong, so validation must remain a safety rail.

**Independent Test**: Create intentionally invalid service declaration layouts and verify the command fails before remote writes with actionable messages.

**Acceptance Scenarios**:

1. **Given** both the single services file and services folder are present, **When** the operator runs validation, **Then** the command fails with a clear message that only one declaration style may be active.
2. **Given** a service folder contains an invalid YAML service file, **When** the operator runs validation, **Then** the command fails before remote changes and names the invalid file.
3. **Given** a service in a split file references an unknown server or invalid publish target, **When** the operator runs validation, **Then** the existing reference safety checks still apply and identify the invalid service.

### Edge Cases

- The service folder exists but contains no service YAML files.
- The service folder contains non-YAML files used for notes or editor metadata.
- Service files are renamed, added, or removed without changing service identifiers.
- Two folder files declare the same service identifier.
- A folder file contains valid YAML but not a service list.
- Services are moved between files while `homelab.lock.json` already tracks managed resources.
- A service is removed from split config and must still be reconciled through managed-state cleanup.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept the existing single services declaration as a valid service source with no required changes to current service content.
- **FR-002**: The system MUST accept a services folder as an alternative service source where service declarations can be split across multiple YAML files.
- **FR-003**: The system MUST treat the single-file declaration and folder declaration as mutually exclusive active layouts, failing validation when both are present.
- **FR-004**: The system MUST aggregate every valid service declaration from the folder layout into one complete service catalog before planning or applying changes.
- **FR-005**: The system MUST ensure service grouping and file naming do not change the intended Caddy, Cloudflare Tunnel, DNS, or lockfile behavior for otherwise identical service declarations.
- **FR-006**: The system MUST reject duplicate service identifiers across split files and identify enough context for the operator to locate and fix the duplicate.
- **FR-007**: The system MUST apply existing validation rules to services loaded from split files, including required descriptions, server references, hostnames, ports, publish targets, and DNS behavior.
- **FR-008**: The system MUST fail before any remote write or lockfile update when the service declaration layout or any split service file is invalid.
- **FR-009**: The implementation plan MUST include a concrete migration of the current service catalog into folder files and must account for every existing service.
- **FR-010**: The migration proposal MUST include, at minimum, these suggested groups unless implementation research finds a safer grouping:
  - `media`: Jellyfin, Sonarr, Radarr, Readarr, Prowlarr, Bazarr, and FlareSolverr.
  - `downloads`: Transmission, Flood, qBittorrent, and qBittorrent exporter.
  - `observability`: Grafana, Prometheus, and Node Exporter.
  - `network`: AdGuard Home admin interface and AdGuard Home DNS.
- **FR-011**: The verification plan MUST include automated coverage, dry-run validation, a real apply validation step, and explicit lockfile checks for no-op behavior and stale managed resource cleanup.

### Key Entities

- **Service Catalog**: The complete set of service declarations used by apply behavior, regardless of whether they came from one file or multiple files.
- **Service Declaration File**: A YAML file containing one or more service declarations that belong to the folder layout.
- **Service Identifier**: The stable unique service ID used to plan provider changes and correlate managed state.
- **Managed Lockfile State**: The committed record of resources managed by this repository, used for no-op skips and stale-resource cleanup.

### Quality, UX, and Performance Requirements *(mandatory)*

- **QR-001**: Code changes MUST preserve strict TypeScript, ESM imports, typed config/provider structures,
  and existing command/container/service boundaries unless an explicit exception is accepted.
- **QR-002**: Changes that affect config, remote writes, lockfile state, or generated provider payloads
  MUST define validation and failure behavior before implementation.
- **QR-003**: Behavior changes MUST identify the required automated coverage, including local-fixture E2E
  coverage for live-infrastructure workflows, or document a concrete testing exception.
- **QR-004**: User-visible CLI output MUST preserve operation-label prefixes, aggregated unchanged output,
  service descriptions, consistent flag/error wording, and sanitized diagnostics.
- **QR-005**: Features that add network calls, loops over managed resources, or expensive config processing
  MUST define measurable performance or reliability expectations.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The existing single-file service declaration validates successfully and produces the same service count and service identifiers as before the feature.
- **SC-002**: The current repository services can be split into at least four folder files, and validation still recognizes 100% of the existing services exactly once.
- **SC-003**: Reordering or renaming split service files without changing service contents produces no remote-resource changes and no service-identity changes.
- **SC-004**: Duplicate service identifiers across split files are rejected before any remote write in 100% of tested duplicate cases.
- **SC-005**: After the current services are migrated to folder files, a real apply completes successfully and `homelab.lock.json` has no changes caused only by moving services between files.
- **SC-006**: Lockfile-driven no-op skips and stale-resource cleanup are verified after migration using both automated coverage and an operator-run validation path.

## Assumptions

- The folder layout is an alternative to the existing single file, not an additional source loaded at the same time.
- Direct YAML files in the services folder are the intended declaration units; non-YAML files are not service declarations.
- The service schema remains the same whether a service is declared in the single file or a folder file.
- Moving a service between files must not change its identity; service IDs remain the stable source of managed-state correlation.
- A real apply is acceptable as a final validation step only after automated tests and dry-run validation have passed.
