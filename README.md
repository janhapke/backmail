# backmail

Backup Mail to git. Browse, search, and restore email at any point in history without trusting a third-party service.

Each backmail repository tracks one IMAP account. Messages are stored as `.eml` files named by Message-ID, so identical messages (e.g. Gmail labels) are deduplicated at the git level. Every sync run produces a commit with a `+added / -removed` summary. Deletions are mirrored — if you remove a message from your mailbox, the next sync removes it from the repo (git history still has it).

Built AI-first with [GSD](https://github.com/gsd-build/get-shit-done/) and [Claude Code](https://claude.com/product/claude-code).

---

## Getting Started

### Prerequisites

- Node.js 20+
- Git

### Install

```sh
git clone https://github.com/janhapke/backmail
cd backmail
npm install
```

### Create a repository

Each backmail repository tracks one IMAP account. Run `init` inside the directory you want to use (it will be created if it doesn't exist):

```sh
backmail init ~/mail/personal
```

On a TTY backmail prompts for connection details. To script the setup pass flags directly:

```sh
backmail init ~/mail/personal \
  --host imap.example.com \
  --port 993 \
  --username you@example.com \
  --tls \
  --password-ref env:BACKMAIL_PASSWORD
```

| Option | Description |
|--------|-------------|
| `--host <host>` | IMAP server hostname |
| `--port <port>` | IMAP port (default: `993`) |
| `--username <user>` | IMAP login |
| `--tls` / `--no-tls` | Enable or disable TLS (default: TLS on) |
| `--password <pass>` | Password written to the OS keyring |
| `--password-ref <ref>` | Password reference written directly to config (see below) |

After `init`, the directory contains:

```
.backmail/
  config.json     # IMAP connection settings
archive/          # git repository — one .eml per message
worktrees/        # point-in-time checkouts land here
```

### Passwords

Passwords are **not** stored in plain text. backmail stores a `passwordRef` that points to the actual credential at runtime.

**OS keyring** (recommended — set by `--password` during `init`):

The password is saved under the service `backmail` with the account key set to your username. The config will contain:

```
keyring:service=backmail;account=you@example.com
```

**Environment variable** (CI / headless servers — use `--password-ref`):

```sh
export BACKMAIL_PASSWORD="your-app-password"
backmail init ~/mail/personal --password-ref env:BACKMAIL_PASSWORD ...
```

The `env:` form reads the named variable at sync time. `BACKMAIL_PASSWORD` is also checked as a universal fallback if no other credential resolves.

For Gmail, use an [app password](https://support.google.com/accounts/answer/185833) rather than your main account password.

---

## Running commands

Run commands from **inside** a backmail repository (backmail walks up the directory tree to find the `.backmail/` marker, just like git finds `.git/`). Use `--workdir` to point at a different repository from outside it.

```sh
cd ~/mail/personal
backmail sync

# or from anywhere:
backmail --workdir ~/mail/personal sync
```

During development, prefix with `npm run dev --`:

```sh
npm run dev -- sync
```

After building, run the compiled binary directly:

```sh
node dist/cli/index.js sync
```

### Global option

| Option | Description |
|--------|-------------|
| `--workdir <path>` | Path to a backmail repository (default: auto-detect from CWD) |

---

## Commands

---

### `init`

Create a new backmail repository.

```sh
backmail init [path]
backmail init ~/mail/personal --host imap.example.com --port 993 --username you@example.com --tls --password-ref env:BACKMAIL_PASSWORD
```

`path` defaults to the current directory. Fails if a `.backmail/` directory already exists there.

| Option | Description |
|--------|-------------|
| `--host <host>` | IMAP server hostname |
| `--port <port>` | IMAP port (default: `993`) |
| `--username <user>` | IMAP login |
| `--tls` / `--no-tls` | Use TLS (default: on) |
| `--password <pass>` | Plaintext password — stored in the OS keyring |
| `--password-ref <ref>` | Password reference string written to config (e.g. `env:BACKMAIL_PASSWORD`) |

On a real TTY, any omitted option is prompted interactively. In non-TTY mode (CI, pipes) all options are required.

---

### `sync`

Sync the IMAP mailbox to git.

```sh
backmail sync
backmail sync --only-folder INBOX --only-folder Sent
backmail sync --exclude-folder Spam --verbose
```

| Option | Description |
|--------|-------------|
| `--exclude-folder <name>` | Skip a folder (repeatable) |
| `--only-folder <name>` | Restrict to a folder (repeatable) |
| `--verbose` | Log one line per folder and per message |

`--exclude-folder` and `--only-folder` are mutually exclusive.

Output:

```
sync: +42 added / -3 removed
```

If any folder fails the sync continues and the summary line is tagged `[partial]`:

```
sync [partial]: +10 added / -0 removed
folder INBOX/Archive failed: connection reset
```

Exit code is non-zero when any folder fails.

---

### `log`

Show git commit history for the repository.

```sh
backmail log
backmail log --limit 50
backmail log --limit unlimited
```

| Option | Description |
|--------|-------------|
| `--limit <n>` | Number of commits to show, or `unlimited` (default: `20`) |

---

### `ls`

List folders, or list messages within a folder.

```sh
backmail ls
backmail ls INBOX
```

When a folder name is given, each message is printed as:

```
<message-id>  <date>  <from>  <subject>
```

---

### `view`

View a message by its Message-ID.

```sh
backmail view "<unique-id@host>"
backmail view "<unique-id@host>" --format eml
backmail view "<unique-id@host>" --format json
```

| Option | Description |
|--------|-------------|
| `--format <fmt>` | `plaintext` (default), `eml`, or `json` |

---

### `checkout`

Create a git worktree at a point in history. Non-destructive — sync keeps working on the main archive while you browse the snapshot.

```sh
backmail checkout 2024-01-15
backmail checkout abc1234
```

The argument can be a date (`YYYY-MM-DD`) or a commit hash. The worktree is placed under `worktrees/` (a sibling of `archive/`, outside the git repository):

```
Checked out 2024-01-15 (abc1234f) → /home/you/mail/personal/worktrees/2024-01-15
```

If a worktree for that reference already exists it is replaced.

---

### `restore`

Re-upload messages from a backup to an IMAP server. Useful for migrating to a new provider or recovering deleted mail.

```sh
backmail restore --to imaps://you:password@imap.newhost.com
backmail restore 2024-01-15 --to imaps://you:password@imap.newhost.com
backmail restore --to imaps://you:password@imap.newhost.com --dry-run
```

The optional `date|commit` argument restores from a point-in-time snapshot (same reference as `checkout`). Omit it to restore from the current state.

| Option | Description |
|--------|-------------|
| `--to <imap-url>` | Target IMAP URL — `imap://` or `imaps://` with credentials |
| `--skip-duplicates <yes\|no>` | Check Message-ID before uploading (default: `yes`) |
| `--dry-run` | Show what would be uploaded without writing anything |
| `--verbose` | Log one line per message |

Output:

```
Total: 1204 uploaded, 38 skipped
```

If any uploads fail the exit code is non-zero and a retry hint is printed. Re-run with `--skip-duplicates=yes` to safely retry — already-uploaded messages are skipped.

---

## Repository Layout

```
.backmail/
  config.json       # IMAP connection settings + passwordRef
archive/            # git repository
  messages/
    <message-id>.eml     # one file per message
  folders/
    <folder-name>.json   # uidvalidity + uid/message-id/flags per folder
worktrees/          # point-in-time checkouts (outside the git repo)
  2024-01-15/
  abc1234/
```

Messages are content-addressed by Message-ID, so identical emails that appear in multiple IMAP folders (common with Gmail labels) are stored only once.

---

## Development

### Run without building

```sh
npm run dev -- sync
```

`tsx` executes TypeScript directly — no build step needed during development.

### Build

```sh
npm run build        # compiles to dist/
```

### Tests

```sh
npm test                      # unit tests (vitest)
npm run test:watch            # watch mode
npm run test:coverage         # unit tests with coverage report (outputs to coverage/)
npm run test:integration      # integration tests against a local Dovecot container
```

---

### Integration Tests

#### Prerequisites

- **Docker** — the test runner starts and stops containers automatically. No manual IMAP setup needed.

#### How to run

```sh
npm run test:integration
```

This script ([scripts/test-integration.sh](scripts/test-integration.sh)):

1. Runs `docker compose up -d` to start three containers:
   - `imap-source` — Dovecot IMAP server acting as the source mailbox
   - `imap-target` — Dovecot IMAP server acting as the restore target
   - `mail-seeder` — seeds fixture messages into the source on startup
2. Waits for the IMAP port (143) to accept connections
3. Runs Vitest with `vitest.integration.config.ts` (120 s per-test timeout)
4. Tears down all containers on exit, even if tests fail

You can override the connection defaults with environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `IMAP_HOST` | `localhost` | IMAP server hostname |
| `IMAP_PORT` | `143` | IMAP port |
| `IMAP_USER` | `testuser` | IMAP login |
| `IMAP_PASS` | `testpass` | IMAP password |

#### What the tests cover

| File | IDs | What it tests |
|------|-----|---------------|
| `imap-connect.test.ts` | — | Raw IMAP connectivity to both source and target containers |
| `sync.test.ts` | SYNC-01, SYNC-03, SYNC-05 | Full sync cycle: fetching messages, writing `.eml` files, folder JSON state, deletion mirroring, uidvalidity change |
| `restore-sync.test.ts` | REST-01 – REST-04 | Uploading a local archive to a target IMAP server, duplicate skipping, dry-run mode, folder creation |
| `browse.test.ts` | — | Listing folders, listing messages, viewing message content from a local git archive |
| `cli-browse.test.ts` | — | End-to-end CLI (`backmail ls`, `backmail view`, `backmail log`, `backmail checkout`) via `spawnSync` |
| `cli-restore.test.ts` | — | End-to-end CLI (`backmail restore`) argument validation, URL parsing, dry-run output format |

Each `beforeAll` seeds the IMAP server or creates a temporary git repo in `os.tmpdir()`. Each `afterAll` deletes the temp directory and resets any env vars set during the test.

### Type checking

```sh
npm run typecheck
```

### Architecture

The codebase is split into two layers:

- **`src/core/`** — pure business logic; no `process.exit`, no `console.*`. Designed as a clean module boundary for future Electron/IPC integration.
- **`src/cli/`** — thin Commander wrapper; calls core functions and handles output + exit codes.

Keep all logic in core. The CLI is just a translation layer.
