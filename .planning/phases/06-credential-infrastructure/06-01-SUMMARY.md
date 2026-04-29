---
phase: 06-credential-infrastructure
plan: "01"
subsystem: core/credential
tags: [credentials, config, keyring, zod, tdd]
dependency_graph:
  requires: []
  provides:
    - RepositoryConfig type (CRED-01)
    - loadRepositoryConfig(repoRoot) function (CRED-01)
    - parsePasswordRef(ref) function (CRED-02)
    - getPasswordByRef(ref) function (CRED-03)
  affects:
    - src/core/index.ts (public API surface)
    - src/cli/index.ts (intentionally broken — fixed in Phase 8)
tech_stack:
  added: []
  patterns:
    - Zod schema parse (propagate ZodError, two-try-catch for file I/O)
    - URLSearchParams-based keyring ref parser with semicolon-to-ampersand replacement
    - @napi-rs/keyring async/sync detection via typeof .then check
    - BACKMAIL_PASSWORD top-level env var fallback (D-03)
key_files:
  created: []
  modified:
    - src/core/config.ts
    - src/core/index.ts
    - tests/unit/config.test.ts
    - tests/unit/core-api-boundary.test.ts
decisions:
  - "D-06: removed loadConfig, getConfigPath, getConfigDir, getPassword(accountName) as dead code — no migration shim"
  - "D-09: RepositoryConfig has no repoPath or archivePath fields — derived by callers from repo root"
  - "D-04/05: parsePasswordRef is strict — unknown schemes and malformed keyring refs throw immediately"
  - "D-03: BACKMAIL_PASSWORD env var is a top-level fallback, always tried after passwordRef resolution fails"
metrics:
  duration_seconds: 156
  completed_date: "2026-04-29"
  tasks_completed: 2
  files_modified: 4
---

# Phase 6 Plan 01: Credential Infrastructure Summary

**One-liner:** Replaced v1.0 config module with typed RepositoryConfig, strict passwordRef parser (keyring/env), and async credential resolver with BACKMAIL_PASSWORD fallback using TDD (20 new tests, all green).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for v1.1 credential infrastructure | 222dff3 | tests/unit/config.test.ts |
| 1 (GREEN) | Replace src/core/config.ts with v1.1 credential infrastructure | d09dd11 | src/core/config.ts |
| 2 | Update src/core/index.ts to export new public API | 133f2f8 | src/core/index.ts, tests/unit/core-api-boundary.test.ts |

## What Was Built

`src/core/config.ts` was completely replaced. The old v1.0 implementation (central `~/.config/backmail/config.json`, multi-account map, `getPassword(accountName)` with per-account env vars) was removed. In its place:

- **`RepositoryConfig`** — Zod-validated type for `.backmail/config.json`: `{ host, port, username, tls, passwordRef }`. No `repoPath` (derived from repo root), no `archivePath` (hardcoded convention).
- **`loadRepositoryConfig(repoRoot)`** — reads `<repoRoot>/.backmail/config.json` with friendly ENOENT and invalid-JSON errors; Zod validation errors propagate as-is.
- **`PasswordRef`** — discriminated union interface: `{ type: 'keyring', service, account }` or `{ type: 'env', envVar }`.
- **`parsePasswordRef(ref)`** — strict parser: `keyring:service=X;account=Y` via URLSearchParams (semicolons replaced with `&`), `env:VARNAME` direct slice, anything else throws naming the unsupported scheme.
- **`getPasswordByRef(ref)`** — async resolver: keyring lookup (with async/sync detection), `BACKMAIL_PASSWORD` top-level fallback, clear error when nothing resolves.

`src/core/index.ts` exports the new public API, removing all Phase 2 symbols.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical update] Updated core-api-boundary.test.ts**
- **Found during:** Task 2
- **Issue:** The test file asserted `core.AccountConfig` type existence, which was removed as dead code per D-06. This would cause a TypeScript compile-time failure.
- **Fix:** Replaced `AccountConfig` assertion with `RepositoryConfig` assertion per PATTERNS.md guidance (D-07 — tests for removed functions are updated to cover new equivalents).
- **Files modified:** tests/unit/core-api-boundary.test.ts
- **Commit:** 133f2f8

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test) | 222dff3 | PASS — 20 tests all failed before implementation |
| GREEN (feat) | d09dd11 | PASS — 20 tests all passed after implementation |
| REFACTOR | — | Not needed — implementation was clean on first pass |

## Threat Surface Scan

All mitigations in the threat register were implemented:

| Threat | Mitigation Applied |
|--------|--------------------|
| T-06-01: Tampering via config.json | `RepositoryConfigSchema.parse()` validates all fields before use |
| T-06-04: Tampering via URLSearchParams | Semicolon→ampersand replacement applied before parsing; strict service+account check |
| T-06-06: EoP via unknown scheme | `parsePasswordRef` throws immediately on unrecognised scheme before any lookup |

No new threat surface introduced beyond what the plan's threat model covers.

## Known Stubs

None. `loadRepositoryConfig`, `parsePasswordRef`, and `getPasswordByRef` are fully wired with real implementation.

## Self-Check: PASSED

Files exist:
- src/core/config.ts: FOUND
- src/core/index.ts: FOUND
- tests/unit/config.test.ts: FOUND
- tests/unit/core-api-boundary.test.ts: FOUND

Commits exist:
- 222dff3: FOUND
- d09dd11: FOUND
- 133f2f8: FOUND

Removed symbols absent from core files: CONFIRMED (grep returns empty)
New exports present in both files: CONFIRMED
TypeScript reports no errors in src/core/config.ts or src/core/index.ts: CONFIRMED
