# backmail

## What This Is

A TypeScript CLI that periodically mirrors one or more IMAP mailboxes to plaintext `.eml` files versioned in git. Each git repo is one mailbox backup — the git history is the archive. Users can browse email state at any point in time, restore a full inbox to a different IMAP provider, and eventually query their email through an AI-accessible MCP server.

Primary user is the developer (Jan) building it. Target evolution: developer-friendly first, then power users, then anyone with email.

## Core Value

The git repo IS the backup — point-in-time restore, local search, and provider independence without trusting any third-party service.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] User can configure one or more IMAP accounts in `~/.config/backmail/config.json` (OS-appropriate path)
- [ ] `backmail sync` performs incremental IMAP fetch and commits a delta to the git repo
- [ ] Sync mirrors deletions — emails removed from IMAP are removed from the repo (git history still has them)
- [ ] `backmail log` lists sync commits with date and `+added / -removed` counts
- [ ] `backmail checkout <date|commit>` creates a git worktree at that point in time (non-destructive, never detaches HEAD)
- [ ] `backmail ls [folder]` lists folders or messages at current checkout
- [ ] `backmail view <message-id> --format [eml|plaintext|json]` renders an email
- [ ] `backmail restore --to imap://user:pass@host [--skip-duplicates=yes/no] [--dry-run]` re-uploads messages to a target IMAP server
- [ ] Restore defaults to skip-duplicates=yes (checks Message-ID before APPEND); dry-run shows what would be uploaded
- [ ] Storage layout: `messages/<message-id>.eml` + `folders/<name>.json` (uidvalidity + uid/message-id/flags array)
- [ ] Installable via `npm install -g backmail`, `npx backmail`, and compiled binary
- [ ] Core sync logic is a clean TypeScript module with a well-defined API (eimerjs IPC boundary for future Electron integration)

### Out of Scope

- Plugins (markdown-export, mcp-server, dovecot-server) — v2; MCP access is a key future goal but not v1
- OAuth / Gmail OAuth — app passwords work; OAuth adds significant complexity, defer to v2
- Electron UI — coming, but eimerjs IPC is wired when it arrives; CLI-only for v1
- SaaS / multi-tenant — future idea; doesn't constrain v1 architecture
- Git LFS for attachments — store full .eml in git for v1, profile before optimizing
- HTML rendering in terminal — `--format plaintext` covers the common case; raw `.eml` for the rest

## Context

- Closest competitor: [imap-backup](https://github.com/joeyates/imap-backup) (Ruby, mbox format, no git)
- IMAP client library: [imapflow](https://imapflow.com/) — modern, actively maintained, used for test fixtures too
- Test infrastructure: [minimal-imap](https://github.com/gmitirol/minimal-imap) Docker container (Alpine + Dovecot) for integration tests; synthetic `.eml` fixtures (no real email in repo)
- Git deduplication: Gmail's label-as-folder model (same email appears in multiple folders) costs no extra git storage since identical blobs are deduplicated
- eimerjs: Jan's own IPC library, used here as a clean module boundary. No IPC in CLI-only phase; eimerjs wired when Electron arrives.
- UID handling: `uidvalidity` stored in folder JSON; if it changes, the rewritten JSON in git history marks the re-sync event. Last synced UID derived as `max(uid)` across the messages array.

## Constraints

- **Tech stack**: TypeScript + Node.js — not negotiable; Electron-compatible architecture required
- **Auth**: Plain IMAP (user:pass / app passwords) only for v1 — no OAuth
- **Storage**: One git repo per mailbox — multiple accounts = multiple repos
- **Deletions**: Mirror deletions from IMAP (not append-only)
- **Checkout**: Always use `git worktree`, never `git checkout` on main working tree

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| `.eml` files as source of truth; markdown exports are derived/cache | Keeps git repo as canonical archive; cache can be regenerated | — Pending |
| Message-ID as filename | Enables git-level dedup, stable cross-folder references | — Pending |
| One git repo per mailbox (not per account) | Clean separation; easy to move, clone, or archive a single mailbox | — Pending |
| `git worktree` for `checkout` (not detach HEAD) | Non-destructive — sync continues to work while user browses history | — Pending |
| Plugins deferred to v2 | Keeps v1 scope tight; plugins depend on a stable core sync API | — Pending |
| Plain IMAP only v1 | App passwords cover Gmail; OAuth is a significant auth flow to build and maintain | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-20 after initialization*
