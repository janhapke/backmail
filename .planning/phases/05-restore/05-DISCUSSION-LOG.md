# Phase 5: Restore - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-22
**Phase:** 05-restore
**Areas discussed:** Source path, Progress & verbosity, Error handling, Target credentials

---

## Source path

| Option | Description | Selected |
|--------|-------------|----------|
| Main repo always | Always reads from repoPath in config, regardless of CWD | |
| CWD-aware: worktree if inside one | Detects if user is inside a worktree, restores from there | |
| Explicit --from path flag | User specifies source directory explicitly | |
| Positional date/commit arg | `backmail restore [<date|commit>] --to imap://` | ✓ |

**User's choice:** Positional date/commit argument (freeform/Other)
**Notes:** User described two restore scenarios: (1) migrate to new host — restore from HEAD; (2) point-in-time restore — restore from a past snapshot. They proposed that the command should mirror `backmail checkout <date|commit>` syntax, using an optional positional arg. When the arg is present, internally creates/reuses a worktree (via `checkoutCommit()`), then restores from it. When absent, restores from HEAD of the main repo.

---

## Progress & verbosity

| Option | Description | Selected |
|--------|-------------|----------|
| Per-folder summary | One line per folder as it finishes, summary at end | ✓ |
| Per-message lines | One line per message (verbose) | (via --verbose flag) |
| Summary only (silent) | No output until done | |

**User's choice:** Per-folder default + `--verbose` for per-message lines
**Notes:** Dry-run must use same output format and also respect `--verbose` flag.

---

## Error handling

| Option | Description | Selected |
|--------|-------------|----------|
| Continue, report at end | Skip failed messages, show error count in summary | ✓ |
| Fail fast | Abort on first error | |

**User's choice:** Continue and report at end
**Notes:** Error summary should include a hint: "Re-run with --skip-duplicates=yes to safely retry". `--skip-duplicates=yes` (default) makes re-runs idempotent — already-uploaded messages are skipped.

---

## Target credentials

| Option | Description | Selected |
|--------|-------------|----------|
| URL-embedded only | imap://user:pass@host — password in URL | ✓ |
| URL + env var fallback | Omit password in URL, fall back to BACKMAIL_RESTORE_PASSWORD | |

**User's choice:** URL-embedded only
**Notes:** Developer CLI, one-shot use. Password in shell history is user's responsibility.

**TLS protocol:**

| Option | Description | Selected |
|--------|-------------|----------|
| imaps:// only | Secure by default | |
| Both imap:// and imaps:// | imap:// = plain/STARTTLS, imaps:// = TLS | ✓ |
| You decide | Claude picks | |

**User's choice:** Both — Claude to confirm based on ImapFlow support
**Notes:** ImapFlow supports both via a single `secure` boolean flag — no significant extra work. Decision: support both `imap://` (secure: false, default port 143) and `imaps://` (secure: true, default port 993).

---

## Claude's Discretion

- IMAP URL parsing implementation
- Whether duplicate check uses `search()` or `fetchOne()`
- Exact column alignment in verbose message lines
- Whether to reuse ImapFlow connection per folder or reconnect

## Deferred Ideas

None.
