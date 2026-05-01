---
phase: 6
slug: credential-infrastructure
status: complete
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-01
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- tests/unit/config.test.ts tests/unit/core-api-boundary.test.ts` |
| **Full suite command** | `npm test -- tests/unit/` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/unit/config.test.ts`
- **After every plan wave:** Run `npm test -- tests/unit/`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 6-01-T1 | 01 | 1 | CRED-01 | T-06-01 | Zod validates all fields; ZodError propagates before any credential lookup | unit | `npm test -- tests/unit/config.test.ts` | ✅ | ✅ green |
| 6-01-T1 | 01 | 1 | CRED-02 | T-06-04 | parsePasswordRef strict — bad scheme/malformed throws immediately | unit | `npm test -- tests/unit/config.test.ts` | ✅ | ✅ green |
| 6-01-T1 | 01 | 1 | CRED-03 | T-06-06 | Unknown scheme throws before any lookup; BACKMAIL_PASSWORD fallback; clear error when nothing resolves | unit | `npm test -- tests/unit/config.test.ts` | ✅ | ✅ green |
| 6-01-T2 | 01 | 1 | CRED-01/02/03 | — | API boundary: new exports present, old API symbols absent | unit | `npm test -- tests/unit/core-api-boundary.test.ts` | ✅ | ✅ green |
| 6-02-T1 | 02 | 2 | CRED-01/02/03 | T-06-07/08 | 20-test suite: loadRepositoryConfig (5), parsePasswordRef (9), getPasswordByRef (6) | unit | `npm test -- tests/unit/config.test.ts` | ✅ | ✅ green |
| 6-02-T2 | 02 | 2 | CRED-01/02/03 | — | Phase 6 API surface assertions: loadRepositoryConfig, parsePasswordRef, getPasswordByRef exported | unit | `npm test -- tests/unit/core-api-boundary.test.ts` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Coverage Detail

### CRED-01: loadRepositoryConfig

| Behavior | Test | Status |
|----------|------|--------|
| Returns RepositoryConfig when config.json is valid | `config.test.ts:35` | ✅ |
| Throws with path in message when .backmail/config.json does not exist | `config.test.ts:48` | ✅ |
| Throws when config.json is not valid JSON | `config.test.ts:52` | ✅ |
| Throws ZodError when required field is missing | `config.test.ts:57` | ✅ |
| Throws ZodError when passwordRef is empty string | `config.test.ts:65` | ✅ |

### CRED-02: parsePasswordRef

| Behavior | Test | Status |
|----------|------|--------|
| Parses keyring ref with service and account | `config.test.ts:85` | ✅ |
| Parses keyring ref where account contains special characters | `config.test.ts:90` | ✅ |
| Parses env ref | `config.test.ts:95` | ✅ |
| Parses env ref with custom var name | `config.test.ts:100` | ✅ |
| Throws on missing account= in keyring ref | `config.test.ts:105` | ✅ |
| Throws on missing service= in keyring ref | `config.test.ts:111` | ✅ |
| Throws on empty var name in env ref | `config.test.ts:117` | ✅ |
| Throws on unsupported scheme | `config.test.ts:121` | ✅ |
| Throws on ref with no colon scheme | `config.test.ts:125` | ✅ |

### CRED-03: getPasswordByRef

| Behavior | Test | Status |
|----------|------|--------|
| Resolves password from keyring | `config.test.ts:141` | ✅ |
| Falls back to BACKMAIL_PASSWORD when keyring returns null | `config.test.ts:163` | ✅ |
| Falls back to BACKMAIL_PASSWORD when keyring throws | `config.test.ts:187` | ✅ |
| Resolves password from env var named in ref | `config.test.ts:207` | ✅ |
| Falls back to BACKMAIL_PASSWORD when named env var is unset | `config.test.ts:212` | ✅ |
| Throws with BACKMAIL_PASSWORD mentioned when nothing resolves | `config.test.ts:232` | ✅ |

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Notes

Integration tests (`tests/integration/sync.test.ts`, `browse.test.ts`, `restore-sync.test.ts`) fail with `parsePasswordRef` receiving `undefined` — these tests pass old-style config objects without `passwordRef`. This is a Phase 8 regression (CLI adapter not yet updated to use `loadRepositoryConfig`), not a Phase 6 gap.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — infra was pre-existing)
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-01
