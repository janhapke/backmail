# backmail

Mirror IMAP mailboxes to git. The repo is the backup — browse, search, and restore email at any point in history without trusting a third-party service.

Each account gets its own git repository. Messages are stored as `.eml` files named by Message-ID, so identical messages (e.g. Gmail labels) are deduplicated at the git level. Every sync run produces a commit with a `+added / -removed` summary. Deletions are mirrored — if you remove a message from your mailbox, the next sync removes it from the repo (git history still has it).

---

## Getting Started

### Prerequisites

- Node.js 18+
- Git

### Install

```sh
git clone https://github.com/janhapke/backmail
cd backmail
npm install
```

### Configure

Create `~/.config/backmail/config.json` (macOS: `~/Library/Application Support/backmail/config.json`):

```json
{
  "accounts": {
    "personal": {
      "host": "imap.example.com",
      "port": 993,
      "username": "you@example.com",
      "tls": true,
      "repoPath": "~/mail/personal"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `host` | IMAP hostname |
| `port` | IMAP port (typically `993` for TLS, `143` for plain) |
| `username` | IMAP login |
| `tls` | `true` to use TLS/SSL |
| `repoPath` | Where to store the git backup repo (created automatically) |

You can add as many accounts as you like under `accounts`. Account names must be alphanumeric (`a-z`, `0-9`, `-`, `_`).

### Store your password

Passwords are **not** stored in the config file. backmail reads them from the system keyring or an environment variable.

**System keyring** (recommended):

```sh
# macOS Keychain / GNOME Keyring / KWallet
secret-tool store --label="backmail personal" service backmail username personal
```

**Environment variable** (CI / headless servers):

```sh
export BACKMAIL_PERSONAL_PASSWORD="your-app-password"
```

The env var pattern is `BACKMAIL_<ACCOUNT_UPPERCASED>_PASSWORD`.

For Gmail, use an [app password](https://support.google.com/accounts/answer/185833) rather than your main account password.

---

## Commands

Run commands via `npm run dev -- <command>` during development, or `node dist/cli/index.js <command>` after building.

---

### `sync`

Sync one or all IMAP accounts to git.

```sh
backmail sync <account>
backmail sync --all
```

| Option | Description |
|--------|-------------|
| `--all` | Sync all configured accounts |
| `--exclude-folder <name>` | Skip a folder (repeatable) |
| `--only-folder <name>` | Restrict to a folder (repeatable) |
| `--verbose` | Log one line per folder and per message |

`--exclude-folder` and `--only-folder` are mutually exclusive.

Output:

```
personal: +42 added / -3 removed
```

If any folder fails the sync continues and the summary line is tagged `[partial]`.

---

### `accounts`

List all configured account names.

```sh
backmail accounts
```

---

### `log`

Show git commit history for an account.

```sh
backmail log
backmail log --account personal --limit 50
backmail log --account personal --limit unlimited
```

| Option | Description |
|--------|-------------|
| `--account <name>` | Account name (optional when only one account is configured) |
| `--limit <n>` | Number of commits to show, or `unlimited` (default: `20`) |

---

### `ls`

List folders, or list messages within a folder.

```sh
backmail ls
backmail ls INBOX
backmail ls --account personal INBOX
```

When a folder name is given, each message is printed as:

```
<message-id>  <date>  <from>  <subject>
```

| Option | Description |
|--------|-------------|
| `--account <name>` | Account name (optional when only one account is configured) |

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
| `--account <name>` | Account name (optional when only one account is configured) |
| `--format <fmt>` | `plaintext` (default), `eml`, or `json` |

---

### `checkout`

Create a git worktree at a point in history. Non-destructive — sync keeps working on the main tree while you browse.

```sh
backmail checkout 2024-01-15
backmail checkout abc1234
backmail checkout --account personal 2024-01-15
```

The argument can be a date (`YYYY-MM-DD`) or a commit hash. Output:

```
Checked out 2024-01-15 (abc1234f) → /home/you/mail/personal-2024-01-15
```

| Option | Description |
|--------|-------------|
| `--account <name>` | Account name (optional when only one account is configured) |

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
| `--account <name>` | Account name (optional when only one account is configured) |
| `--skip-duplicates <yes\|no>` | Check Message-ID before uploading (default: `yes`) |
| `--dry-run` | Show what would be uploaded without writing anything |
| `--verbose` | Log one line per message |

Output:

```
Total: 1204 uploaded, 38 skipped
```

If any uploads fail the exit code is non-zero and a retry hint is printed.

---

## Repository Layout

Each account's git repo has this structure:

```
messages/
  <message-id>.eml     # one file per message
folders/
  <folder-name>.json   # uidvalidity + uid/message-id/flags array per folder
```

Messages are content-addressed by Message-ID, so identical emails that appear in multiple folders (common with Gmail labels) are stored only once.

---

## Development

### Setup

```sh
npm install
```

### Run without building

```sh
npm run dev -- sync personal
```

`tsx` executes TypeScript directly — no build step needed during development.

### Build

```sh
npm run build        # compiles to dist/
```

### Tests

```sh
npm test             # unit tests (vitest)
npm run test:watch   # watch mode
npm run test:integration  # integration tests against a local Dovecot container
```

Integration tests require Docker. The test runner starts a [minimal-imap](https://github.com/gmitirol/minimal-imap) Dovecot container automatically.

### Type checking

```sh
npm run typecheck
```

### Architecture

The codebase is split into two layers:

- **`src/core/`** — pure business logic; no `process.exit`, no `console.*`. Designed as a clean module boundary for future Electron/IPC integration.
- **`src/cli/`** — thin Commander wrapper; calls core functions and handles output + exit codes.

Keep all logic in core. The CLI is just a translation layer.
