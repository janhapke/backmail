---
phase: 9
slug: init-command
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-30
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.4 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/unit/init.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

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
| 9-01-01 | 01 | 1 | REPO-01 | — | N/A | unit | `npx vitest run tests/unit/init.test.ts` | ❌ W0 | ⬜ pending |
| 9-01-02 | 01 | 1 | REPO-01 | — | N/A | unit | `npx vitest run tests/unit/init.test.ts` | ❌ W0 | ⬜ pending |
| 9-01-03 | 01 | 1 | REPO-03 | — | N/A | unit | `npx vitest run tests/unit/init.test.ts` | ❌ W0 | ⬜ pending |
| 9-01-04 | 01 | 1 | REPO-04 | — | N/A | unit | `npx vitest run tests/unit/init.test.ts` | ❌ W0 | ⬜ pending |
| 9-02-01 | 02 | 1 | REPO-02 | — | N/A | unit | `npx vitest run tests/unit/init.test.ts` | ❌ W0 | ⬜ pending |
| 9-02-02 | 02 | 1 | REPO-05 | — | N/A | unit | `npx vitest run tests/unit/init.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/init.test.ts` — stubs covering REPO-01, REPO-02, REPO-03, REPO-04, REPO-05
- [ ] `tests/unit/cli-boundary.test.ts` extension — add ARCH-01 check for `src/core/init.ts`
- [ ] `npm install @inquirer/prompts` — install new dependency before any implementation tasks

*Wave 0 must complete before any implementation task can claim "tests pass".*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Keyring write on real OS keyring | REPO-03 | @napi-rs/keyring mocked in unit tests | Run `node -e "const {Entry}=require('@napi-rs/keyring'); new Entry('backmail','test').setPassword('pw'); console.log('ok')"` |
| Interactive prompt display in TTY | REPO-02 | @inquirer/prompts cannot be driven programmatically in unit tests | Run `backmail init /tmp/test-repo` in a real terminal and verify all prompts appear |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
