---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: — Core CLI
status: milestone_complete
last_updated: "2026-04-29T16:14:00.000Z"
last_activity: 2026-04-29 -- Phase 7 (Repository Discovery) completed
progress:
  total_phases: 2
  completed_phases: 3
  total_plans: 4
  completed_plans: 4
  percent: 150
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-28)

**Core value:** The git repo IS the backup — point-in-time restore, local search, and provider independence without trusting any third-party service.
**Current focus:** Phase --phase — 7

## Current Position

Phase: 7
Plan: Not started
Status: Milestone complete
Last activity: 2026-04-29

Progress: [██████████] 100%

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Carried over from v1.0:

- All phases: Core/CLI split enforced from day one (ARCH-01/02) — eimerjs IPC boundary wired in Phase 1
- All phases: Plain IMAP only (no OAuth) — app passwords cover Gmail for v1
- Sync: Message-ID as filename for git-level dedup and stable cross-folder references
- Sync: ImapFlow logger:false mandatory — prevents auth logging to stdout/stderr
- Sync: BigInt.toString() for uidvalidity in JSON — preserves precision across sync cycles
- Checkout: Always `git worktree`, never detach HEAD on main working tree

New in v1.1:

- Repository structure: `.backmail/` marker + `archive/` git repo + `worktrees/` (all siblings)
- passwordRef format: `keyring:service=backmail;account=<username>` (extensible — parser also handles `env:VAR`)
- Build order: credential infrastructure → discovery → command migration → init command

### Pending Todos

None.

### Blockers/Concerns

Carried from v1.0:

- **CR-01**: Unsafe BigInt() conversion from corrupted JSON state (03-REVIEW.md) — still deferred

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Bug | CR-01: Unsafe BigInt() from corrupted folder JSON state | Deferred | Phase 3 (v1.0) |

**Planned Phase:** 7 (Repository Discovery) — 2 plans — 2026-04-29T15:51:43.572Z
