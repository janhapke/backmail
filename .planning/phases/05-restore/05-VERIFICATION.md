---
phase: 05-restore
verified: 2026-04-28T00:00:00Z
status: human_needed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification: true
previous_status: gaps_found
previous_score: 0/6
gaps_closed:
  - "TypeScript compilation succeeds (fixed in GAP plan)"
  - "Unit tests provide real assertions, not expect(true).toBe(true) stubs (fixed in GAP plan)"
  - "Integration tests exercise restoreAccount() with real fixtures (fixed in GAP plan)"
  - "CLI restore subcommand accessible via 'backmail restore --help' without config error (fixed in GAP plan)"
  - "dry-run with --skip-duplicates=yes connects read-only to target and correctly counts duplicates as skipped (fixed in GAP3)"
  - "--verbose flag emits one line per message (Uploaded / Skipped / Error) inside the message loop (fixed in GAP3)"
gaps: []
human_verification:
  - test: "Verify dry-run + skip-duplicates reports correct skipped count"
    expected: "Running 'npx tsx src/cli/index.ts restore --dry-run --to imap://user:pass@host' shows '[dry-run] Total: N uploaded, M skipped' where M > 0 when the target mailbox already contains messages present in the backup"
    why_human: "Requires a live IMAP server with pre-existing messages. Cannot verify duplicate detection count accuracy without a real or containerised IMAP target."
  - test: "Verify --verbose produces per-message output"
    expected: "Running 'npx tsx src/cli/index.ts restore --dry-run --verbose --to imap://user:pass@host' emits one 'Uploaded: <message-id>' or 'Skipped: <message-id>' line per message before the final summary line. Without --verbose, only the summary line appears."
    why_human: "Requires a reachable IMAP account. The code paths are confirmed present, but the output must be observed with real message data."
---

# Phase 5: Restore — GAP3 Re-Verification Report

**Phase Goal:** Close 2 major UAT gaps — dry-run ignores skip-duplicates, --verbose flag is silent
**Verified:** 2026-04-28T00:00:00Z
**Status:** human_needed
**Re-verification:** Yes — after GAP3 gap closure (third gap-closure iteration)

## Re-Verification Context

The initial VERIFICATION.md (2026-04-24) recorded 0/6 must-haves verified with critical blockers:
TypeScript compilation failure, all 40 tests were stubs, and the CLI subcommand was unreachable.

Three gap-closure plans have since been executed:

- **GAP plan:** Fixed two TypeScript errors in restore.ts, replaced all stub tests with real assertions, refactored CLI startup to allow --help without config.
- **GAP2 plan:** Fixed missing `await` on integration test connect() calls, stored `folderPath` in folder JSON for reliable path reconstruction, added credential sanitizer and type-safe error handler to CLI.
- **GAP3 plan (this verification):** Introduced `dryRunClient` for read-only SEARCH in dry-run mode; added `if (options.verbose)` guards at all four outcome branches in the message loop.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | dry-run with --skip-duplicates=yes connects read-only to target and correctly counts duplicates as skipped | VERIFIED (code) | `dryRunClient` created at line 175–183; `dryRunClient.connect()` at line 192–194; `searchClient = targetClient ?? dryRunClient` at line 253; `isDuplicate(searchClient, ...)` at line 255 |
| 2 | --verbose flag emits one line per message (Uploaded / Skipped / Error) inside the message loop | VERIFIED (code) | `if (options.verbose)` guards at lines 258, 278, 293, 300; covers Skipped branch, live-Uploaded branch, dry-run-Uploaded branch, and Error catch branch |

**Score:** 6/6 (all original gaps closed; 2 GAP3 truths verified in code; live-server confirmation deferred to human)

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/core/restore.ts` | read-only IMAP connection in dry-run when skipDuplicates=true | VERIFIED | `dryRunClient` declared with `(options.dryRun && options.skipDuplicates)` condition; connected and disconnected in try/finally |
| `src/core/restore.ts` | verbose logging inside message loop | VERIFIED | Four `if (options.verbose)` guards present at all outcome branches; ARCH-01 exception comment included |

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `restoreAccount (dryRun=true, skipDuplicates=true)` | `isDuplicate()` | `dryRunClient` passed as `searchClient` | WIRED | Line 253: `const searchClient = targetClient ?? dryRunClient`; line 255: `isDuplicate(searchClient, folderPath, messageId)` |
| `restoreAccount message loop` | `console output` | `options.verbose` guard | WIRED | Lines 258–261 (Skipped), 278–280 (Uploaded live), 293–295 (Uploaded dry-run), 300–302 (Error) |
| `dryRunClient` | `dryRunClient.connect()` | try block | WIRED | Line 192–194: `if (dryRunClient) { await dryRunClient.connect() }` |
| `dryRunClient` | `dryRunClient.logout()` | finally block | WIRED | Lines 315–317: `if (dryRunClient) { await dryRunClient.logout().catch(() => {}) }` |

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `restore.ts` message loop | `result.skipped` | `isDuplicate(searchClient, ...)` where `searchClient = targetClient ?? dryRunClient` | Yes — `isDuplicate` runs a real IMAP SEARCH command against the target server | FLOWING (code-verified; live confirm deferred to human) |

## TypeScript Compilation

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | EXIT 0 — zero errors |

## UAT Gap Status

| UAT Test | Gap | Previous Status | Current Status |
|----------|-----|-----------------|----------------|
| Test 5: Restore with Skip-Duplicates Default | dry-run always reports 0 skipped | issue (major) | resolved |
| Test 8: Verbose Output Flag | --verbose produces no output | issue (major) | resolved |

Both gaps marked `status: resolved` in 05-UAT.md frontmatter.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles | `npx tsc --noEmit` | Exit 0, no output | PASS |
| `dryRunClient` present in restore.ts | `grep dryRunClient src/core/restore.ts` | 5 matches (declaration, connect, searchClient assignment, logout) | PASS |
| `options.verbose` guards present | `grep "options.verbose" src/core/restore.ts` | 4 matches at lines 258, 278, 293, 300 | PASS |
| `isDuplicate` called with `searchClient` | `grep "isDuplicate(searchClient"` | Line 255: confirmed | PASS |
| Live IMAP duplicate count in dry-run | Requires live server | Not testable without live IMAP | SKIP (human needed) |
| Verbose output with real messages | Requires live server | Not testable without live IMAP | SKIP (human needed) |

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| REST-02 | --skip-duplicates=yes checks Message-ID before APPEND; --skip-duplicates=no skips check | SATISFIED | `searchClient = targetClient ?? dryRunClient` enables SEARCH in both live and dry-run modes |
| REST-03 | --dry-run prints what would be uploaded without writes | SATISFIED | `targetClient = null` in dry-run suppresses all APPEND/folder creation; `dryRunClient` enables SEARCH only |

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

The stale comment "D-15: Per-message verbose output (handled by CLI layer, not core)" has been removed; replaced with the ARCH-01 exception comment at the Skipped branch (line 259).

## Human Verification Required

### 1. Dry-Run Duplicate Detection — Live IMAP Confirmation

**Test:** Configure a real IMAP account. Run a full sync to populate the backup. Then run:
```
npx tsx src/cli/index.ts restore --dry-run --to imap://user:pass@host
```

**Expected:** Output shows `[dry-run] Total: N uploaded, M skipped` where M is greater than 0, matching the number of messages already present on the target. Running with `--skip-duplicates=no` should show M=0 and N equal to the total message count.

**Why human:** Duplicate detection requires a live IMAP connection with pre-existing messages. The `dryRunClient` code path is confirmed present and wired, but accurate skip counts can only be validated against a real server where matching Message-IDs exist.

### 2. Verbose Per-Message Output — Live IMAP Confirmation

**Test:** Using a configured account, run:
```
npx tsx src/cli/index.ts restore --dry-run --verbose --to imap://user:pass@host
```

**Expected:** One line per message printed before the final summary: either `Uploaded: <message-id>` or `Skipped: <message-id>`. Running without `--verbose` should produce only the summary line.

**Why human:** The `if (options.verbose)` guards are confirmed present in all four branches. The `console.log` calls will only be observable with actual message data flowing through the loop. Requires a backup with at least a few messages and a reachable IMAP server.

## Gaps Summary

No gaps remain. All six original gaps identified in the initial verification (2026-04-24) have been closed across three gap-closure plans. The two GAP3 must-haves are verified in code. The phase goal is achieved at the implementation level; human confirmation with a live IMAP server is the remaining step.

---

_Verified: 2026-04-28T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
