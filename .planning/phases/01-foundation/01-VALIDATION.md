---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.4 |
| **Config file (unit)** | `vitest.config.ts` — Wave 0 installs |
| **Config file (integration)** | `vitest.integration.config.ts` — Wave 0 installs |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run && bash scripts/test-integration.sh` |
| **Estimated runtime** | ~120 seconds (includes Docker startup) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run && bash scripts/test-integration.sh`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | ARCH-01 | — | No CLI imports in core | unit | `npx vitest run tests/unit/core-api-boundary.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | ARCH-02 | — | No core imports from CLI | unit | `npx vitest run tests/unit/cli-boundary.test.ts` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | TEST-01 | — | N/A | integration | `bash scripts/test-integration.sh` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 1 | TEST-02 | — | N/A | smoke | `npm run test:integration` | ❌ W0 | ⬜ pending |
| 1-01-05 | 01 | 1 | TEST-03 | — | Fixtures are synthetic (no real email) | unit | `npx vitest run tests/unit/fixtures.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — unit test runner config (testTimeout: 10_000)
- [ ] `vitest.integration.config.ts` — integration test config (testTimeout: 120_000)
- [ ] `tests/unit/core-api-boundary.test.ts` — ARCH-01 boundary check
- [ ] `tests/unit/cli-boundary.test.ts` — ARCH-02 boundary check
- [ ] `tests/unit/fixtures.test.ts` — TEST-03 fixture validation
- [ ] `tests/integration/imap-connect.test.ts` — TEST-01 smoke connect
- [ ] `scripts/test-integration.sh` — TEST-02 Docker orchestration
- [ ] `docker-compose.yml` — IMAP service definition
- [ ] `npm install --save-dev vitest` — framework install

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker container starts and IMAP port 143 is reachable | TEST-01 | Requires Docker daemon running in test environment | Run `docker compose up -d && nc -zv localhost 143` and confirm connection |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
