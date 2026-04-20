# Requirements: backmail

**Defined:** 2026-04-20
**Core Value:** The git repo IS the backup — point-in-time restore, local search, and provider independence without trusting any third-party service.

## v1 Requirements

### Configuration

- [ ] **CONFIG-01**: User can configure named IMAP accounts in the OS-appropriate config dir (`~/.config/backmail/` on Linux, `~/Library/Application Support/backmail/` on macOS, `%APPDATA%\backmail\` on Windows)
- [ ] **CONFIG-02**: Config supports multiple named accounts, each with IMAP host, port, username, TLS settings, and git repo path
- [ ] **CONFIG-03**: Credentials stored in OS keyring (via keytar) when available; falls back to `BACKMAIL_PASSWORD` / `BACKMAIL_<ACCOUNT>_PASSWORD` environment variables for headless/server use
### Sync

- [ ] **SYNC-01**: `backmail sync [<account>]` performs incremental IMAP fetch, writes new `.eml` files, updates folder JSONs, and commits a delta to the git repo
- [ ] **SYNC-02**: Sync commit message includes date and delta summary: `YYYY-MM-DD: +N added / -N removed`
- [ ] **SYNC-03**: Sync mirrors IMAP deletions — emails removed from IMAP are removed from the working tree (git history still preserves them)
- [ ] **SYNC-04**: Folder state stored in `folders/<name>.json` with `uidvalidity` and array of `{uid, message-id, flags}`
- [ ] **SYNC-05**: Sync detects `uidvalidity` change, triggers full folder re-sync, and records the event visibly in git history
- [ ] **SYNC-06**: `backmail sync --all` syncs all configured accounts

### Browse

- [ ] **BROW-01**: `backmail log [<account>]` lists sync commits with date and delta summary
- [ ] **BROW-02**: `backmail checkout <date|commit> [<account>]` creates a `git worktree` at that point without modifying the main working tree
- [ ] **BROW-03**: `backmail ls [<folder>]` lists folders at current checkout, or messages inside a folder
- [ ] **BROW-04**: `backmail view <message-id> --format [eml|plaintext|json]` renders an email — `eml` returns raw RFC822, `plaintext` extracts text/plain MIME part, `json` returns parsed headers + body parts

### Restore

- [ ] **REST-01**: `backmail restore --to <imap-url> [<account>]` re-uploads all messages from current checkout to a target IMAP server
- [ ] **REST-02**: `--skip-duplicates=yes` (default) checks Message-ID against the target before each APPEND; `--skip-duplicates=no` uploads without checking
- [ ] **REST-03**: `--dry-run` prints what would be uploaded without making any changes to the target
- [ ] **REST-04**: Restore preserves the original folder structure on the target server

### Packaging & Platform

- [ ] **PKG-01**: Installable via `npm install -g backmail` and runnable via `npx backmail`
- [ ] **PKG-02**: Compiled self-contained binaries for macOS (x64 + arm64), Windows (x64), and Linux (x64)
- [ ] **PKG-03**: Works correctly on macOS, Windows, and Linux (config paths, credential storage, path separators)

### Architecture

- [ ] **ARCH-01**: Core sync/restore/browse logic is a clean TypeScript module with a public API — no CLI-specific code in core
- [ ] **ARCH-02**: CLI is a thin wrapper over core — all functionality callable programmatically (eimerjs IPC boundary for future Electron integration)

### Testing

- [ ] **TEST-01**: Integration tests use the [minimal-imap](https://github.com/gmitirol/minimal-imap) Docker container as a real IMAP server
- [ ] **TEST-02**: `npm run test:integration` starts the Docker container, runs tests, and tears it down automatically
- [ ] **TEST-03**: Test fixtures are synthetic `.eml` files committed to the repo — no real email, reproducible, no privacy risk

## v2 Requirements

### Plugins

- **PLUG-01**: `markdown-export` plugin — parse `.eml` to `<message-id>.md` with YAML frontmatter + plain-text body, written to a cache dir outside git
- **PLUG-02**: `mcp-server` plugin — MCP server on top of markdown cache for AI agent access to email (depends on markdown-export)
- **PLUG-03**: `dovecot-server` plugin — generate `dovecot.conf` and manage Dovecot process, enabling standard email clients to connect to the backup via IMAP

### Auth

- **AUTH-01**: OAuth 2.0 support for Gmail and other providers that require it

### UI & Integration

- **UI-01**: Electron desktop app via eimerjs IPC (core remains unchanged)
- **UI-02**: Scheduled sync daemon / tray app for set-and-forget operation

## Out of Scope

| Feature | Reason |
|---------|--------|
| OAuth / Gmail OAuth | App passwords cover Gmail; OAuth adds significant auth flow complexity — defer to v2 |
| Plugins (markdown-export, mcp-server, dovecot-server) | Depend on stable core sync API; v1 establishes that API |
| Electron UI | Coming, but eimerjs IPC is wired when it arrives; CLI-only for v1 |
| SaaS / multi-tenant hosting | No v1 architecture constraint; revisit if/when demand exists |
| Git LFS for attachments | Full `.eml` in git for v1; profile real usage before optimizing |
| HTML rendering in terminal | `--format plaintext` covers the common case; raw `eml` for the rest |
| POP3 support | IMAP is the standard; POP3 is legacy and not worth the complexity |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONFIG-01 | — | Pending |
| CONFIG-02 | — | Pending |
| CONFIG-03 | — | Pending |
| SYNC-01 | — | Pending |
| SYNC-02 | — | Pending |
| SYNC-03 | — | Pending |
| SYNC-04 | — | Pending |
| SYNC-05 | — | Pending |
| SYNC-06 | — | Pending |
| BROW-01 | — | Pending |
| BROW-02 | — | Pending |
| BROW-03 | — | Pending |
| BROW-04 | — | Pending |
| REST-01 | — | Pending |
| REST-02 | — | Pending |
| REST-03 | — | Pending |
| REST-04 | — | Pending |
| PKG-01 | — | Pending |
| PKG-02 | — | Pending |
| PKG-03 | — | Pending |
| ARCH-01 | — | Pending |
| ARCH-02 | — | Pending |
| TEST-01 | — | Pending |
| TEST-02 | — | Pending |
| TEST-03 | — | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 25 ⚠️

---
*Requirements defined: 2026-04-20*
*Last updated: 2026-04-20 after initial definition*
