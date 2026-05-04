# Retrospective: backmail

Living retrospective — updated at each milestone boundary.

---

## Milestone: v1.1 — Repository-Centric UX

**Shipped:** 2026-05-04
**Phases:** 4 (6–9) | **Plans:** 9 | **Commits:** 77
**Timeline:** 2026-04-29 → 2026-05-04 (6 days)

### What Was Built

- **Phase 6:** New `RepositoryConfig` schema + `passwordRef` parser (`keyring:` / `env:` schemes) with graceful CI fallback via `BACKMAIL_PASSWORD`
- **Phase 7:** `findRepository()` walk-up discovery wired into all 6 commands + `--workdir` global override
- **Phase 8:** Full account registry removal — `resolveAccount`, `--account` flags, `accounts` subcommand, central config file all deleted
- **Phase 9:** `backmail init [path]` — interactive prompts (TTY), full flag mode (CI/non-TTY), keyring write, non-destructive guard

### What Worked

- **Build order was correct.** Credential infrastructure → discovery → command migration → init followed the research recommendation. Each phase had clean inputs from the previous one with no rework.
- **Strict ARCH-01 discipline.** No process.exit, no console.\*, no CLI imports in core — consistently enforced across all 4 phases. Made the credential round-trip (init writes → sync reads) trivial to verify.
- **Phase-level verification.** Phases 6, 7, 8 all had VERIFICATION.md with scored must-haves. Integration issues were caught early (dead `config` param in restoreAccount identified at audit, not in production).
- **isTTY === true fix (D-10).** Catching `undefined` as non-TTY rather than `!== false` was a subtle but critical correctness fix that the discussion phase surfaced before execution.

### What Was Inefficient

- **REQUIREMENTS.md checkboxes not updated during execution.** All 13 requirements were satisfied by VERIFICATION.md but the traceability table still showed "Pending" until milestone close. Cost: extra audit pass flagging them as a gap.
- **Phase 9 VERIFICATION.md gap.** UAT was done and phase was functionally complete, but formal /gsd-verify-work wasn't run during execute-phase. This caused the milestone audit to flag Phase 9 as unverified and required a remediation pass.
- **STATE.md milestone label.** STATE.md retained `milestone: v1.0` label even after v1.1 work started. Small confusion during audit.
- **SDK milestone.complete failure.** `gsd-sdk query milestone.complete` returned an error requiring manual archival. Archival was straightforward but unexpected.

### Patterns Established

- **passwordRef format is the credential contract.** `keyring:service=backmail;account=<username>` is the canonical format — init writes it, getPasswordByRef reads it. Symmetric by design.
- **`archive/` is always derived, never configured.** No phase ever stored the archive path in config — it's always `path.join(repoRoot, 'archive')`. Convention > configuration.
- **Dual-layer guards for destructive operations.** REPO-04 guard exists in both CLI (before prompts) and core `initRepository()`. Belt-and-suspenders for non-destructive behavior.
- **`process.stdin.isTTY === true` not `!== false`.** Undefined stdin (piped) must be treated as non-TTY. This is the correct check for CI safety.

### Key Lessons

1. **Run /gsd-verify-work during execute-phase, not after.** The UAT + VERIFICATION.md pair should be produced as part of execution, not as a remediation step at milestone close.
2. **Update REQUIREMENTS.md traceability as requirements are satisfied.** Don't defer checkbox updates to milestone close — they become apparent audit gaps.
3. **Manual-only tests need documented justification.** Phase 9's VALIDATION.md correctly documented TTY prompts and OS keyring as manual-only with rationale. This prevented them from being flagged as gaps during audit.
4. **Integration check catches dead parameters.** The `restoreAccount(config, ...)` dead parameter was only found by the integration checker scanning function signatures. Worth running early.

### Cost Observations

- Sessions: ~6-8 (estimated)
- Notable: Phase 8 was the fastest (2 plans, ~1 day) because the ARCH-01 discipline made legacy removal mechanical. Phase 9 was the most complex (3 plans, interactive CLI + keyring).

---

## Cross-Milestone Trends

| Metric | v1.0 | v1.1 |
|--------|------|------|
| Phases | 5 | 4 |
| Plans | 16 | 9 |
| Timeline | ~3 days | 6 days |
| Commits | ~60 (est) | 77 |
| Requirements | ~17 (ARCH+CONFIG+SYNC+BROW+REST) | 13 |
| Verification gaps at close | 0 | 1 (Phase 9 VERIFICATION.md) |

**Trend:** v1.1 had higher per-plan complexity (credential infrastructure, interactive CLI) and cleaner requirement tracking setup but more remediation at close. v1.2 should enforce verify-work during execution.
