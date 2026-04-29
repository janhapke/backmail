---
phase: 07-repository-discovery
plan: 02
subsystem: cli
tags: [typescript, cli, commander, discovery, workdir, repository]

# Dependency graph
requires:
  - phase: 07-01
    provides: findRepository() from src/core/index.ts
  - phase: 06-configuration
    provides: loadRepositoryConfig(), RepositoryConfig from src/core/config.ts
provides:
  - CLI with --workdir global flag (DISC-02)
  - getRepoRoot() using findRepository() with DISC-03 error on null
  - getConfig() using loadRepositoryConfig(repoRoot)
  - All command actions using path.join(repoRoot, 'archive') for archivePath
affects:
  - 07-03 (init command — will call getRepoRoot() and loadRepositoryConfig())

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "getRepoRoot() calls findRepository then process.exit(1) with two-line DISC-03 message"
    - "getConfig() wraps loadRepositoryConfig() errors with process.exit(1)"
    - "All command actions: const repoRoot = getRepoRoot(); const archivePath = path.join(repoRoot, 'archive')"
    - "syncAccount(config, archivePath, opts) — config + repoPath separated"
    - "restoreAccount(config, archivePath, targetUrl, dateOrCommit, options)"

key-files:
  created: []
  modified:
    - src/cli/index.ts
    - src/core/sync.ts
    - src/core/restore.ts
    - src/core/browse.ts

key-decisions:
  - "getRepoRoot() calls process.exit(1) directly (not throw) — return type string is safe"
  - "getConfig() wraps loadRepositoryConfig errors — callers don't need try/catch"
  - "resolveAccount() import kept in CLI for Phase 8 removal; calls removed from all actions"
  - "[Rule 3] syncAccount signature changed to (config: RepositoryConfig, repoPath: string, opts) — matches v1.1 per-repo model"
  - "[Rule 3] restoreAccount signature changed to (config, archivePath, targetUrl, dateOrCommit, options)"
  - "[Rule 3] browse.ts legacy types defined inline (LegacyAccountConfig, LegacyBackmailConfig) — resolveAccount kept compilable for Phase 8"

requirements-completed:
  - DISC-01
  - DISC-02
  - DISC-03

# Metrics
duration: 4min
completed: 2026-04-29
---

# Phase 7 Plan 02: CLI Discovery Migration Summary

**Discovery-backed CLI with --workdir global flag, getRepoRoot()/getConfig() helpers, and all command actions using path.join(repoRoot, 'archive') for archive access**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-29T16:05:53Z
- **Completed:** 2026-04-29T16:09:34Z
- **Tasks:** 2 (+ 1 checkpoint pending human verification)
- **Files modified:** 4

## Accomplishments

- Updated `src/cli/index.ts`: added `path` import, replaced `loadConfig` with `findRepository`+`loadRepositoryConfig`, added `--workdir` global flag, replaced `getConfig()` with `getRepoRoot()`+`getConfig()` pair, updated all 6 command actions to use `archivePath = path.join(repoRoot, 'archive')`
- Removed all `resolveAccount()` calls from command actions (import kept for Phase 8)
- `accounts` command now prints `config.username` (single-repo model)
- `sync` command updated to single-repo model (no more `--all` / account loop)
- Fixed pre-existing type errors (Rule 3) in `sync.ts`, `restore.ts`, `browse.ts` that blocked `tsc --noEmit`

## Task Commits

1. **Tasks 1+2: Migrate CLI + fix core types** - `c2f5eee` (feat)

## Files Created/Modified

- `src/cli/index.ts` - Added `--workdir`, `getRepoRoot()`, `getConfig()`, updated all command actions
- `src/core/sync.ts` - Changed `syncAccount(config: RepositoryConfig, repoPath: string, opts)`, use `getPasswordByRef`
- `src/core/restore.ts` - Changed `restoreAccount(config, archivePath, targetUrl, dateOrCommit, options)`
- `src/core/browse.ts` - Removed deleted `BackmailConfig`/`AccountConfig` imports; defined `LegacyAccountConfig`/`LegacyBackmailConfig` inline

## Decisions Made

- `getRepoRoot()` uses `process.exit(1)` directly (DISC-03 requirement: exit code 1, exact two-line message with no CWD path)
- `getConfig()` wraps errors from `loadRepositoryConfig` so callers don't need try/catch
- `resolveAccount()` kept in import list for Phase 8 removal per D-09
- Core function signatures updated to match v1.1 per-repo model: separate `config` (IMAP credentials) from `repoPath`/`archivePath` (git repo location)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing type errors in sync.ts, restore.ts, browse.ts**
- **Found during:** Task 1 (tsc --noEmit revealed 6 errors from Phase 6 migration)
- **Issue:** Phase 6 replaced `AccountConfig`/`BackmailConfig`/`getPassword` with new credential types but did not update sync.ts, restore.ts, browse.ts. TypeScript compilation blocked.
- **Fix:** Updated sync.ts to use `RepositoryConfig + repoPath`, `getPasswordByRef`; updated restore.ts to use `RepositoryConfig + archivePath`; updated browse.ts to define legacy types inline for the deprecated `resolveAccount()` function
- **Files modified:** `src/core/sync.ts`, `src/core/restore.ts`, `src/core/browse.ts`
- **Commit:** `c2f5eee`

## Verification Results

- `npx tsc --noEmit`: PASS (0 errors)
- `npx vitest run tests/unit/`: PASS (124 passed, 1 skipped, 9 test files)
- `grep 'loadConfig' src/cli/index.ts`: empty (removed)
- `grep 'findRepository' src/cli/index.ts`: line 10 (import) + line 25 (call)
- `grep 'workdir' src/cli/index.ts`: lines 19, 23, 24, 30 (option + getRepoRoot)
- `grep 'archivePath' src/cli/index.ts`: 14 occurrences (all command actions)
- `grep 'resolveAccount(' src/cli/index.ts`: empty (calls removed, import kept)

## Checkpoint Pending

Task 3 (human-verify checkpoint) requires manual smoke tests:

1. **Outside a repo (DISC-03 error):**
   ```bash
   cd /home/jan/dev/backmail
   node dist/cli/index.js log 2>&1 || echo "exit $?"
   # Expected: "Error: Not inside a backmail repository." then exit 1
   ```

2. **--workdir to valid test repo:**
   ```bash
   mkdir -p /tmp/test-bm-repo/.backmail
   echo '{"host":"localhost","port":993,"username":"test","tls":true,"passwordRef":"env:BACKMAIL_PASSWORD"}' > /tmp/test-bm-repo/.backmail/config.json
   BACKMAIL_PASSWORD=test node dist/cli/index.js --workdir /tmp/test-bm-repo log 2>&1 || echo "exit $?"
   # Expected: git/archive error (not a discovery error)
   ```

3. **--workdir to nonexistent path:**
   ```bash
   node dist/cli/index.js --workdir /tmp/nonexistent-repo log 2>&1 || echo "exit $?"
   # Expected: "Error: Not inside a backmail repository." + exit 1
   ```

## Known Stubs

None - all command actions wire through to real core functions.

## Threat Surface Scan

- DISC-03 error message (T-07-05): implemented as exact two-line string with no dynamic content (no CWD path). Mitigated per plan.
- `--workdir` path.resolve() normalization (T-07-04): implemented. No path restriction (accept disposition).

## Self-Check: PASSED

- `src/cli/index.ts` exists and modified: FOUND
- `src/core/sync.ts` exists and modified: FOUND
- `src/core/restore.ts` exists and modified: FOUND
- `src/core/browse.ts` exists and modified: FOUND
- Commit `c2f5eee` exists: FOUND
- `npx tsc --noEmit` exits 0: CONFIRMED
- All unit tests pass: CONFIRMED (124/124)
