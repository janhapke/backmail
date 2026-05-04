# Roadmap: backmail

## Milestones

- ✅ **v1.0 — Core CLI** — Phases 1–5 (shipped 2026-04-22)
- ✅ **v1.1 — Repository-Centric UX** — Phases 6–9 (shipped 2026-05-04)
- 📋 **v1.2** — To be planned

## Phases

<details>
<summary>✅ v1.0 — Core CLI (Phases 1–5) — SHIPPED 2026-04-22</summary>

- [x] **Phase 1: Foundation** — Project scaffold, clean module architecture, Docker-backed integration test infra *(4/4 plans, completed 2006-04-20)*
- [x] **Phase 2: Configuration** — IMAP account config with OS-aware paths and secure credential storage *(3/3 plans, completed 2006-04-21)*
- [x] **Phase 3: Sync** — Incremental IMAP fetch writing `.eml` files and committing deltas to git *(3/3 plans, completed 2006-04-22)*
- [x] **Phase 4: Browse** — Read-only navigation of backup history via log, checkout, ls, and view *(3/3 plans, completed)*
- [x] **Phase 5: Restore** — Re-upload messages from a checkout to a target IMAP server *(3/3 plans, completed)*

Full details: [archived in git history — v1.0 phases]

</details>

<details>
<summary>✅ v1.1 — Repository-Centric UX (Phases 6–9) — SHIPPED 2026-05-04</summary>

- [x] **Phase 6: Credential Infrastructure** — New config types, passwordRef format parsing, and keyring/env-var credential resolution *(2/2 plans, completed 2026-04-29)*
- [x] **Phase 7: Repository Discovery** — Walk-up `.backmail/` detection and `--workdir` global flag for all commands *(2/2 plans, completed 2026-04-29)*
- [x] **Phase 8: Command Migration** — All existing commands derive paths from `archive/` and the `--account` registry is removed *(2/2 plans, completed 2026-04-29)*
- [x] **Phase 9: Init Command** — Interactive `backmail init` with prompts, keyring write, and CI/non-TTY safety *(3/3 plans, completed 2026-05-01)*

Full details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

</details>

### 📋 v1.2 — To be planned

*Run `/gsd-new-milestone` to define the next milestone.*

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 4/4 | Complete | 2006-04-20 |
| 2. Configuration | v1.0 | 3/3 | Complete | 2006-04-21 |
| 3. Sync | v1.0 | 3/3 | Complete | 2006-04-22 |
| 4. Browse | v1.0 | 3/3 | Complete | — |
| 5. Restore | v1.0 | 3/3 | Complete | — |
| 6. Credential Infrastructure | v1.1 | 2/2 | Complete | 2026-04-29 |
| 7. Repository Discovery | v1.1 | 2/2 | Complete | 2026-04-29 |
| 8. Command Migration | v1.1 | 2/2 | Complete | 2026-04-29 |
| 9. Init Command | v1.1 | 3/3 | Complete | 2026-05-01 |
