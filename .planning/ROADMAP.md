# Roadmap: backmail

## Overview

backmail is a TypeScript CLI that backs up IMAP mailboxes to git repos. The path runs foundation-first: establish the clean architecture and test infrastructure that everything else depends on, then layer in configuration, sync, browse, restore, and finally package for distribution. Each phase completes a coherent capability that can be verified end-to-end before the next begins.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Project scaffold, clean module architecture, and integration test infrastructure *(completed 2026-04-20)*
- [x] **Phase 2: Configuration** - IMAP account config with OS-aware paths and secure credential storage *(completed 2026-04-21)*
- [x] **Phase 3: Sync** - Incremental IMAP fetch writing `.eml` files and committing deltas to git *(completed 2026-04-22)*
- [ ] **Phase 4: Browse** - Read-only navigation of backup history via log, checkout, ls, and view commands
- [ ] **Phase 5: Restore** - Re-upload messages from a checkout to a target IMAP server
- [ ] **Phase 6: Packaging** - Cross-platform distribution via npm, npx, and compiled binaries

## Phase Details

### Phase 1: Foundation
**Goal**: The project structure exists, the core/CLI split is enforced, and the Docker-backed test environment runs end-to-end
**Depends on**: Nothing (first phase)
**Requirements**: ARCH-01, ARCH-02, TEST-01, TEST-02, TEST-03
**Success Criteria** (what must be TRUE):
  1. `npm run test:integration` starts a Docker Dovecot container, runs tests against it, and tears it down automatically
  2. Core sync/browse/restore logic lives in a module with a public TypeScript API — no CLI imports in core
  3. The CLI layer imports core and wraps it — core functions are callable without the CLI
  4. Synthetic `.eml` fixtures are committed to the repo and loaded in test setup with no real email present
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md — Project config (package.json, tsconfig.json, vitest configs, npm install)
- [x] 01-02-PLAN.md — Source modules and fixtures (src/core/index.ts, src/cli/index.ts, tests/fixtures/*.eml)
- [x] 01-03-PLAN.md — Unit tests (ARCH-01/02 boundary tests, TEST-03 fixture validation, npm test green)
- [x] 01-04-PLAN.md — Integration infra (docker-compose.yml, test-integration.sh, imap-connect test, npm run test:integration green)

### Phase 2: Configuration
**Goal**: Users can configure named IMAP accounts with secure credentials and the CLI resolves config from the correct OS path
**Depends on**: Phase 1
**Requirements**: CONFIG-01, CONFIG-02, CONFIG-03
**Success Criteria** (what must be TRUE):
  1. Config file is read from `~/.config/backmail/` on Linux, `~/Library/Application Support/backmail/` on macOS, and `%APPDATA%\backmail\` on Windows
  2. A config file with multiple named accounts (host, port, username, TLS, git repo path) is parsed correctly
  3. Credentials are retrieved from the OS keyring when available; fallback to `BACKMAIL_PASSWORD` / `BACKMAIL_<ACCOUNT>_PASSWORD` env vars works for headless use
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Dependencies + test scaffold (npm install @napi-rs/keyring zod, failing config.test.ts stubs)
- [x] 02-02-PLAN.md — Core config module (src/core/config.ts: OS paths, Zod validation, loadConfig, getPassword; re-exports via src/core/index.ts)
- [x] 02-03-PLAN.md — CLI wiring + boundary tests (loadConfig in src/cli/index.ts, extended ARCH-01 tests for config.ts)

### Phase 3: Sync
**Goal**: Users can run `backmail sync` to incrementally fetch new mail, mirror deletions, and commit a labelled delta to the git repo
**Depends on**: Phase 2
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06
**Success Criteria** (what must be TRUE):
  1. `backmail sync` fetches new messages as `.eml` files under `messages/` and updates `folders/<name>.json` with uid/message-id/flags arrays
  2. Messages deleted from the IMAP server are removed from the working tree on next sync; git history still shows them
  3. Each sync produces a git commit with message `YYYY-MM-DD: +N added / -N removed`
  4. A `uidvalidity` change causes a full folder re-sync and is recorded visibly in git history
  5. `backmail sync --all` runs sync for every configured account
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — Dependencies + failing test stubs (npm install imapflow simple-git, tests/unit/sync.test.ts + tests/integration/sync.test.ts)
- [x] 03-02-PLAN.md — Core sync module (src/core/sync.ts: syncAccount + helpers; re-exports via src/core/index.ts)
- [x] 03-03-PLAN.md — CLI sync subcommand + --all (src/cli/index.ts) and boundary test extensions

### Phase 4: Browse
**Goal**: Users can navigate the backup history — listing commits, creating point-in-time worktrees, and reading individual messages
**Depends on**: Phase 3
**Requirements**: BROW-01, BROW-02, BROW-03, BROW-04
**Success Criteria** (what must be TRUE):
  1. `backmail log` lists sync commits with date and delta summary without modifying any git state
  2. `backmail checkout <date|commit>` creates a `git worktree` at that point and the main working tree is unchanged
  3. `backmail ls` lists folders; `backmail ls <folder>` lists messages inside that folder
  4. `backmail view <message-id> --format eml` returns raw RFC822; `--format plaintext` extracts the text/plain MIME part; `--format json` returns parsed headers and body parts
**UI hint**: yes
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — Dependencies + CR-01 fix (npm install mailparser, fix BigInt in sync.ts, browse.ts skeleton + test stubs)
- [x] 04-02-PLAN.md — Core browse module (src/core/browse.ts: getLog, checkoutCommit, listFolders, listMessages, viewMessage; unit + integration tests)
- [x] 04-03-PLAN.md — CLI browse subcommands (src/cli/index.ts: accounts, log, checkout, ls, view; CLI integration tests)

### Phase 5: Restore
**Goal**: Users can re-upload messages from a backup checkout to any target IMAP server with duplicate-checking and dry-run support
**Depends on**: Phase 4
**Requirements**: REST-01, REST-02, REST-03, REST-04
**Success Criteria** (what must be TRUE):
  1. `backmail restore --to <imap-url>` uploads all messages from the current checkout to the target server in their original folders
  2. With `--skip-duplicates=yes` (the default), each message's Message-ID is checked against the target before APPEND and existing messages are skipped
  3. `--dry-run` prints what would be uploaded without connecting to the target for writes
  4. Original folder structure is reproduced on the target after a full restore
**Plans**: 3 plans

Plans:
- [ ] 05-01-PLAN.md — Dependencies + failing test stubs (npm install imapflow simple-git, tests/unit/sync.test.ts + tests/integration/sync.test.ts)
- [ ] 05-02-PLAN.md — Core restore module (src/core/restore.ts: restoreAccount + helpers; re-exports via src/core/index.ts)
- [ ] 05-03-PLAN.md — CLI restore subcommand (src/cli/index.ts) and boundary test extensions

### Phase 6: Packaging
**Goal**: backmail is installable from npm globally and via npx, and self-contained binaries are published for macOS, Windows, and Linux
**Depends on**: Phase 5
**Requirements**: PKG-01, PKG-02, PKG-03
**Success Criteria** (what must be TRUE):
  1. `npm install -g backmail` installs the CLI and `backmail sync` runs correctly on a clean system
  2. `npx backmail` runs without a global install
  3. Compiled self-contained binaries work on macOS (x64 + arm64), Windows (x64), and Linux (x64) without Node.js installed
  4. Config path resolution, credential storage, and file path separators behave correctly on all three platforms
**Plans**: 3 plans

Plans:
- [ ] 06-01-PLAN.md — Dependencies + failing test stubs (npm install imapflow simple-git, tests/unit/sync.test.ts + tests/integration/sync.test.ts)
- [ ] 06-02-PLAN.md — Core packaging module (src/core/restore.ts: restoreAccount + helpers; re-exports via src/core/index.ts)
- [ ] 06-03-PLAN.md — CLI restore subcommand (src/cli/index.ts) and boundary test extensions

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 4/4 | Complete | 2026-04-20 |
| 2. Configuration | 3/3 | Complete | 2026-04-21 |
| 3. Sync | 3/3 | Complete | 2026-04-22 |
| 4. Browse | 0/3 | Planned | - |
| 5. Restore | 0/3 | Not started | - |
| 6. Packaging | 0/3 | Not started | - |
