---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Repository-Centric UX
status: planning
stopped_at: ~
last_updated: "2026-04-28T00:00:00.000Z"
last_activity: 2026-04-28 -- Milestone v1.1 started
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-28)

**Core value:** The git repo IS the backup — point-in-time restore, local search, and provider independence without trusting any third-party service.
**Current focus:** Milestone v1.1 — Repository-Centric UX (defining requirements)

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-28 -- Milestone v1.1 started

Progress: [░░░░░░░░░░] 0%

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
- passwordRef format: `keyring:service=backmail;account=<username>`

### Pending Todos

None.

### Blockers/Concerns

Carried from v1.0:

- **CR-01**: Unsafe BigInt() conversion from corrupted JSON state (03-REVIEW.md) — still deferred

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Bug | CR-01: Unsafe BigInt() from corrupted folder JSON state | Deferred | Phase 3 (v1.0) |
