---
phase: 9
slug: init-command
status: audited
nyquist_compliant: false
wave_0_complete: true
created: 2026-04-30
audited: 2026-05-01
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.4 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/unit/init.test.ts tests/unit/cli-boundary.test.ts tests/unit/init-cli.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~7 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/unit/init.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 9-01-01 | 01 | 1 | REPO-01 | — | N/A | unit | `npx vitest run tests/unit/init.test.ts` | ✅ | ✅ green |
| 9-01-02 | 01 | 1 | REPO-01 | — | N/A | unit | `npx vitest run tests/unit/init.test.ts` | ✅ | ✅ green |
| 9-01-03 | 01 | 1 | REPO-03 | — | N/A | manual | see Manual-Only table | manual | ⬜ manual |
| 9-01-04 | 01 | 1 | REPO-04 | — | N/A | unit | `npx vitest run tests/unit/init.test.ts` | ✅ | ✅ green |
| 9-02-01 | 03 | 3 | REPO-02 | — | N/A | manual | see Manual-Only table | manual | ⬜ manual |
| 9-02-02 | 03 | 3 | REPO-05 | — | N/A | unit | `npx vitest run tests/unit/init-cli.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/unit/init.test.ts` — stubs covering REPO-01, REPO-04 (5 tests, all green)
- [x] `tests/unit/cli-boundary.test.ts` extension — ARCH-01 check for `src/core/init.ts` (3 tests, all green)
- [x] `npm install @inquirer/prompts` — installed as production dependency

*Wave 0 complete — all implementation tasks ran against green tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Keyring write on real OS keyring | REPO-03 | @napi-rs/keyring mocked in unit tests | Run `node -e "const {Entry}=require('@napi-rs/keyring'); new Entry('backmail','test').setPassword('pw'); console.log('ok')"` |
| Interactive prompt display in TTY | REPO-02 | @inquirer/prompts cannot be driven programmatically in unit tests | Run `backmail init /tmp/test-repo` in a real terminal and verify all prompts appear |

---

## Validation Sign-Off

- [x] All tasks have automated verify or manual-only justification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 complete (all pre-execution requirements met)
- [x] No watch-mode flags
- [x] Feedback latency < 10s (unit tests ~2s, init-cli tests ~2s)
- [ ] `nyquist_compliant: true` — blocked by 2 manual-only items (REPO-02, REPO-03)

**Approval:** partial — 4 automated, 2 manual-only (keyring + TTY prompts cannot be automated)

---

## Validation Audit 2026-05-01

| Metric | Count |
|--------|-------|
| Gaps found | 1 |
| Resolved | 1 |
| Escalated (manual-only) | 0 |

**Gap resolved:** REPO-05 (9-02-02) — added `tests/unit/init-cli.test.ts` (3 tests) using child process spawning with piped stdin to verify non-TTY error behavior. All 3 tests pass green.

**Pre-existing manual-only (not gaps):** REPO-03 (keyring) and REPO-02 (TTY prompts) were already documented as manual-only before audit — these are architectural limitations, not coverage gaps.
