# Milestones: backmail

## v1.0 — Core CLI

**Shipped:** 2026-04-22 (approx)
**Phases:** 1–5
**Plans:** 16

### Delivered

Established the complete CLI tool: project scaffold with ARCH-01/02 boundary enforcement, IMAP account config with OS keyring, incremental sync with delta commits, browse history (log/checkout/ls/view), and restore to target IMAP server.

### Key Accomplishments

- Docker-backed integration test infrastructure (Dovecot container)
- Core/CLI split enforced from day one — eimerjs IPC boundary wired
- Incremental IMAP sync with deletion mirroring and uidvalidity handling
- Point-in-time worktree checkout (non-destructive git worktree pattern)
- Full restore pipeline with skip-duplicates and dry-run

---

## v1.1 — Repository-Centric UX

**Shipped:** 2026-05-04
**Phases:** 6–9
**Plans:** 9
**Timeline:** 2026-04-29 → 2026-05-04 (6 days)
**Commits:** 77

### Delivered

Replaced the central config model with self-contained backmail repositories. Every backmail repo is now self-contained with `.backmail/config.json`, `archive/` (git repo), and `worktrees/` — no central registry required. All commands auto-discover the repo by walking up from CWD, just like git.

### Key Accomplishments

1. **Credential Infrastructure** — New `RepositoryConfig` schema, `passwordRef` format (`keyring:service=X;account=Y` / `env:VAR`), graceful CI fallback via `BACKMAIL_PASSWORD`
2. **Repository Discovery** — `findRepository()` walk-up detection wired into all 6 commands; `--workdir` global override
3. **Command Migration** — Legacy account registry (`resolveAccount`, `--account`, `accounts` subcommand) fully removed; all commands derive `archive/` path from repo root
4. **Init Command** — `backmail init [path]` with interactive TTY prompts, OS keyring write, non-destructive guard, full CI/non-TTY flag mode
5. **Credential Round-Trip** — `init` writes `keyring:service=backmail;account=<user>` → `sync` resolves via `getPasswordByRef` — end-to-end verified
6. **13/13 requirements satisfied** — full cross-phase integration check passed

### Tech Debt at Close

- CR-01: Unsafe BigInt() from corrupted folder JSON (deferred from v1.0, still deferred)
- `restoreAccount()` dead `config` parameter — redundant config load on every restore
- Phases 6–8 have no VALIDATION.md (predate Nyquist workflow)

### Archive

- [v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md) — full phase details
- [v1.1-REQUIREMENTS.md](milestones/v1.1-REQUIREMENTS.md) — all 13 requirements with outcomes
- [v1.1-MILESTONE-AUDIT.md](milestones/v1.1-MILESTONE-AUDIT.md) — integration check results

---

*Updated: 2026-05-04*
