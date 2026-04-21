---
phase: 2
slug: configuration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.4 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/unit/config.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/unit/config.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 0 | CONFIG-01/02/03 | — | — | setup | `npx vitest run tests/unit/config.test.ts` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | CONFIG-01 | — | N/A | unit | `npx vitest run tests/unit/config.test.ts -t "getConfigDir"` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 1 | CONFIG-01 | — | Error with path | unit | `npx vitest run tests/unit/config.test.ts -t "missing config"` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 1 | CONFIG-02 | — | N/A | unit | `npx vitest run tests/unit/config.test.ts -t "valid config"` | ❌ W0 | ⬜ pending |
| 2-03-02 | 03 | 1 | CONFIG-02 | — | Throws on bad schema | unit | `npx vitest run tests/unit/config.test.ts -t "invalid schema"` | ❌ W0 | ⬜ pending |
| 2-03-03 | 03 | 1 | CONFIG-02 | — | N/A | unit | `npx vitest run tests/unit/config.test.ts -t "repoPath"` | ❌ W0 | ⬜ pending |
| 2-04-01 | 04 | 1 | CONFIG-03 | T-2-01 | Keyring over plaintext | unit (mock) | `npx vitest run tests/unit/config.test.ts -t "getPassword keyring"` | ❌ W0 | ⬜ pending |
| 2-04-02 | 04 | 1 | CONFIG-03 | — | N/A | unit | `npx vitest run tests/unit/config.test.ts -t "getPassword env var"` | ❌ W0 | ⬜ pending |
| 2-04-03 | 04 | 1 | CONFIG-03 | — | Throws, no silent fail | unit | `npx vitest run tests/unit/config.test.ts -t "getPassword throws"` | ❌ W0 | ⬜ pending |
| 2-04-04 | 04 | 1 | CONFIG-03 | — | Handles headless Linux | unit | `npx vitest run tests/unit/config.test.ts -t "getPassword keyring error"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/config.test.ts` — stubs for CONFIG-01, CONFIG-02, CONFIG-03 (all rows above)
- [ ] `npm install @napi-rs/keyring zod` — packages not yet in package.json

*Existing test infrastructure (vitest.config.ts, fixtures) covers CLI/core boundary; config test file is net-new.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Keyring integration on real macOS/Windows | CONFIG-03 | Can't mock real OS keychain in CI | Set keyring entry, run `backmail sync`, confirm no password prompt |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
