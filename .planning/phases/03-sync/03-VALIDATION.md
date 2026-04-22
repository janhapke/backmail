---
phase: 3
slug: sync
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.4 |
| **Unit config** | `vitest.config.ts` (covers `tests/unit/**`) |
| **Integration config** | `vitest.integration.config.ts` (covers `tests/integration/**`) |
| **Quick run command** | `npx vitest run --config vitest.config.ts` |
| **Full suite command** | `npm run test:integration` |
| **Estimated runtime** | ~30s (unit) / ~120s (integration with Docker) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --config vitest.config.ts`
- **After every plan wave:** Run `npm run test:integration`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds (unit), 120 seconds (integration)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | SYNC-01 | — | N/A | unit | `npx vitest run --config vitest.config.ts tests/unit/sync.test.ts` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | SYNC-02 | — | N/A | unit | `npx vitest run --config vitest.config.ts tests/unit/sync.test.ts` | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | SYNC-04 | T-3-01 | Folder path sanitized before filesystem write | unit | `npx vitest run --config vitest.config.ts tests/unit/sync.test.ts` | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 1 | SYNC-01 | T-3-01 | Message-ID sanitized before filesystem write | integration | `npm run test:integration` | ❌ W0 | ⬜ pending |
| 3-02-02 | 02 | 1 | SYNC-03 | — | N/A | integration | `npm run test:integration` | ❌ W0 | ⬜ pending |
| 3-02-03 | 02 | 1 | SYNC-05 | — | N/A | integration | `npm run test:integration` | ❌ W0 | ⬜ pending |
| 3-03-01 | 03 | 2 | SYNC-06 | — | N/A | unit | `npx vitest run --config vitest.config.ts tests/unit/sync.test.ts` | ❌ W0 | ⬜ pending |
| 3-03-02 | 03 | 2 | ARCH-01 | — | N/A | unit | `npx vitest run --config vitest.config.ts tests/unit/core-api-boundary.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/sync.test.ts` — stubs for SYNC-01 (UID calc), SYNC-02 (commit message format), SYNC-04 (folder JSON schema), D-02/D-03 (folder filtering + leaf match), D-04 (auto git init), D-08/D-09 (partial commit)
- [ ] `tests/integration/sync.test.ts` — stubs for SYNC-01 (end-to-end fetch), SYNC-03 (deletion mirroring), SYNC-05 (uidvalidity re-sync)
- [ ] Install dependencies: `npm install imapflow simple-git`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| --verbose output format | D-06 | Log line format is UX-subjective | Run `backmail sync --verbose` against test account; verify one line per folder and per message on stdout |
| git identity error message | Open Q #2 | Requires fresh git init with no global config | Remove user.name/email from git config; run sync; verify helpful error message on stderr |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (unit) / 120s (integration)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
