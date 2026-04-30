---
phase: 09-init-command
plan: "01"
subsystem: test-scaffold
tags: [tdd, dependencies, test-stubs, arch-01]
dependency_graph:
  requires: []
  provides:
    - tests/unit/init.test.ts (RED stubs for initRepository)
    - tests/unit/cli-boundary.test.ts ARCH-01 block for init.ts
    - "@inquirer/prompts production dependency"
  affects:
    - package.json
    - tests/unit/cli-boundary.test.ts
tech_stack:
  added:
    - "@inquirer/prompts ^8.4.2 (production dependency for interactive CLI prompts)"
  patterns:
    - tmpDir fixture pattern (mkdtempSync + rmSync afterEach)
    - simple-git mock (init only)
    - "@napi-rs/keyring mock (getPassword + setPassword)"
    - ARCH-01 boundary describe block pattern
key_files:
  created:
    - tests/unit/init.test.ts
  modified:
    - package.json
    - package-lock.json
    - tests/unit/cli-boundary.test.ts
decisions:
  - "@inquirer/prompts installed as production dependency (not devDependency) — used by CLI interactive prompts in src/cli/index.ts"
  - "init.test.ts tmpDir starts empty (no .backmail/ pre-created) — initRepository creates it, unlike config.test.ts which pre-creates it"
  - "keyring mock includes both setPassword and getPassword — though initRepository tests do not assert keyring directly, the mock is available for future use"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-30"
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 3
---

# Phase 9 Plan 01: Install Dependencies and Create RED Test Stubs Summary

**One-liner:** @inquirer/prompts added as production dep; 5 RED unit tests for initRepository() and 3 RED ARCH-01 boundary tests for init.ts created.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install @inquirer/prompts | b95c1ec | package.json, package-lock.json |
| 2 | Create tests/unit/init.test.ts (RED stubs) | 8220045 | tests/unit/init.test.ts |
| 3 | Extend cli-boundary.test.ts with ARCH-01 init.ts block | 093e1a2 | tests/unit/cli-boundary.test.ts |

## What Was Built

**Task 1 — @inquirer/prompts install:** Added `@inquirer/prompts ^8.4.2` to the `dependencies` block in package.json. This is a production dependency required by the upcoming `backmail init` interactive CLI prompts.

**Task 2 — tests/unit/init.test.ts (RED):** Created 5 failing unit tests covering:
- REPO-01: Creates `.backmail/`, `.backmail/config.json`, `.backmail/log`, `archive/`, `worktrees/` in targetDir
- REPO-01: Writes config.json with all RepositoryConfig fields plus the passwordRef argument
- REPO-01: Calls `simpleGit(archivePath).init()` once
- REPO-04: Throws `"Repository already exists at"` error when `.backmail/` already exists
- REPO-04: Does not create any files when `.backmail/` guard triggers

All 5 tests fail with `Cannot find module '/src/core/init.js'` — RED state confirmed. Tests import from `../../src/core/init.js` which does not exist until plan 02.

**Task 3 — ARCH-01 boundary tests (RED):** Extended cli-boundary.test.ts with a new describe block enforcing that `src/core/init.ts`:
- Does not import from `src/cli/`
- Does not call `process.exit()`
- Does not call `console.*` methods

3 new tests fail with `ENOENT: src/core/init.ts` — RED state confirmed. Existing 12 boundary tests remain passing (no regressions).

## Deviations from Plan

None — plan executed exactly as written.

## TDD Gate Compliance

This plan is a TDD RED phase (test-only). No implementation exists yet — all test files are intentionally failing. GREEN phase is plan 02.

- RED gate: tests/unit/init.test.ts committed at 8220045 — confirmed failing
- RED gate: cli-boundary.test.ts ARCH-01 block committed at 093e1a2 — confirmed failing (3 tests)

## Known Stubs

None — this plan creates test stubs, not implementation stubs. The test imports are intentional RED-state failures.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. Only test infrastructure and package.json changes.

## Self-Check: PASSED

- tests/unit/init.test.ts: FOUND
- tests/unit/cli-boundary.test.ts (modified): FOUND
- package.json (@inquirer/prompts): FOUND
- commit b95c1ec: FOUND
- commit 8220045: FOUND
- commit 093e1a2: FOUND
