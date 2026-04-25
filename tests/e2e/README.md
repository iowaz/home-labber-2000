# E2E Tests

These tests exercise the CLI the same way an operator does: each case starts `node --experimental-strip-types src/cli.mts apply` as a subprocess with an isolated config directory and lockfile.

## Strategy

- The suite lives in `tests/e2e/` and uses Node's built-in `node:test` runner.
- Each test creates a temporary config directory and lockfile path under the OS temp directory, then removes them in test cleanup.
- Local HTTP servers emulate the Caddy Admin API and AdGuard Home rewrite API. This keeps the tests deterministic, avoids production credentials, and still verifies the externally observable CLI behavior: HTTP requests, payloads, stdout/stderr, exit codes, and lockfile contents.
- Cloudflare's real API is intentionally not used by default because tunnel ingress and DNS writes can affect live infrastructure and are not safe for an always-on local/CI E2E suite. Add a separate opt-in staging suite if dedicated Cloudflare test credentials and disposable zones/tunnels are available.

## Running

```bash
npm run test:e2e
```

## Environment Variables

The default E2E suite does not require external credentials. Tests inject these per subprocess:

```env
TEST_ADGUARD_USERNAME=e2e-user
TEST_ADGUARD_PASSWORD=e2e-password
```

Real infrastructure tests should never use production credentials or production data. If an opt-in staging suite is added later, use dedicated variables such as `E2E_CLOUDFLARE_API_TOKEN`, `E2E_CLOUDFLARE_ACCOUNT_ID`, and disposable tunnel/zone identifiers, with setup and cleanup owned by each test.
