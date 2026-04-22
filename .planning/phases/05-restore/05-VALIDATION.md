---
phase: 5
slug: restore
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-22
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.4 (already installed) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm run test:integration` |
| **Estimated runtime** | ~30–60 seconds (integration with Docker) |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm run test:integration`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 0 | REST-01, REST-02, REST-03, REST-04 | — | N/A | unit stubs | `npm test` | ❌ W0 | ⬜ pending |
| 5-02-01 | 02 | 1 | REST-01 | T-5-01 | credentials not logged in errors | unit | `npm test -- restore.test.ts` | ❌ W0 | ⬜ pending |
| 5-02-02 | 02 | 1 | REST-02 | — | N/A | unit | `npm test -- restore.test.ts` | ❌ W0 | ⬜ pending |
| 5-02-03 | 02 | 1 | REST-03 | — | N/A | unit | `npm test -- restore.test.ts` | ❌ W0 | ⬜ pending |
| 5-02-04 | 02 | 1 | REST-04 | — | N/A | unit | `npm test -- restore.test.ts` | ❌ W0 | ⬜ pending |
| 5-03-01 | 03 | 2 | REST-01, REST-04 | T-5-02 | TLS enforced for imaps:// | integration | `npm run test:integration -- restore` | ❌ W0 | ⬜ pending |
| 5-03-02 | 03 | 2 | REST-02 | — | N/A | integration | `npm run test:integration -- restore` | ❌ W0 | ⬜ pending |
| 5-03-03 | 03 | 2 | REST-03 | — | N/A | integration | `npm run test:integration -- cli-restore` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/restore.test.ts` — unit test stubs for URL parsing, duplicate logic, dry-run, error cases (REST-01 through REST-04)
- [ ] `tests/integration/restore-sync.test.ts` — integration tests uploading to minimal-imap Docker server
- [ ] `tests/integration/cli-restore.test.ts` — CLI integration with --dry-run, --verbose, --skip-duplicates flags

*Framework already configured in `vitest.config.ts` from Phase 1 — no new installs needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Credentials not echoed in error output | REST-01 | Requires inspecting stderr with real IMAP credentials | Run `backmail restore --to imap://bad:pass@localhost:143` and verify URL is not printed verbatim in error output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
