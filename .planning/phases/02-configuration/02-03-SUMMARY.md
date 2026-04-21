---
phase: 02-configuration
plan: 03
subsystem: cli
tags: [cli, config, boundary-tests, arch-01, arch-02, d-08]

# Dependency graph
requires:
  - phase: 02-configuration
    plan: 02
    provides: src/core/config.ts with loadConfig(), getConfigPath(), getPassword()
provides:
  - "src/cli/index.ts: calls loadConfig() before dispatch, exits 1 with D-08 message on missing config"
  - "tests/unit/cli-boundary.test.ts: 4 new ARCH-01 tests covering config.ts boundary"
affects:
  - Phase 3+ plans: CLI config loading is complete; subcommands receive config object

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLI short-circuit: check for --help/-h in process.argv before config loading"
    - "Commander help/version flags bypass config validation by design"

key-files:
  created: []
  modified:
    - "src/cli/index.ts — added loadConfig() call with D-08 error handling and --help short-circuit"
    - "tests/unit/cli-boundary.test.ts — added ARCH-01 describe block with 4 config.ts boundary tests"
    - "src/core/config.ts — removed 'process.exit()' text from comment header (triggered boundary test)"

key-decisions:
  - "Short-circuit --help/-h before config loading: Commander's --help is handled inside program.parse(); checking argv before config load ensures help works without a config file"
  - "Comment text fix in config.ts: the ARCH-01 boundary test uses regex /process\\.exit/ against the source text; the original comment 'no process.exit()' triggered a false positive; updated comment to 'no exit calls'"

# Metrics
duration: ~5min
completed: 2026-04-21
---

# Phase 2 Plan 03: CLI Config Wiring and Boundary Tests Summary

**CLI wired to call loadConfig() before dispatch with D-08 error handling; ARCH-01 boundary tests extended to guard config.ts against process.exit, console calls, and CLI imports**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-21T19:20:00Z
- **Completed:** 2026-04-21T17:24:14Z
- **Tasks:** 2
- **Files modified:** 3 (src/cli/index.ts, tests/unit/cli-boundary.test.ts, src/core/config.ts)

## Accomplishments

- Updated `src/cli/index.ts` to import and call `loadConfig()` before `program.parse()`
- Added `--help`/`-h` short-circuit so Commander help works without a config file
- Added D-08 error catch block: `console.error(message)` + `process.exit(1)`
- No `getPassword()` call in CLI (lazy credential loading per D-09)
- No `backmail config` subcommand (D-01)
- Added `describe('ARCH-01: src/core/config.ts module boundary enforcement', ...)` block with 4 tests
- All 32 tests pass (`npm test` exits 0)

## Task Commits

1. **Task 1: Wire loadConfig into CLI entry point** — `4cb7e9b` (feat)
2. **Task 2: Extend ARCH-01 boundary tests to cover config.ts** — `455f94c` (feat)

## Files Created/Modified

- `src/cli/index.ts` — added `import { loadConfig }`, config loading with error handler, --help short-circuit
- `tests/unit/cli-boundary.test.ts` — appended ARCH-01 describe block (4 tests for config.ts boundary)
- `src/core/config.ts` — changed comment from `no process.exit()` to `no exit calls` (false-positive fix)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] --help did not short-circuit config loading**
- **Found during:** Task 1 verification
- **Issue:** Commander's `--help` flag is processed inside `program.parse()`, which runs after `loadConfig()`. On a machine without a config file, `--help` returned exit 1 with a D-08 error instead of the help text.
- **Fix:** Added `if (args.includes('--help') || args.includes('-h'))` check before `loadConfig()` that calls `program.parse()` and exits 0 immediately
- **Files modified:** src/cli/index.ts
- **Commit:** 4cb7e9b

**2. [Rule 1 - Bug] config.ts comment text triggered ARCH-01 boundary test false positive**
- **Found during:** Task 2 test run
- **Issue:** `src/core/config.ts` header comment read `// ARCH-01: no process.exit(), no console.*` — the string `process.exit` in the comment matched the new boundary test regex `/process\.exit/`
- **Fix:** Updated comment to `// ARCH-01: no exit calls, no console.*` (semantically identical, no pattern match)
- **Files modified:** src/core/config.ts
- **Commit:** 455f94c

## Known Stubs

None — `loadConfig()` returns real config from disk; no placeholder data flows to any output.

## Threat Flags

No new security-relevant surface introduced beyond what was specified in the plan's threat model (T-02-10 through T-02-13). The `console.error((err as Error).message)` pattern correctly prints only the error message string, not the stack trace or env var values.

## Self-Check

- src/cli/index.ts: FOUND
- tests/unit/cli-boundary.test.ts: FOUND (contains ARCH-01 describe block)
- src/core/config.ts: FOUND (no process.exit calls, no console calls)
- Commit 4cb7e9b: verified
- Commit 455f94c: verified
- npm test: 32 tests, all pass
- npx tsx src/cli/index.ts --help: exits 0
- npx tsx src/cli/index.ts (no config): exits 1 with D-08 message

## Self-Check: PASSED
