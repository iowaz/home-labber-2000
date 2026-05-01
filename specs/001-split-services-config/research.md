# Research: Split Services Configuration

## Decision: Support exactly one active service declaration layout

Use either `config/services.yaml` or `config/services/` as the active service source. If both exist, fail validation before parsing provider targets.

**Rationale**: A mutually exclusive layout avoids accidental double-loading, keeps operator intent obvious, and makes migration reversible by moving all services back into one file.

**Alternatives considered**:

- Load both sources together: rejected because it makes duplicate handling and operator intent less clear.
- Add a new config flag selecting the layout: rejected because the filesystem layout already expresses the choice and no CLI option is needed.

## Decision: Limit folder discovery to direct YAML files

Read direct `*.yaml` and `*.yml` files from `config/services/`, sorted by relative path. Ignore non-YAML files. Do not recurse into nested folders in this feature.

**Rationale**: Direct files support the requested "break by whatever order" organization while keeping validation messages and performance simple. Sorting removes filesystem-order nondeterminism.

**Alternatives considered**:

- Recursive folders: rejected for v1 because nested path conventions create more edge cases without being required by the current service catalog.
- Only `*.yaml`: rejected because `*.yml` is common enough to accept without extra risk.

## Decision: Keep the service schema unchanged

Each service file contains a YAML list of the same service objects currently accepted in `config/services.yaml`.

**Rationale**: Reusing the existing schema preserves service semantics, operator knowledge, downstream `ServiceEntry[]` behavior, and lockfile identity.

**Alternatives considered**:

- Map files keyed by service ID: rejected because it would create a second schema and make migration noisier.
- Folder-level metadata/group names: rejected because groups are for human organization only and must not affect apply behavior.

## Decision: Preserve downstream apply and lockfile semantics

After loading, split declarations become one aggregated service catalog. Caddy, Cloudflare, DNS, target filtering, no-op skips, stale cleanup, and lockfile updates remain based on service IDs and provider state.

**Rationale**: Source paths should not be part of managed state. Moving a service between files should produce no remote changes and no lockfile churn.

**Alternatives considered**:

- Store source file paths in lockfile: rejected because it would cause path-only churn and does not help provider reconciliation.

## Decision: Use file-aware validation errors

Parsing and validation errors for split services should include the source file and the service index when possible, while existing cross-reference messages continue to name the service ID.

**Rationale**: Split files make location important. Operators need to find the broken declaration quickly, but existing service-ID errors remain useful for cross-file checks.

**Alternatives considered**:

- Keep global `services[index]` messages only: rejected because indexes are hard to use after aggregation.
- Change all validation to path-specific messages: rejected as broader churn than needed.

## Decision: Verification includes fixture real apply and operator-approved production apply

Automated E2E tests should perform real writes against local Caddy and AdGuard fixtures, then confirm second apply skips by lockfile. Production validation should run dry-run before a real `npm run apply`, and inspect `homelab.lock.json` before and after.

**Rationale**: Fixture real applies prove behavior without live infrastructure risk. The final real apply satisfies the user's explicit request after safer checks pass.

**Alternatives considered**:

- Only dry-run: rejected because the user specifically requested real apply validation and lockfile behavior depends on successful apply writes.
- Automated live Cloudflare validation: rejected because production Cloudflare writes require real credentials and should remain operator-controlled.
