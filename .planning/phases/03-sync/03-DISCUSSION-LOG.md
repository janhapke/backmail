# Phase 3: Sync - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 03-sync
**Areas discussed:** Folder scope, First-run repo init, CLI output, Partial failure

---

## Folder scope

| Option | Description | Selected |
|--------|-------------|----------|
| All folders | Sync everything the server exposes. Git deduplicates identical blobs so Gmail label duplication costs no extra storage. | ✓ |
| INBOX only by default | Only INBOX unless `folders` key added to account config. | |
| Configurable, no default | Require `folders` key in config — fail if missing. | |

**User's choice:** All folders by default; add `--exclude-folder=<name>` (repeatable) and `--only-folder=<name>` (repeatable) flags. Match on full IMAP path or leaf folder name; no wildcards.

**Notes:** User asked if full IMAP paths exist — yes, server-defined separator (Gmail uses `/`, Dovecot often `.`). Leaf matching handles path-agnostic use.

---

## First-run repo init

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-init silently | `git init` automatically, no output. | |
| Auto-init with printed note | `git init` + print `Initialized git repo at <path>` to stdout. | ✓ |
| Throw with instructions | Error out, user must run `git init` manually. | |

**User's choice:** Auto-init with printed note.

---

## CLI output

| Option | Description | Selected |
|--------|-------------|----------|
| Summary line only | One line when done: `<account>: +42 added / -3 removed`. | ✓ (base) |
| Real-time progress | Print per-folder progress during fetch. | |
| Silent by default | No output unless --verbose. | |

**User's choice:** Summary line by default; `--verbose` flag enables one log line per folder and per message.

---

## Partial failure

| Option | Description | Selected |
|--------|-------------|----------|
| Commit what was fetched | Partial progress committed with `[partial]` marker. | ✓ |
| Rollback — commit nothing | Revert all changes on failure. | |
| Leave files, no commit | Write files but don't commit — dirty repo state. | |

**User's choice:** Commit what was fetched. Commit message format: `YYYY-MM-DD [partial]: +N added / -N removed` — the date always comes first, `[partial]` inserted before the colon.

---

## Claude's Discretion

- Git library choice (simple-git recommended)
- imapflow connection strategy
- Internal module structure within `src/core/sync.ts`
- Fetch scope per message (full RFC822 body for .eml)

## Deferred Ideas

None.
