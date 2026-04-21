---
phase: 02-configuration
plan: 01
subsystem: testing
tags: [vitest, tdd, keyring, zod, napi-rs, config]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: AccountConfig interface in src/core/index.ts, Vitest test infrastructure, ESM/tsx project structure
provides:
  - "@napi-rs/keyring@1.2.0 installed as dependency (keytar-compatible, NAPI prebuilts)"
  - "zod@4.3.6 installed as dependency (schema validation with TypeScript inference)"
  - "tests/unit/config.test.ts: 12 failing tests across 9 describe blocks (RED state for config module)"
affects:
  - 02-02-PLAN: implements src/core/config.ts to turn these tests GREEN
  - 02-03-PLAN: wires CLI to call loadConfig, uses getPassword in sync/restore

# Tech tracking
tech-stack:
  added:
    - "@napi-rs/keyring@1.2.0 — OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service)"
    - "zod@4.3.6 — JSON schema validation with TypeScript type inference"
  patterns:
    - "TDD RED state: test file imports from non-existent module to establish failing baseline"
    - "vi.mock('@napi-rs/keyring') with Entry class mock for OS keyring isolation in tests"
    - "Object.defineProperty(process, 'platform', ...) pattern for platform-specific test isolation"

key-files:
  created:
    - "tests/unit/config.test.ts — failing test scaffold for config module (12 tests, 9 describe blocks)"
  modified:
    - "package.json — added @napi-rs/keyring and zod to dependencies"
    - "package-lock.json — updated lockfile with new dependencies"

key-decisions:
  - "Use @napi-rs/keyring not keytar: keytar archived Dec 2022, no Node.js v20+ prebuilts; @napi-rs/keyring is 100% API-compatible"
  - "Mock Entry class in tests: config module will use new Entry('backmail', accountName).getPassword() — mocked at module level with vi.mock"
  - "12 test cases vs 9 in plan: behavior section specifies 3 getConfigDir platform tests and 2 repoPath tests; 12 is correct coverage"

patterns-established:
  - "Platform mocking: Object.defineProperty(process, 'platform', { value: '...', configurable: true }) with restore in afterEach"
  - "Temp file pattern: fs.mkdtempSync(os.tmpdir()) with fs.rmSync cleanup in afterEach"
  - "@napi-rs/keyring mock exposes _mockGetPassword via vi.mock factory for per-test control"

requirements-completed:
  - CONFIG-01
  - CONFIG-02
  - CONFIG-03

# Metrics
duration: 3min
completed: 2026-04-21
---

# Phase 2 Plan 01: Configuration TDD Red State Summary

**Installed @napi-rs/keyring and zod, created 12-test failing scaffold covering all CONFIG-01/02/03 behaviors for config module**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-21T05:20:18Z
- **Completed:** 2026-04-21T05:22:52Z
- **Tasks:** 2
- **Files modified:** 3 (package.json, package-lock.json, tests/unit/config.test.ts)

## Accomplishments
- Installed `@napi-rs/keyring@1.2.0` and `zod@4.3.6` as runtime dependencies
- Created `tests/unit/config.test.ts` with 12 test cases across 9 describe blocks matching VALIDATION.md filter strings
- Verified RED state: all tests fail with MODULE_NOT_FOUND because `src/core/config.ts` does not exist yet
- Verified GREEN state preserved: all 16 existing unit tests continue to pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @napi-rs/keyring and zod** - `7df7e0c` (chore)
2. **Task 2: Create failing test scaffold for config module** - `c39ee5e` (test)

**Plan metadata:** (committed with SUMMARY below)

## Files Created/Modified
- `package.json` — added `@napi-rs/keyring: ^1.2.0` and `zod: ^4.3.6` to dependencies
- `package-lock.json` — lockfile updated with 3 new packages
- `tests/unit/config.test.ts` — 12 failing test stubs across 9 describe blocks (RED state)

## Decisions Made
- **keytar vs @napi-rs/keyring:** The CONTEXT.md and RESEARCH.md reference "keytar" by concept, but RESEARCH.md §Pitfall 1 is explicit: install `@napi-rs/keyring`, not `keytar`. The archived keytar has no Node.js v20+ prebuilts. Decision was already locked — applied as specified.
- **Entry class mock strategy:** `@napi-rs/keyring` main index exports `Entry` class (not a bare `getPassword` function). The config module will use `new Entry('backmail', accountName).getPassword()`. Tests mock the `Entry` class via `vi.mock` factory, exposing `_mockGetPassword` for per-test control.
- **12 tests vs 9:** The plan's `<behavior>` section specifies 3 distinct platform tests for `getConfigDir` and 2 path resolution tests for `repoPath`, yielding 12 tests total. The acceptance criteria says "9 `it(` calls" which conflicts with the behavior spec. Followed behavior spec for complete coverage — this is a minor inconsistency in the plan, not a deviation.

## Deviations from Plan

**1. [Rule 1 - Bug] Test count is 12 not 9**
- **Found during:** Task 2 (test scaffold creation)
- **Issue:** Plan acceptance criteria says "exactly 9 `it(` calls" but the `<behavior>` section specifies 12 distinct test cases (3 platform tests for getConfigDir, 2 path tests for repoPath, 7 credential tests)
- **Fix:** Followed the `<behavior>` section as ground truth; wrote 12 tests covering all specified behaviors
- **Files modified:** tests/unit/config.test.ts
- **Verification:** All 9 required describe block names present; all behaviors from `<behavior>` section covered
- **Committed in:** c39ee5e (Task 2 commit)

---

**Total deviations:** 1 (minor — test count discrepancy between plan sections, resolved in favor of fuller coverage)
**Impact on plan:** None — all required behaviors are tested, RED state is confirmed.

## Issues Encountered
- `@napi-rs/keyring` main export only has `Entry` class (no bare `getPassword` function). Keytar shim is at `@napi-rs/keyring/keytar` but the plan's mock target is `@napi-rs/keyring`. Test mock is written to mock the `Entry` class, which is what the implementation (Plan 02-02) will use.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RED state established: `tests/unit/config.test.ts` fails with MODULE_NOT_FOUND
- Plan 02-02 can implement `src/core/config.ts` to turn these tests GREEN
- All 9 describe block names match VALIDATION.md `-t` filter strings exactly
- Mock strategy documented: `vi.mock('@napi-rs/keyring')` mocks `Entry` class with `_mockGetPassword` spy

---
*Phase: 02-configuration*
*Completed: 2026-04-21*
