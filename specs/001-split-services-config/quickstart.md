# Quickstart: Split Services Configuration

## Implement Locally

1. Add failing E2E tests for:
   - current `config/services.yaml` compatibility
   - split `config/services/*.yaml` loading
   - both layouts present
   - empty service folder
   - non-list service file
   - duplicate service IDs across split files
   - invalid split-file server references
   - fixture real apply followed by lockfile no-op skip

2. Update `src/config/config-loader.ts` so it discovers exactly one active service source and returns the same aggregated `ServiceEntry[]` shape used today.

3. Split the current repository services into:
   - `config/services/media.yaml`
   - `config/services/downloads.yaml`
   - `config/services/observability.yaml`
   - `config/services/network.yaml`

4. Remove `config/services.yaml` after the folder layout is in place.

5. Update README and AGENTS documentation to describe both accepted layouts.

## Validate

Run the local fixture suite:

```bash
npm run test:e2e
```

Run production dry-run validation:

```bash
npm run apply:dry-run
```

Confirm dry-run did not update managed state:

```bash
git diff -- homelab.lock.json
```

After tests and dry-run pass, run the operator-approved real apply:

```bash
npm run apply
```

Check whether the lockfile changed:

```bash
git diff -- homelab.lock.json
```

Expected result after moving services between files only: no `homelab.lock.json` changes caused by file paths or grouping. If provider state was already drifted before the feature, review any lockfile diff as normal apply reconciliation rather than as a split-config change.
