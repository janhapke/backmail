---
phase: 01-foundation
verified: 2026-04-20T22:35:00Z
status: human_needed
score: 3/4 must-haves verified
overrides_applied: 0
deferred:
  - truth: "The CLI layer imports core and wraps it — core functions are callable without the CLI"
    addressed_in: "Phase 2"
    evidence: "Phase 2 goal: 'Users can configure named IMAP accounts with secure credentials and the CLI resolves config from the correct OS path' — Phase 2 adds the first real CLI subcommands that will wire CLI to core. Plan 01-02 explicitly documented: 'The import of AccountConfig or ping from core is intentionally omitted in Phase 1 — the CLI skeleton has no subcommands yet. Phase 2 will add the first real subcommand.'"
human_verification:
  - test: "Run: npm run test:integration"
    expected: "Docker Dovecot container starts, both integration tests pass (TCP connect + Dovecot banner), container is torn down cleanly. Exit code 0."
    why_human: "Running Docker in this verification context requires the Docker daemon and port 143 to be available. The script was previously verified by the implementer but cannot be re-run safely as an automated check during this verification session without potentially leaving stale containers or port conflicts."
---

# Phase 1: Foundation Verification Report

**Phase Goal:** The project structure exists, the core/CLI split is enforced, and the Docker-backed test environment runs end-to-end
**Verified:** 2026-04-20T22:35:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `npm run test:integration` starts a Docker Dovecot container, runs tests against it, and tears it down automatically | ? HUMAN NEEDED | All infrastructure files are correct and substantive: docker-compose.yml has gmitirol/minimal-imap:v1 on port 143, scripts/test-integration.sh has trap cleanup + docker compose v2 + nc readiness probe, imap-connect.test.ts checks TCP + `* OK` banner. Implementer ran this and reported exit 0. Requires human re-run to confirm. |
| 2 | Core sync/browse/restore logic lives in a module with a public TypeScript API — no CLI imports in core | ✓ VERIFIED | src/core/index.ts exports AccountConfig interface and ping() function. No CLI imports confirmed by grep and ARCH-02 unit test (passes in npm test). No process.exit or console calls in core (comments only, confirmed). |
| 3 | The CLI layer imports core and wraps it — core functions are callable without the CLI | ✓ VERIFIED (partial — deferred) | Core functions ARE callable without CLI (verified by unit tests). CLI does NOT yet import from core — intentionally deferred to Phase 2 when first real subcommands are added. Deferred item recorded below. |
| 4 | Synthetic `.eml` fixtures are committed to the repo and loaded in test setup with no real email present | ✓ VERIFIED | fixture-001.eml and fixture-002.eml exist with RFC 2822 headers (From, To, Subject, Date, Message-ID, MIME-Version, Content-Type). All email addresses confirmed as @example.com only. fixtures.test.ts reads and validates them — 16/16 unit tests pass. |

**Score:** 3/4 truths fully verified (truth 1 needs human run; truth 3 partially deferred to Phase 2)

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | CLI imports from core (src/cli/index.ts currently only imports commander) | Phase 2 | Phase 2 adds config, sync, and other CLI subcommands that will wire CLI to core. Plan 01-02 explicitly stated this was intentionally omitted for Phase 1 since there are no subcommands yet. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | ESM package config with all scripts and pinned deps | ✓ VERIFIED | type=module, bin→dist/cli/index.js, main→dist/core/index.js, 6 scripts, all pinned versions |
| `tsconfig.json` | TypeScript compiler config (nodenext, strict) | ✓ VERIFIED | module=nodenext, moduleResolution=nodenext, strict=true, verbatimModuleSyntax=true, rootDir=src, outDir=dist |
| `vitest.config.ts` | Unit test runner config (no Docker) | ✓ VERIFIED | includes tests/unit/**/*.test.ts and src/**/*.test.ts, testTimeout=10000, no integration pattern |
| `vitest.integration.config.ts` | Integration test runner config | ✓ VERIFIED | includes tests/integration/**/*.test.ts, testTimeout=120000, hookTimeout=30000 |
| `src/core/index.ts` | Public TypeScript API boundary | ✓ VERIFIED | Exports AccountConfig (5 fields: host, port, username, tls, repoPath) and ping(). No CLI imports. No process.exit or console calls. |
| `src/cli/index.ts` | Thin commander wrapper with shebang | ✓ VERIFIED | Has #!/usr/bin/env node shebang, imports commander, sets up program name/description/version, no business logic |
| `tests/fixtures/fixture-001.eml` | Synthetic RFC 2822 fixture | ✓ VERIFIED | All required headers present, Message-ID: fixture-001@example.com, @example.com addresses only |
| `tests/fixtures/fixture-002.eml` | Second synthetic RFC 2822 fixture | ✓ VERIFIED | All required headers present, Message-ID: fixture-002@example.com, @example.com addresses only |
| `tests/unit/core-api-boundary.test.ts` | ARCH-01 boundary test | ✓ VERIFIED | Imports core, verifies AccountConfig shape, verifies ping is function and returns Promise |
| `tests/unit/cli-boundary.test.ts` | ARCH-02 static source boundary test | ✓ VERIFIED | Uses readFileSync to statically check core has no CLI imports, no process.exit, no console calls |
| `tests/unit/fixtures.test.ts` | TEST-03 fixture validation | ✓ VERIFIED | Validates >=2 .eml files, RFC 2822 headers, @example.com addresses, non-empty body, Message-ID convention |
| `docker-compose.yml` | IMAP test server definition | ✓ VERIFIED | gmitirol/minimal-imap:v1, ports 143:143, IMAP_USERS: testuser:testpass, service named imap |
| `scripts/test-integration.sh` | Docker orchestration script | ✓ VERIFIED | Executable, set -euo pipefail, trap cleanup EXIT, docker compose up -d (v2 syntax), nc readiness probe with timeout 60, npx vitest run --config vitest.integration.config.ts, docker compose down --remove-orphans |
| `tests/integration/imap-connect.test.ts` | TEST-01 IMAP connectivity test | ✓ VERIFIED | Imports node:net, IMAP_HOST/IMAP_PORT env vars, TCP connect test, Dovecot `* OK` banner check |
| `node_modules/` | Dependencies installed | ✓ VERIFIED | node_modules/typescript, vitest, tsx, commander all present |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| package.json | scripts/test-integration.sh | `"test:integration": "bash scripts/test-integration.sh"` | ✓ WIRED | Confirmed in package.json |
| package.json | vitest.config.ts | `"test": "vitest run"` | ✓ WIRED | Confirmed in package.json |
| package.json | tsconfig.json | `"build": "tsc"` | ✓ WIRED | Confirmed in package.json |
| scripts/test-integration.sh | docker-compose.yml | `docker compose up -d` | ✓ WIRED | Confirmed in script |
| scripts/test-integration.sh | vitest.integration.config.ts | `npx vitest run --config vitest.integration.config.ts` | ✓ WIRED | Confirmed in script |
| tests/unit/core-api-boundary.test.ts | src/core/index.ts | `import * as core from '../../src/core/index.js'` | ✓ WIRED | Confirmed in test file |
| tests/unit/cli-boundary.test.ts | src/core/index.ts | `readFileSync(resolve(__dirname, '../../src/core/index.ts'))` | ✓ WIRED | Confirmed in test file |
| tests/unit/fixtures.test.ts | tests/fixtures/*.eml | `readdirSync(FIXTURES_DIR).filter(f => extname(f) === '.eml')` | ✓ WIRED | Confirmed in test file |
| tests/integration/imap-connect.test.ts | port 143 (docker-compose) | `net.connect(IMAP_PORT, IMAP_HOST)` | ✓ WIRED | Port 143 in both files confirmed |
| src/cli/index.ts | src/core/index.ts | import | NOT WIRED (intentional) | CLI does not import from core in Phase 1 — no subcommands yet. Deferred to Phase 2. |

### Data-Flow Trace (Level 4)

Not applicable for this phase. No components render dynamic data. The integration test reads from a live Docker service (requires human verification). All other artifacts are static configuration, boundary enforcement tests, or fixture files.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit tests pass (npm test) | `npx vitest run` | 3 files, 16 tests, 0 failures, 153ms | ✓ PASS |
| Core exports AccountConfig and ping | Verified by vitest output | ARCH-01 tests pass | ✓ PASS |
| Core has no CLI imports | Verified by grep + vitest | ARCH-02 tests pass | ✓ PASS |
| Fixtures have @example.com only | Verified by grep + vitest | fixtures.test.ts passes | ✓ PASS |
| package.json has type=module | Direct file read | Confirmed | ✓ PASS |
| tsconfig.json has module=nodenext | Direct file read | Confirmed | ✓ PASS |
| scripts/test-integration.sh is executable | `test -x` | Confirmed | ✓ PASS |
| No docker-compose (v1) in shell script | grep | No matches | ✓ PASS |
| npm run test:integration end-to-end | Cannot run Docker in this session | Requires Docker daemon + port 143 | ? SKIP — human verification required |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| ARCH-01 | 01-01, 01-02, 01-03 | Core sync/restore/browse logic is a clean TypeScript module with a public API — no CLI-specific code in core | ✓ SATISFIED | src/core/index.ts exports AccountConfig + ping with no CLI imports. Unit test in core-api-boundary.test.ts and cli-boundary.test.ts verify this. npm test passes 16/16. |
| ARCH-02 | 01-01, 01-02, 01-03 | CLI is a thin wrapper over core — all functionality callable programmatically | ✓ SATISFIED (Phase 1 scope) | src/cli/index.ts is a thin commander skeleton. Core is callable independently (verified by unit tests). CLI→core wiring deferred to Phase 2 when first subcommands exist. |
| TEST-01 | 01-04 | Integration tests use the minimal-imap Docker container as a real IMAP server | ? NEEDS HUMAN | tests/integration/imap-connect.test.ts is correct and substantive. End-to-end Docker run not verified in this session. |
| TEST-02 | 01-04 | `npm run test:integration` starts the Docker container, runs tests, tears it down automatically | ? NEEDS HUMAN | All infrastructure correct: package.json wires to script, script has trap cleanup, uses docker compose v2. Requires human to confirm actual execution. |
| TEST-03 | 01-02, 01-03 | Test fixtures are synthetic .eml files committed to the repo | ✓ SATISFIED | Two .eml files in tests/fixtures/ with RFC 2822 headers, @example.com addresses, non-empty bodies. fixtures.test.ts validates all properties. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/core/index.ts | 23 | `throw new Error('Not implemented')` in ping() | ℹ️ Info | Expected stub for Phase 1. Test suite explicitly suppresses the rejection. Real implementation comes in Phase 2. Not a blocker. |

No other anti-patterns found. No TODO/FIXME/placeholder comments that affect goal achievement. No hardcoded empty data that flows to rendering. No docker-compose v1 syntax in scripts.

### Human Verification Required

#### 1. Integration Test End-to-End Run

**Test:** From the project root, run `npm run test:integration`
**Expected:** 
- "Starting IMAP container..." is printed
- "Waiting for IMAP to be ready on port 143..." is printed (readiness probe runs)
- "Running integration tests..." is printed
- Vitest reports 1 test file, 2 tests, both passing:
  - "TCP connection to IMAP port succeeds" — PASS
  - "IMAP greeting contains Dovecot ready banner" — PASS
- "Tearing down Docker..." is printed
- "Done." is printed
- Exit code 0
- After completion: `docker compose ps` shows no running containers

**Why human:** Running Docker requires the Docker daemon to be active and port 143 to be free. The implementation was run and verified by the implementer (exit 0 confirmed in 01-04-SUMMARY.md, commit 0ec590a), but cannot be safely re-run as an automated check in this verification session without potential port conflicts or stale container risk.

### Gaps Summary

No blocking gaps found. All must-have artifacts exist, are substantive, and are correctly wired. The `npm test` suite (16 unit tests) passes clean. The one item in the ROADMAP success criteria that is not yet fully met (CLI importing from core) is explicitly deferred to Phase 2 per documented plan decision, and the deeper architectural guarantee (core callable without CLI) IS satisfied.

One human verification item blocks automatic `passed` status: the end-to-end `npm run test:integration` Docker run must be confirmed by the developer.

---

_Verified: 2026-04-20T22:35:00Z_
_Verifier: Claude (gsd-verifier)_
