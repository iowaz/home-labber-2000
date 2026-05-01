# Data Model: Split Services Configuration

## Service Source

Represents the selected origin for service declarations.

**Fields**:

- `kind`: `single-file` or `folder`
- `path`: path to `config/services.yaml` or `config/services/`
- `files`: ordered list of service declaration files used by the source

**Validation Rules**:

- Exactly one active source is allowed.
- `single-file` requires `config/services.yaml` to exist and contain a service list.
- `folder` requires `config/services/` to exist and contain at least one direct YAML file.
- Both layouts present is invalid.

## Service Declaration File

Represents one YAML file that contributes services to the catalog.

**Fields**:

- `path`: file path relative to the config directory
- `entries`: list of raw service declarations parsed from YAML

**Validation Rules**:

- File extension must be `.yaml` or `.yml`.
- Contents must be a list of service declaration objects.
- Each entry uses the existing service schema.
- Non-YAML files in `config/services/` are ignored.

## Service Catalog

Represents the aggregated services consumed by apply behavior.

**Fields**:

- `services`: ordered list of parsed service entries
- `source`: selected service source metadata used for validation diagnostics

**Validation Rules**:

- Service IDs must be unique across the complete catalog.
- Existing hostname, port, server-reference, publish-target, and DNS validation rules apply after aggregation.
- File grouping must not change service identity or provider intent.

## Service Identifier

Represents the stable identity used by provider state and the lockfile.

**Fields**:

- `id`: service ID string from each service declaration

**Validation Rules**:

- Must be unique across all loaded services.
- Must continue to key managed Caddy, Cloudflare, and DNS lockfile state.
- Must not depend on source file path or group name.

## Managed Lockfile State

Represents the committed managed resource state for no-op skips and cleanup.

**Fields**:

- `caddy`: managed Caddy state by server and service ID
- `cloudflare`: managed tunnel and public DNS state by server and service ID
- `dns`: managed DNS rewrite state by server and service ID

**Validation Rules**:

- Moving services between declaration files must not create lockfile changes by itself.
- Removing a service from split config must still allow stale managed resources to be reconciled from previous lockfile state.
- Dry-run must not update the lockfile.
