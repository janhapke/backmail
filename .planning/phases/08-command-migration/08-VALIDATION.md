---
phase: 08
slug: command-migration
status: complete
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-04
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.4 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/unit/cmd-migration.test.ts` |
| **Full suite command** | `npx vitest run tests/unit/` |
| **Estimated runtime** | ~7 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/unit/cmd-migration.test.ts`
- **After every plan wave:** Run `npx vitest run tests/unit/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~1 second

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | CMD-01 | T-08-01 | Legacy types absent from browse.ts | unit | `npx vitest run tests/unit/cmd-migration.test.ts` | ✅ | ✅ green |
| 08-01-02 | 01 | 1 | CMD-01 | T-08-01 | resolveAccount not exported from core/index.ts | unit | `npx vitest run tests/unit/cmd-migration.test.ts` | ✅ | ✅ green |
| 08-02-01 | 02 | 1 | CMD-02 | T-08-02 | resolveAccount import absent from cli/index.ts | unit | `npx vitest run tests/unit/cmd-migration.test.ts` | ✅ | ✅ green |
| 08-02-02 | 02 | 1 | CMD-02 | T-08-02 | getConfig() helper absent from cli/index.ts | unit | `npx vitest run tests/unit/cmd-migration.test.ts` | ✅ | ✅ green |
| 08-02-03 | 02 | 1 | CMD-02 | T-08-02 | --account option absent from all CLI commands | unit | `npx vitest run tests/unit/cmd-migration.test.ts` | ✅ | ✅ green |
| 08-02-04 | 02 | 1 | CMD-02 | T-08-02 | --all option absent from sync command | unit | `npx vitest run tests/unit/cmd-migration.test.ts` | ✅ | ✅ green |
| 08-02-05 | 02 | 1 | CMD-02 | T-08-03 | accounts subcommand absent from CLI | unit | `npx vitest run tests/unit/cmd-migration.test.ts` | ✅ | ✅ green |
| 08-02-06 | 02 | 1 | CMD-02 | T-08-02 | account?: typed opt absent from all action signatures | unit | `npx vitest run tests/unit/cmd-migration.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `backmail --help` output contains no mention of `--account` or `accounts` | CMD-02 | Requires CLI binary execution; covered implicitly by source assertions | Run `backmail --help` and grep for `account` |
| `backmail sync --help` output contains no mention of `--all` | CMD-02 | Requires CLI binary execution; covered implicitly by source assertions | Run `backmail sync --help` and grep for `all` |

---

## Validation Sign-Off

- [x] All tasks have automated verify
- [x] Sampling continuity: all tasks covered
- [x] No Wave 0 dependencies
- [x] No watch-mode flags
- [x] Feedback latency < 2s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-04

---

## Validation Audit 2026-05-04

| Metric | Count |
|--------|-------|
| Gaps found | 9 |
| Resolved (automated) | 8 |
| Manual-only | 2 (CLI binary --help; covered by source assertions) |
| Stale tests fixed | 1 (sync-cli.test.ts SYNC-06 block + BackmailConfig/AccountConfig imports removed) |
