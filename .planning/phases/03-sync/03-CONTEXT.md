# Phase 3: Sync - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement `backmail sync [<account>]` — connect to IMAP via imapflow, fetch new messages as `.eml` files under `messages/`, update `folders/<name>.json` with uid/message-id/flags arrays, mirror IMAP deletions, and commit a labelled delta to the git repo. Also `backmail sync --all` to sync every configured account.

No browse, restore, or read commands — sync is the sole deliverable.

</domain>

<decisions>
## Implementation Decisions

### Folder scope
- **D-01:** Sync all IMAP folders the server exposes by default — no opt-in needed. Git deduplicates identical blobs so Gmail label-as-folder duplication costs no extra storage.
- **D-02:** `--exclude-folder=<name>` flag (repeatable) to skip specific folders. `--only-folder=<name>` flag (repeatable) to restrict sync to specific folders. Both flags are mutually exclusive of each other.
- **D-03:** Folder matching supports both full IMAP path (e.g. `[Gmail]/Sent Mail`) and leaf folder name (e.g. `Sent Mail`). No wildcards or glob patterns.

### First-run repo initialization
- **D-04:** When `repoPath` does not contain a git repository, auto-initialize it with `git init` and print a note to stdout: `Initialized git repo at <path>`. The directory is created if it doesn't exist. User does not need to manually run `git init`.

### CLI output
- **D-05:** Default output: one summary line per account when sync completes — format matches the commit message: `<account>: +N added / -N removed`. Errors go to stderr.
- **D-06:** `--verbose` flag enables one log line per folder and per message during fetch (e.g. `[INBOX] Fetching uid 1234 → abc@example.com.eml`). Verbose output goes to stdout.

### Commit message format
- **D-07:** Normal sync commit: `YYYY-MM-DD: +N added / -N removed`
- **D-08:** Partial sync commit (failure mid-run with partial progress): `YYYY-MM-DD [partial]: +N added / -N removed`. The date always comes first.

### Partial failure behavior
- **D-09:** If sync fails mid-run (IMAP disconnect, disk error, etc.) and at least one message was written, commit what was fetched with the `[partial]` commit message. Progress is preserved and next sync picks up from the last known UID. If nothing was fetched before failure, no commit is made.

### Claude's Discretion
- Git library choice (simple-git vs isomorphic-git vs execa + git shell) — recommend simple-git as it wraps the git binary the user already has
- imapflow connection strategy (one connection per folder or one connection iterate folders)
- Fetch scope per message (headers only vs full body) — fetch full RFC822 body for `.eml` storage
- uidvalidity change handling implementation detail (full folder re-sync per SYNC-05)
- Internal module structure within `src/core/sync.ts`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Sync requirements
- `.planning/REQUIREMENTS.md` §SYNC-01 through SYNC-06 — incremental fetch, commit message format, deletion mirroring, folder JSON schema, uidvalidity handling, --all flag

### Project context
- `.planning/PROJECT.md` — imapflow library choice, Message-ID as filename rationale, git blob deduplication note for Gmail labels, eimerjs IPC boundary (core must be importable without CLI), plain IMAP only (no OAuth)

### Prior phase decisions
- `.planning/phases/01-foundation/01-CONTEXT.md` — ESM, tsx, Vitest, core/CLI split rules (no process.exit/console.* in core)
- `.planning/phases/02-configuration/02-CONTEXT.md` — `loadConfig()` API, `getPassword()` async lazy lookup, named account key scheme, `BackmailConfig` type

### Storage layout
- `src/core/index.ts` — `AccountConfig` interface (`host, port, username, tls, repoPath`)
- `src/core/config.ts` — `loadConfig()`, `getPassword()` implementations Phase 3 calls

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/config.ts` → `loadConfig()` (sync), `getPassword(accountName)` (async) — call these to get connection credentials before opening imapflow connection
- `src/core/index.ts` → `AccountConfig` interface — reuse as the type for account-level sync configuration
- `src/cli/index.ts` — Commander skeleton; Phase 3 adds a `sync` subcommand here following the thin-wrapper pattern

### Established Patterns
- ESM (`"type": "module"`) — all imports use `.js` extensions in source files
- No `process.exit()` or `console.*` in `src/core/` — sync logic must throw errors, not exit. Output is the CLI layer's responsibility.
- ARCH-02: all sync logic belongs in `src/core/sync.ts` (or similar); CLI wrapper in `src/cli/index.ts` handles output and exits
- `getPassword()` is async — sync command must be async end-to-end
- Vitest + docker-compose Dovecot for integration tests (already wired via `npm run test:integration`)

### Integration Points
- `src/core/index.ts` — re-export `sync()` function and related types from this boundary file
- `src/cli/index.ts` — add `program.command('sync')` that calls core sync, handles `--all`, `--exclude-folder`, `--only-folder`, `--verbose` flags, prints summary to stdout
- imapflow not yet in `package.json` — Phase 3 adds it as a dependency
- git library (simple-git or equivalent) not yet in `package.json` — Phase 3 adds it

</code_context>

<specifics>
## Specific Ideas

- Commit message date format: `YYYY-MM-DD` (ISO 8601 date only, no time component)
- Partial failure commit prefix: `[partial]` inserted between date and colon separator — `YYYY-MM-DD [partial]: +N added / -N removed`
- Folder flag semantics: `--only-folder` and `--exclude-folder` are mutually exclusive; passing both is an error
- Leaf folder matching: if `[Gmail]/Sent Mail` is passed as full path it matches exactly; if `Sent Mail` is passed it matches any folder whose path ends with `Sent Mail` (case-sensitive)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-sync*
*Context gathered: 2026-04-21*
