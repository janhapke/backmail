# Phase 5: Restore - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement `backmail restore [<date|commit>] --to <imap-url>` — re-upload messages from a backup to a target IMAP server with duplicate-checking and dry-run support.

Requirements in scope: REST-01, REST-02, REST-03, REST-04.
No new IMAP source connections (only reads local `.eml` files and `folders/*.json`).

</domain>

<decisions>
## Implementation Decisions

### Command signature
- **D-01:** Command signature: `backmail restore [<date|commit>] --to <imap-url>`. The positional argument is optional — same date-vs-hash logic as `backmail checkout` (Phase 4 D-08).
- **D-02:** When `<date|commit>` is absent, restore reads from the main repo at HEAD (`repoPath` from config).
- **D-03:** When `<date|commit>` is present, internally calls `checkoutCommit()` (Phase 4) to create/reuse a worktree at that point in time, then restores from that worktree. This makes point-in-time restore transparent — no need for the user to manually manage worktrees before restoring.
- **D-04:** If the specified date has no matching commit → exit non-zero with a clear error (same as `checkout`).

### Account resolution
- **D-05:** `--account <name>` flag (optional when one account configured, required when multiple). Carries forward from Phase 4 D-01 / D-02.

### Target URL and credentials
- **D-06:** `--to <imap-url>` is required. URL format: `imap://user:pass@host:port` or `imaps://user:pass@host:port`. Password is embedded in URL — developer tool, one-shot use.
- **D-07:** `imap://` → `secure: false` (port defaults to 143). `imaps://` → `secure: true` (port defaults to 993). Both use `logger: false` in the ImapFlow constructor (Phase 3 T-3-03 mandatory rule).
- **D-08:** URL-embedded password only — no separate `--password` flag or env var fallback for the target connection.

### Folder structure on target
- **D-09:** REST-04: restore creates missing folders on the target server (IMAP `CREATE` command) before uploading messages. Folder paths come from `folders/*.json` filenames (same set Phase 3 sync maintains).

### Duplicate checking (REST-02)
- **D-10:** `--skip-duplicates=yes` (default): before each APPEND, check whether the target folder already contains a message with the same Message-ID by searching with `SEARCH HEADER Message-ID <id>`. If found, skip and count as "skipped".
- **D-11:** `--skip-duplicates=no`: upload without checking. Faster for clean migrations to an empty mailbox.

### Dry-run (REST-03)
- **D-12:** `--dry-run`: same output format as a live run but nothing is written to the target IMAP server. No connection for writes (may still connect to check duplicates when `--skip-duplicates=yes`; skip that check too in dry-run for simplicity — dry-run is advisory, not exact).
- **D-13:** Dry-run output format mirrors live output. Respects `--verbose`.

### Progress and verbosity
- **D-14:** Default output: one line per folder as it completes: `INBOX: 143 uploaded, 2 skipped`. Final summary line: `Total: 543 uploaded, 12 skipped, 0 errors`.
- **D-15:** `--verbose` flag: additionally print one line per message: `  ↳ <message-id>`. Works in both live and dry-run modes.
- **D-16:** Dry-run lines are prefixed with `[dry-run]`.

### Error handling
- **D-17:** On per-message APPEND failure: continue, log the error, count it. Do not abort the restore.
- **D-18:** Final summary includes error count: `Total: 540 uploaded, 12 skipped, 3 errors`. Exit non-zero if any errors.
- **D-19:** Error summary includes a hint: `Re-run with --skip-duplicates=yes to safely retry (already-uploaded messages will be skipped)`.

### Claude's Discretion
- IMAP URL parsing implementation (Node.js `URL` constructor or manual regex)
- Whether duplicate check uses ImapFlow `search()` or `fetchOne()` — whichever is simpler
- Exact column width / alignment in verbose message lines
- Whether to reuse the same ImapFlow connection per folder or reconnect per folder

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Restore requirements
- `.planning/REQUIREMENTS.md` §REST-01 through REST-04 — the four restore requirements

### Project context
- `.planning/PROJECT.md` — core/CLI split rules, eimerjs IPC boundary, storage layout

### Prior phase decisions
- `.planning/phases/01-foundation/01-CONTEXT.md` — ESM, tsx, Vitest, core/CLI split rules
- `.planning/phases/02-configuration/02-CONTEXT.md` — loadConfig() API, getPassword(), BackmailConfig type
- `.planning/phases/03-sync/03-CONTEXT.md` — sanitizeMessageId (T-3-01), folderPathToFilename (T-3-02), folder JSON schema, ImapFlow logger:false rule
- `.planning/phases/04-browse/04-CONTEXT.md` — checkoutCommit() API, account resolution (D-01–D-03), worktree path pattern

### Storage layout (what Phase 5 reads)
- `messages/<sanitized-message-id>.eml` — raw RFC822 files to APPEND
- `folders/<sanitized-folder-path>.json` — `{ uidvalidity: string, uidnext: number, messages: Array<{ uid, "message-id", flags }> }` — defines which folders and messages to restore

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/sync.ts` → `sanitizeMessageId()` and `folderPathToFilename()` — reuse for building file paths during restore
- `src/core/browse.ts` → `checkoutCommit()` — call when `<date|commit>` positional arg is provided
- `src/core/config.ts` → `loadConfig()` and `getPassword()` — account config and credentials
- `src/core/index.ts` — re-export `restoreAccount()` and related types from here
- `src/cli/index.ts` — add `restore` subcommand following the thin-wrapper pattern
- `imapflow` — already installed; used in sync.ts for IMAP source; reuse for IMAP target (APPEND, SEARCH, CREATE)
- `simple-git` — already installed; potentially needed only if `checkoutCommit()` is called

### Established Patterns
- `logger: false` is MANDATORY in every ImapFlow constructor (T-3-03)
- No `process.exit()` or `console.*` in `src/core/` — `restoreAccount()` throws errors, CLI handles output
- Core functions receive `AccountConfig` and explicit parameters — never load config themselves
- Commander subcommand actions call core, format output, print to stdout/stderr

### Integration Points
- `src/core/index.ts` — add exports: `restoreAccount()`, `RestoreOptions`, `RestoreResult`
- `src/cli/index.ts` — add `restore [date-or-commit]` subcommand with `--to`, `--skip-duplicates`, `--dry-run`, `--verbose`, `--account` options

</code_context>

<specifics>
## Specific Ideas

- Command mirrors `backmail checkout`: `backmail restore [<date|commit>] --to <imap-url>` — the positional arg is the same date-or-hash syntax
- Per-folder output line: `INBOX: 143 uploaded, 2 skipped` (or `[dry-run] INBOX: would upload 143, skip 2`)
- Verbose per-message line: `  ↳ <message-id>`
- Summary: `Total: 543 uploaded, 12 skipped, 0 errors`
- Error hint on non-zero exit: `Re-run with --skip-duplicates=yes to safely retry`
- Two-use-case mental model: (1) migrate to new host → `backmail restore --to imaps://user:pass@newhost` (from HEAD); (2) point-in-time restore → `backmail restore 2026-01-15 --to imaps://user:pass@newhost`

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope.

</deferred>

---

*Phase: 05-restore*
*Context gathered: 2026-04-22*
