---
phase: 01-foundation
reviewed: 2026-04-20T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - docker-compose.yml
  - scripts/test-integration.sh
  - src/cli/index.ts
  - src/core/index.ts
  - tests/fixtures/fixture-001.eml
  - tests/fixtures/fixture-002.eml
  - tests/integration/imap-connect.test.ts
  - tests/unit/cli-boundary.test.ts
  - tests/unit/core-api-boundary.test.ts
  - tests/unit/fixtures.test.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-04-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 1 establishes the foundation scaffold: a thin CLI wrapper, a core API boundary, synthetic email fixtures, and Docker-backed integration test infrastructure. The source modules (`src/cli/index.ts`, `src/core/index.ts`) are intentionally minimal stubs and are clean. The test files and shell script contain several issues worth addressing before Phase 2 builds on top of this scaffolding.

No critical security vulnerabilities were found. The three warnings relate to potential test hangs and a fragile path construction. The three info items flag known credentials in test infrastructure, a loose regex, and a source-level limitation of the boundary enforcement approach.

---

## Warnings

### WR-01: Integration test hangs indefinitely if IMAP greeting is never sent

**File:** `tests/integration/imap-connect.test.ts:19-32`

**Issue:** The second test connects a TCP socket and waits for the server's first `data` event via `socket.once('data', ...)`. No timeout is set on the socket. If the container accepts the TCP handshake but stalls before sending the IMAP greeting (e.g., it is still initialising Dovecot internally), the test hangs indefinitely and blocks the entire test run. The first test only validates that the TCP port accepts connections — it does not guarantee that the IMAP daemon is ready to send the greeting.

**Fix:** Set a socket timeout before waiting for data, and reject on timeout:

```typescript
it('IMAP greeting contains Dovecot ready banner', () => {
  return new Promise<void>((resolve, reject) => {
    const socket = net.connect(IMAP_PORT, IMAP_HOST, () => {
      socket.setTimeout(5000)
      socket.once('timeout', () => {
        socket.destroy()
        reject(new Error('Timed out waiting for IMAP greeting'))
      })
      socket.once('data', (data) => {
        const banner = data.toString()
        expect(banner).toMatch(/\* OK/)
        socket.destroy()
        resolve()
      })
    })
    socket.on('error', reject)
  })
})
```

---

### WR-02: Readiness poll in integration script may spin without delay on first iteration

**File:** `scripts/test-integration.sh:17`

**Issue:** The readiness check is:
```bash
timeout 60 bash -c 'until bash -c "</dev/tcp/localhost/143" 2>/dev/null; do sleep 1; done'
```
The `sleep 1` only fires after a failed connection attempt, so the loop immediately retries on failure. However, the more significant issue is that the inner `bash -c "</dev/tcp/localhost/143"` relies on bash's `/dev/tcp` pseudo-device, which is a bash-specific feature and not available if the system's `/bin/sh` is not bash (e.g., Alpine-based CI runners with dash). Since the outer script uses `#!/usr/bin/env bash` and calls `bash -c` explicitly, this is fine in practice — but the inner shell invocation exits 0 even when the connection is refused on some bash versions, depending on whether the redirect error is propagated to the exit code. A more portable alternative avoids this ambiguity.

**Fix:** Replace with `nc` or `curl` for explicit, portable TCP probing:

```bash
timeout 60 bash -c 'until nc -z localhost 143 2>/dev/null; do sleep 1; done'
```

If `nc` is unavailable in CI, the explicit `bash -c '...'` form is acceptable but should add a comment documenting the `/dev/tcp` dependency:

```bash
# Requires bash with /dev/tcp support (GNU bash ≥ 2.04, not POSIX sh)
timeout 60 bash -c 'until (echo > /dev/tcp/localhost/143) 2>/dev/null; do sleep 1; done'
```

---

### WR-03: Fixture path in fixtures.test.ts is fragile relative navigation

**File:** `tests/unit/fixtures.test.ts:7`

**Issue:** The fixtures directory is located via:
```typescript
const FIXTURES_DIR = resolve(__dirname, '../../tests/fixtures')
```
`__dirname` resolves to the directory of the compiled/executed test file (i.e., `tests/unit/`). The path `../../tests/fixtures` navigates up two levels from `tests/unit/` to the project root and back down — which means it navigates to `<project-root>/tests/fixtures`. This works today but will silently produce a wrong path if the test file is ever moved to a different nesting depth. Additionally, if vitest's working directory is the project root (which it typically is), a simpler and more robust construction avoids the double traversal.

**Fix:** Anchor from the project root using `process.cwd()` or an explicit root-relative path:

```typescript
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve from project root, not relative to this file's depth
const PROJECT_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const FIXTURES_DIR = resolve(PROJECT_ROOT, 'tests/fixtures')
```

Alternatively, resolve from the unit test `__dirname` with a correct single `..`:
```typescript
const FIXTURES_DIR = resolve(__dirname, '../fixtures')
```
(One `..` from `tests/unit/` reaches `tests/`, then `fixtures` is a sibling — not two levels up and back down.)

**Note:** The current path `../../tests/fixtures` from `tests/unit/` actually traverses: `tests/unit/ → tests/ → <root> → tests/fixtures`. This is two `..` steps then back into `tests/fixtures`, arriving at the correct location, but it is unnecessarily convoluted. The single-`..` form `../fixtures` is cleaner.

---

## Info

### IN-01: Docker Compose binds port 143 on all interfaces with known default credentials

**File:** `docker-compose.yml:8-11`

**Issue:** The IMAP container binds port 143 on all network interfaces (`0.0.0.0`) and the credentials (`testuser:testpass`) are documented in comments. During development, running `npm run test:integration` exposes a live IMAP server on the host's LAN interface for the duration of the test run. On developer workstations connected to shared networks this is a low-severity concern.

**Fix:** Bind only to localhost for isolation:

```yaml
ports:
  - "127.0.0.1:143:143"
```

This prevents the test IMAP server from being reachable from other hosts on the network during test runs.

---

### IN-02: Email address regex in fixture validation may match non-address content

**File:** `tests/unit/fixtures.test.ts:32`

**Issue:** The pattern `[\w.+-]+@[\w-]+\.[\w.]+` used to extract email addresses is intentionally loose for readability, but it will match strings embedded in URLs, MIME boundaries, or other structured fields that happen to contain an `@` character. In the current fixture set this is harmless, but future fixtures with multipart MIME content (boundaries, Content-ID headers, embedded URLs) could generate false matches that cause the `@example.com` assertion to fail on valid fixture content.

**Fix:** Scope the regex more tightly to expected header fields when stricter validation is needed, or add a comment documenting the known limitation:

```typescript
// Note: this regex is intentionally loose — it matches any @-containing token.
// Tighten if fixtures grow to include multipart MIME boundaries or inline URLs.
const emailAddresses = content.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []
```

---

### IN-03: Boundary enforcement in cli-boundary.test.ts is source-text analysis only

**File:** `tests/unit/cli-boundary.test.ts:1-44`

**Issue:** The tests enforce the CLI/core architectural boundary by reading source `.ts` files and running regex checks against the raw text. This is a reasonable first step, but it has a blind spot: an import aliased through an intermediate module (e.g., `import { x } from '../utils'` where `utils` re-exports from `../cli/`) would satisfy all regex checks while still violating the boundary at runtime. The approach also does not cover dynamic `import()` calls.

**Fix:** This is a known trade-off for Phase 1. Document the limitation in the test file so future maintainers understand the scope of coverage:

```typescript
// NOTE: This enforcement is source-text based (regex on .ts files).
// It catches direct imports but not aliased re-exports or dynamic import().
// Phase 3+ should add ESLint import/no-restricted-paths for runtime-enforced boundary checks.
```

---

_Reviewed: 2026-04-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
