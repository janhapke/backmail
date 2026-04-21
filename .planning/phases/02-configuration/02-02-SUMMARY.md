---
phase: 02-configuration
plan: 02
status: complete
completed: 2026-04-21
duration: ~5min

key-files:
  created:
    - src/core/config.ts
  modified:
    - src/core/index.ts
    - tests/unit/config.test.ts

requirements-completed:
  - CONFIG-01
  - CONFIG-02
  - CONFIG-03
---

## Phase 2 Plan 02: Core Config Module Summary

**Implemented `src/core/config.ts` with OS-aware path resolution, Zod schema validation, loadConfig(), and getPassword() with @napi-rs/keyring→env-var fallback; turning all 12 RED tests GREEN**

## Accomplishments

- Implemented `getConfigPath()` — branches on `process.platform` for Linux (with XDG_CONFIG_HOME support), darwin, and win32
- Implemented `loadConfig()` — reads config JSON, validates with `ConfigSchema` (Zod), resolves `repoPath` to absolute (tilde expansion + config-dir-relative)
- Implemented `getPassword()` — uses `new Entry('backmail', accountName).getPassword()` from `@napi-rs/keyring`; falls back to `BACKMAIL_<ACCOUNT>_PASSWORD` env var; throws clear error when neither available
- Re-exported `BackmailConfig`, `getConfigPath`, `loadConfig`, `getPassword` from `src/core/index.ts`
- All 12 config tests GREEN; all 16 prior tests remain GREEN (28 total passing)

## Task Commits

1. **Task 1: Implement src/core/config.ts** — `7fe2dca` (feat)
2. **Task 2: Re-export config API from src/core/index.ts** — `25b8bcd` (feat)

## Key Decisions Applied

- Used `Entry` class from `@napi-rs/keyring` (not bare `getPassword` function per RESEARCH.md pitfall)
- `getPassword()` falls back to `BACKMAIL_<ACCOUNT>_PASSWORD` env var per D-06 (not generic `BACKMAIL_PASSWORD`)
- No `process.exit`, no `console.*` in `config.ts` — ARCH-01 boundary preserved

## Self-Check: PASSED

- `src/core/config.ts`: FOUND (117 lines)
- `src/core/index.ts`: re-exports confirmed
- `npx vitest run tests/unit/config.test.ts`: 12/12 pass
- Commits 7fe2dca, 25b8bcd: verified in git log
