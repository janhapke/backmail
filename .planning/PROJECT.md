# backmail

## Current Milestone: v1.1 — Repository-Centric UX

**Goal:** Replace the central config model with self-contained "backmail repositories" and redesign the CLI around them for a far more intuitive user experience.

**Target features:**
- `backmail init` creates a backmail repository with a well-defined directory layout
- Git-style auto-detection: commands find the repo by walking up from CWD for `.backmail/`
- `--workdir <path>` global flag to explicitly target a different repository
- Password stored in OS keyring during `init`, referenced in config as `keyring:service=X;account=Y`
- `BACKMAIL_PASSWORD` env var as fallback
- All existing commands (sync, log, ls, view, checkout, restore) work with the new structure

## What This Is

A TypeScript CLI that mirrors IMAP mailboxes into self-contained "backmail repositories" — directories with a git archive, config, and worktrees all in one place. The git history is the backup. Users can browse email at any point in time, restore to a new provider, and run commands from inside the repo like they would with git.

Primary user is the developer (Jan) building it. Target evolution: developer-friendly first, then power users, then anyone with email.

## Core Value

The git repo IS the backup — point-in-time restore, local search, and provider independence without trusting any third-party service.

## Requirements

### Validated

- ✓ `backmail sync` performs incremental IMAP fetch and commits a delta to the git repo — Phase 3
- ✓ Sync mirrors deletions — emails removed from IMAP are removed from the repo (git history retains them) — Phase 3
- ✓ Storage layout: `messages/<message-id>.eml` + `folders/<name>.json` (uidvalidity + uid/message-id/flags) — Phase 3
- ✓ `backmail log` lists sync commits with date and `+added / -removed` counts — Phase 4
- ✓ `backmail checkout <date|commit>` creates a git worktree non-destructively — Phase 4
- ✓ `backmail ls [folder]` lists folders or messages — Phase 4
- ✓ `backmail view <message-id> --format [eml|plaintext|json]` renders an email — Phase 4
- ✓ `backmail restore --to <imap-url>` re-uploads messages with skip-duplicates and dry-run — Phase 5

### Active

- [ ] `backmail init` creates a backmail repository (`.backmail/config.json`, `.backmail/log`, `archive/` git repo, `worktrees/`)
- [ ] `init` prompts interactively for any parameters not supplied as CLI flags; accepts all params as flags for full automation
- [ ] `init` stores the password in the OS keyring and writes a `passwordRef` into config.json
- [x] `passwordRef` format: `"keyring:service=backmail;account=<username>"` (extensible — parser also handles `env:VAR`) *(validated Phase 6)*
- [x] `BACKMAIL_PASSWORD` env var accepted as password fallback (no keyring required) *(validated Phase 6)*
- [x] Commands auto-detect the backmail repository by walking up from CWD looking for `.backmail/` *(validated Phase 7)*
- [x] `--workdir <path>` global flag overrides auto-detection for all commands *(validated Phase 7)*
- [x] All existing commands (sync, log, ls, view, checkout, restore) work correctly with the new repository structure *(validated Phase 8)*
- [x] `--account` flag and central account registry removed from all commands *(validated Phase 8)*
- [ ] Core sync logic remains a clean TypeScript module (eimerjs IPC boundary for future Electron integration)

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
| Message-ID as filename | Enables git-level dedup, stable cross-folder references | ✓ Good |
| One git repo per mailbox (not per account) | Clean separation; easy to move, clone, or archive a single mailbox | ✓ Good |
| `git worktree` for `checkout` (not detach HEAD) | Non-destructive — sync continues to work while user browses history | ✓ Good |
| Plugins deferred to v2 | Keeps v1 scope tight; plugins depend on a stable core sync API | — Pending |
| Plain IMAP only v1 | App passwords cover Gmail; OAuth is a significant auth flow to build and maintain | — Pending |
| Central `~/.config/backmail/config.json` replaced by per-repo `.backmail/` | Central registry was non-obvious; per-repo structure is self-contained and git-like | v1.1 |
| `.backmail/` as repository marker (like `.git/`) | Git muscle memory; walk-up detection works naturally from any subdirectory | v1.1 |
| `archive/` subdirectory holds the git repo | Keeps `.backmail/` and `worktrees/` outside version control without a `.gitignore` hack | v1.1 |
| `passwordRef` format: `keyring:service=X;account=Y` | Self-documenting, parseable, extensible to `env:VAR` without breaking existing configs | v1.1 |

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
*Last updated: 2026-04-29 — Phase 8 complete (command migration: account registry removed, all commands use archive/ path derivation)*
