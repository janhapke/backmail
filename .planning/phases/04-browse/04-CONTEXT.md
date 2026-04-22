# Phase 4: Browse - Context

**Gathered:** 2026-04-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement four read-only browse commands that let users inspect the synced mail archive:

- `backmail accounts` — list all configured account names
- `backmail log [--account <name>] [--limit <n>]` — show sync history
- `backmail checkout <date|commit> [--account <name>]` — create a git worktree snapshot
- `backmail ls [<folder>] [--account <name>]` — list folders or messages
- `backmail view <message-id> [--account <name>] [--format eml|plaintext|json]` — render a message

No write operations, no IMAP connections. These commands read only what Phase 3 sync has written.

Also: fix CR-01 (unsafe BigInt from corrupted folder JSON) defensively in browse code and in sync.ts.

</domain>

<decisions>
## Implementation Decisions

### Account resolution (all browse commands)
- **D-01:** All browse commands use `--account <name>` flag — no positional account argument. This overrides the BROW-01/BROW-02 requirement spec which listed `[<account>]` as positional; the flag form is consistent across all four commands.
- **D-02:** `--account` is optional when exactly one account is configured (auto-selected). When multiple accounts exist and `--account` is omitted, exit non-zero with a message listing the available accounts.
- **D-03:** Add `backmail accounts` command that prints all configured account names from config (one per line). Requires no account flag — it operates on the config itself.

### backmail log
- **D-04:** Output one line per sync commit in the format: `YYYY-MM-DD: +N added / -N removed`. Matches the commit message format from Phase 3 (D-07). Partial commits show: `YYYY-MM-DD [partial]: +N added / -N removed`.
- **D-05:** `--limit <n>` flag controls how many commits to show, newest first. Default: 20. Accepts the string `"unlimited"` to show all commits. Any positive integer is valid.

### backmail checkout
- **D-06:** Worktree is created at `<repoPath>/.worktrees/<date-or-short-hash>`. The `.worktrees/` directory is added to `.gitignore` inside the repo on first use, so worktrees are never tracked by git.
- **D-07:** If a worktree already exists at the target path, overwrite it — remove the existing worktree (`git worktree remove --force`) then recreate it.
- **D-08:** When the argument looks like a date (`YYYY-MM-DD`), resolve to the **last** git commit on that date. If no commit exists on that date, exit non-zero with a clear error. When the argument does not match the date pattern, treat it as a commit hash.
- **D-09:** On success, print: `Checked out <date-or-hash> (<short-sha>) → <absolute-path>`. Path is the absolute path to the created worktree.
- **D-10:** Worktree name for a date input: the date string (e.g. `2026-04-22`). Worktree name for a commit hash input: the first 7 characters of the hash.

### backmail ls
- **D-11:** `backmail ls` (no folder argument) lists all folders — one folder name per line, read from `folders/*.json` filenames inside the repo. No message counts or other metadata in Phase 4.
- **D-12:** `backmail ls <folder>` lists messages inside that folder. Each message line shows: `<message-id>  <date>  <from>  <subject>` (tab-separated or aligned columns). Date, From, and Subject are parsed from the EML file headers.
- **D-13:** Folder matching for `backmail ls <folder>` uses the same logic as Phase 3 `--only-folder`: full IMAP path match or leaf name match (case-sensitive).
- **D-14:** Always reads from the main repo (repoPath from config). No CWD-based worktree detection.

### backmail view
- **D-15:** Default format when `--format` is omitted: `plaintext`.
- **D-16:** `--format eml` — output the raw `.eml` file contents to stdout verbatim.
- **D-17:** `--format plaintext` — extract the `text/plain` MIME part. If no `text/plain` part exists, exit non-zero: `No text/plain part found. Use --format eml or --format json to inspect.`
- **D-18:** `--format json` — output a JSON object: `{ "headers": Record<string, string>, "parts": Array<{ "type": string, "content": string }> }`. All headers are included in the map; `parts` contains every MIME part with its content-type and decoded string content.
- **D-19:** `view` resolves the message by looking up `<message-id>.eml` in the `messages/` directory of the repo. The message-id is passed as-is; the same sanitization from sync (T-3-01) must be applied before the filesystem lookup.

### CR-01: Safe BigInt handling
- **D-20:** Phase 4 browse commands that parse `folders/*.json` must handle `uidvalidity` defensively: parse as a plain string (it is already stored as a string in the JSON schema), never construct `BigInt()` from it. Also audit and patch the same unsafe pattern in `sync.ts` where it exists.

### Claude's Discretion
- MIME parsing library choice (mailparser, postal-mime, or similar Node.js library)
- Exact column width / alignment / truncation in `ls` message listing output
- How `log` parses commit messages (git log --format or simple-git `log()`)
- Date-vs-hash detection heuristic in `checkout` (regex `/^\d{4}-\d{2}-\d{2}$/`)
- Whether `accounts` subcommand is in `src/core/` or purely CLI-layer (no IMAP, no file I/O beyond config — acceptable in CLI)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Browse requirements
- `.planning/REQUIREMENTS.md` §BROW-01 through BROW-04 — the four commands (note: D-01 changes account arg from positional to flag)

### Project context
- `.planning/PROJECT.md` — git worktree mandate (never detach HEAD), Message-ID as filename, storage layout

### Prior phase decisions
- `.planning/phases/01-foundation/01-CONTEXT.md` — ESM, tsx, Vitest, core/CLI split rules
- `.planning/phases/02-configuration/02-CONTEXT.md` — loadConfig() API, getPassword(), BackmailConfig type
- `.planning/phases/03-sync/03-CONTEXT.md` — sanitizeMessageId (T-3-01), folderPathToFilename (T-3-02), folder JSON schema, commit message format

### Storage layout (what Phase 4 reads)
- `messages/<sanitized-message-id>.eml` — raw RFC822 files written by sync
- `folders/<sanitized-folder-path>.json` — `{ uidvalidity: string, uidnext: number, messages: Array<{ uid: number, "message-id": string, flags: string[] }> }`
- `src/core/sync.ts` — sanitizeMessageId and folderPathToFilename functions to reuse in browse

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/sync.ts` → `sanitizeMessageId()` and `folderPathToFilename()` — reuse in browse commands for filesystem lookups
- `src/core/config.ts` → `loadConfig()` — call to get account list and repoPath; already handles OS-specific path, tilde, and relative resolution
- `src/core/index.ts` — re-export browse functions from here (log, checkout, ls, view)
- `src/cli/index.ts` — add subcommands following the thin-wrapper pattern already established for `sync`
- `simple-git` — already in package.json from Phase 3; use for `git log` and `git worktree` operations

### Established Patterns
- ESM, `.js` extensions on all relative imports
- No `process.exit()` or `console.*` in `src/core/` — browse functions throw errors, CLI handles output
- Core functions receive `AccountConfig` (or repoPath string) — never load config themselves
- Commander subcommand action functions call core, then format and print to stdout

### Integration Points
- `src/core/index.ts` — add exports: `listFolders()`, `listMessages()`, `viewMessage()`, `getLog()`, `checkoutDate()`
- `src/cli/index.ts` — add `accounts`, `log`, `checkout`, `ls`, `view` subcommands
- MIME library not yet in `package.json` — Phase 4 adds it

</code_context>

<specifics>
## Specific Ideas

- `backmail accounts` output: one account name per line, e.g. `gmail\nwork\n`. No headers, no decoration. Simple for scripting.
- `backmail log` column format: `2026-04-22: +143 added / -2 removed` (same string as git commit message subject, extracted verbatim)
- Worktree `.gitignore` entry: append `.worktrees/` to `<repoPath>/.gitignore` if not already present, on first `checkout`
- `checkout` date detection regex: `/^\d{4}-\d{2}-\d{2}$/` — anything else is treated as a commit ref
- `view` message-id lookup: apply sanitizeMessageId() to the CLI argument before constructing the path `messages/<sanitized>.eml`

</specifics>

<deferred>
## Deferred Ideas

- `ls --at <date>` flag to browse a historical worktree snapshot without cd-ing into it (deferred to Phase 5+)
- `ls` message count in folder listing (`backmail ls` without folder arg)
- `log --since / --until` date range filtering
- IMAP flags shown in `ls` message listing
- `view --format html` to open in browser
- `backmail worktree list` / `backmail worktree remove` to manage worktrees

</deferred>

---

*Phase: 04-browse*
*Context gathered: 2026-04-22*
