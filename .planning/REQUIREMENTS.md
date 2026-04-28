# Requirements: backmail

**Defined:** 2026-04-20
**Updated for v1.1:** 2026-04-29
**Core Value:** The git repo IS the backup — point-in-time restore, local search, and provider independence without trusting any third-party service.

## Validated (v1.0 — shipped)

- ✓ **ARCH-01**: Core sync/restore/browse logic is a clean TypeScript module with a public API — no CLI-specific code in core
- ✓ **ARCH-02**: CLI is a thin wrapper over core — all functionality callable programmatically
- ✓ **CONFIG-01–03**: Accounts configurable with IMAP settings; credentials in OS keyring with env var fallback *(replaced by REPO/CRED model in v1.1)*
- ✓ **SYNC-01–06**: Incremental sync, delta commits, deletion mirroring, uidvalidity, --all flag
- ✓ **BROW-01–04**: log, checkout (worktree), ls, view (eml/plaintext/json)
- ✓ **REST-01–04**: restore --to, skip-duplicates, dry-run, folder structure preservation

## v1.1 Requirements

### Repository Initialization

- [ ] **REPO-01**: User can run `backmail init [path]` to create a backmail repository at a given path (defaults to current directory); creates `.backmail/config.json`, `.backmail/log`, `archive/` (git repo), and `worktrees/`
- [ ] **REPO-02**: `init` prompts interactively for any parameters not supplied as CLI flags: repo path, IMAP host, port, username, TLS, and password
- [ ] **REPO-03**: `init` stores the password in the OS keyring and writes `passwordRef` to `.backmail/config.json`
- [ ] **REPO-04**: `init` is non-destructive — refuses to overwrite an existing repo without `--force`
- [ ] **REPO-05**: `init` detects non-TTY context (CI/piped stdin) and requires all parameters as CLI flags in that case

### Repository Discovery

- [ ] **DISC-01**: All commands auto-detect the backmail repository by walking up from CWD looking for `.backmail/`
- [ ] **DISC-02**: `--workdir <path>` global flag overrides auto-detection for all commands
- [ ] **DISC-03**: Commands print a clear error when not inside a backmail repo and no `--workdir` is given

### Credentials

- [ ] **CRED-01**: Config `passwordRef` field supports format `keyring:service=backmail;account=<username>`
- [ ] **CRED-02**: `BACKMAIL_PASSWORD` env var accepted as password fallback when keyring is unavailable
- [ ] **CRED-03**: Keyring unavailability (headless/CI) is handled gracefully — falls back to env var without crashing

### Existing Commands

- [ ] **CMD-01**: All existing commands (sync, log, ls, view, checkout, restore) work correctly with the new repository structure and path derivation (`archive/` is the git repo)
- [ ] **CMD-02**: `--account` flag and global account registry removed from all commands; no central config file

## Future Requirements

### Packaging

- **PKG-01**: Installable via `npm install -g backmail` and runnable via `npx backmail`
- **PKG-02**: Compiled self-contained binaries for macOS (x64 + arm64), Windows (x64), and Linux (x64)
- **PKG-03**: Works correctly on macOS, Windows, and Linux (config paths, credential storage, path separators)

### Plugins

- **PLUG-01**: `markdown-export` plugin — parse `.eml` to `<message-id>.md` with YAML frontmatter + plain-text body
- **PLUG-02**: `mcp-server` plugin — MCP server on top of markdown cache for AI agent access to email
- **PLUG-03**: `dovecot-server` plugin — Dovecot IMAP access to backup

### Auth

- **AUTH-01**: OAuth 2.0 support for Gmail and other providers

### UI & Integration

- **UI-01**: Electron desktop app via eimerjs IPC
- **UI-02**: Scheduled sync daemon / tray app

## Out of Scope

| Feature | Reason |
|---------|--------|
| OAuth / Gmail OAuth | App passwords cover Gmail; OAuth adds significant complexity — defer to v2 |
| Plugins (markdown-export, mcp-server, dovecot-server) | Depend on stable core API; v1 establishes that |
| Electron UI | eimerjs IPC wired when it arrives; CLI-only for now |
| SaaS / multi-tenant | No v1 constraint; revisit if demand exists |
| Git LFS for attachments | Full `.eml` in git for v1; profile before optimizing |
| HTML rendering in terminal | `--format plaintext` covers the common case |
| POP3 support | IMAP is the standard; POP3 is legacy |
| Packaging / binary distribution | Deferred until UX is stable |

## Traceability

*Filled in by roadmapper.*

| Requirement | Phase | Status |
|-------------|-------|--------|
| REPO-01 | TBD | Pending |
| REPO-02 | TBD | Pending |
| REPO-03 | TBD | Pending |
| REPO-04 | TBD | Pending |
| REPO-05 | TBD | Pending |
| DISC-01 | TBD | Pending |
| DISC-02 | TBD | Pending |
| DISC-03 | TBD | Pending |
| CRED-01 | TBD | Pending |
| CRED-02 | TBD | Pending |
| CRED-03 | TBD | Pending |
| CMD-01 | TBD | Pending |
| CMD-02 | TBD | Pending |

**Coverage:**
- v1.1 requirements: 13 total
- Mapped to phases: 0 (roadmapper will fill)
- Unmapped: 13 ⚠️

---
*Requirements defined: 2026-04-20*
*Last updated: 2026-04-29 — v1.1 milestone (repository-centric UX)*
