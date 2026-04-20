---
plan: 01-04
phase: 01-foundation
status: complete
wave: 2
completed: "2026-04-20"
self_check: PASSED
---

# Plan 01-04: Docker IMAP Integration Test Infrastructure

## What Was Built

Full Docker-backed integration test infra for real IMAP connectivity testing:

- `docker-compose.yml` — defines `imap` service using `gmitirol/minimal-imap:v1` (Alpine + Dovecot) on port 143:143, with `IMAP_USERS: "testuser:testpass"` credentials.
- `scripts/test-integration.sh` — orchestration script: `docker compose up -d` → readiness probe (`nc -z localhost 143` with `timeout 60`) → `npx vitest run --config vitest.integration.config.ts` → `docker compose down --remove-orphans` via `trap cleanup EXIT`. Uses `docker compose` v2 (no hyphen). `set -euo pipefail` for fail-fast behavior.
- `tests/integration/imap-connect.test.ts` — TEST-01 smoke test: (1) TCP connect to port 143 succeeds, (2) Dovecot IMAP greeting matches `* OK` (RFC 3501). Uses raw `node:net`, `IMAP_HOST`/`IMAP_PORT` env var overrides for CI port remapping.

**Result:** `npm run test:integration` → Docker starts, waits for readiness, runs 2 tests (both pass), container torn down cleanly. Exit 0.

## Commits

- `f485ec5` feat(01-04): add docker-compose.yml (minimal-imap:v1) and test-integration.sh orchestration script
- `0ec590a` test(01-04): add IMAP connectivity integration test — TEST-01 TCP connect + Dovecot banner check

## Deviations

None. All must-haves met. Image pulled on first run (expected).

## Key Files

### key-files.created
- docker-compose.yml
- scripts/test-integration.sh
- tests/integration/imap-connect.test.ts

## Self-Check

- [x] `docker-compose.yml` contains `gmitirol/minimal-imap:v1`, port `143:143`, `IMAP_USERS`
- [x] `scripts/test-integration.sh` is executable, has `trap cleanup EXIT`, uses `docker compose` v2, `timeout 60`
- [x] `tests/integration/imap-connect.test.ts` uses `node:net`, checks `* OK` banner
- [x] `npm run test:integration` exits 0 — both integration tests pass, Docker tears down
- [x] STATE.md and ROADMAP.md not modified
