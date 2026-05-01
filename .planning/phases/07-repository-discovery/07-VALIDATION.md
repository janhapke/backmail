---
phase: 7
slug: repository-discovery
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-01
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.4 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/unit/discovery.test.ts tests/unit/cli-discovery.test.ts` |
| **Full suite command** | `npx vitest run tests/unit/` |
| **Estimated runtime** | ~7 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/unit/discovery.test.ts tests/unit/cli-discovery.test.ts`
- **After every plan wave:** Run `npx vitest run tests/unit/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~7 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-T1 | 01 | 1 | DISC-01/02/03 | T-07-01, T-07-02 | findRepository stops at root without throwing | unit | `npx vitest run tests/unit/discovery.test.ts` | ✅ | ✅ green |
| 07-01-T2 | 01 | 1 | DISC-01 | — | N/A | unit | `npx vitest run tests/unit/discovery.test.ts` | ✅ | ✅ green |
| 07-01-T3 | 01 | 1 | DISC-01/02/03 | — | N/A | unit | `npx vitest run tests/unit/discovery.test.ts` | ✅ | ✅ green |
| 07-02-T1 | 02 | 2 | DISC-02 | T-07-04 | path.resolve() normalizes --workdir before use | unit/smoke | `npx vitest run tests/unit/cli-discovery.test.ts` | ✅ | ✅ green |
| 07-02-T1 | 02 | 2 | DISC-03 | T-07-05 | Error message contains no CWD path, exits 1 | unit/smoke | `npx vitest run tests/unit/cli-discovery.test.ts` | ✅ | ✅ green |
| 07-02-T1 | 02 | 2 | DISC-01 | — | CLI auto-detects from CWD walk-up | unit/smoke | `npx vitest run tests/unit/cli-discovery.test.ts` | ✅ | ✅ green |
| 07-02-T2 | 02 | 2 | DISC-01 | — | N/A | unit/smoke | `npx vitest run tests/unit/cli-discovery.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Audit 2026-05-01

| Metric | Count |
|--------|-------|
| Gaps found | 3 |
| Resolved | 3 |
| Escalated | 0 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-01
