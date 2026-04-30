---
phase: 09-init-command
plan: "02"
subsystem: core
tags: [init, repository, filesystem, git]
dependency_graph:
  requires: [09-01]
  provides: [initRepository-core-function]
  affects: [src/core/index.ts]
tech_stack:
  added: []
  patterns: [ARCH-01, node:fs-sync, simpleGit-init]
key_files:
  created:
    - src/core/init.ts
  modified:
    - src/core/index.ts
decisions:
  - "Use sync node:fs (not fs/promises) — consistent with loadRepositoryConfig() and no concurrency concern during init"
  - "Write archive/ and worktrees/ before .backmail/ so failed git init leaves no repo marker"
  - "passwordRef argument overwrites config.passwordRef via spread ordering — caller's passwordRef is authoritative"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-30T21:11:38Z"
  tasks_completed: 2
  files_changed: 2
---

# Phase 9 Plan 02: Implement initRepository() — Summary

Pure-core initRepository() function that creates the .backmail repository layout and initializes the git archive, turning the RED tests from plan 01 GREEN.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement src/core/init.ts | 1ee412d | src/core/init.ts (created) |
| 2 | Export initRepository from src/core/index.ts | 3631c74 | src/core/index.ts (modified) |

## What Was Built

`src/core/init.ts` implements `initRepository(targetDir, config, passwordRef)`:

1. REPO-04 guard: throws `Error(/Repository already exists at/)` if `.backmail/` already exists — checked before any writes
2. Creates `archive/` and `worktrees/` directories via `fs.mkdirSync(..., { recursive: true })`
3. Calls `simpleGit(archivePath).init()` to initialize the git repo
4. Creates `.backmail/`, writes `.backmail/log` (empty), writes `.backmail/config.json` with `{ ...config, passwordRef }`

Write order ensures `.backmail/` is never created if git init fails, so the non-destructive guard remains accurate on re-run.

`src/core/index.ts` gains one new export block:
```typescript
// Phase 9: Init module public API
export { initRepository } from './init.js'
```

## Test Results

All 5 tests in `tests/unit/init.test.ts` pass GREEN.
All 31 unit tests across init, cli-boundary, and core-api-boundary test files pass.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — initRepository() is fully wired with no placeholder values.

## Threat Surface Scan

No new security-relevant surface beyond what the plan's threat model covers:
- T-9-02-01: path.resolve() in CLI (plan 03) before passing targetDir — acceptable
- T-9-02-02: config.json permissions follow fs defaults — passwordRef is a reference string, not the password
- T-9-02-03: REPO-04 guard mitigated — fs.existsSync check before any writes

## Self-Check

- [x] src/core/init.ts exists
- [x] ARCH-01 comment present in init.ts
- [x] No actual process.exit or console.* calls in init.ts (comment match only)
- [x] initRepository exported from src/core/index.ts
- [x] Commits 1ee412d and 3631c74 exist
