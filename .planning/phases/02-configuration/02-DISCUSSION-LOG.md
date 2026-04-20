# Phase 2: Configuration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 02-configuration
**Areas discussed:** Config CLI commands, Config schema, Credential key naming, Missing/invalid config UX

---

## Config CLI commands

| Option | Description | Selected |
|--------|-------------|----------|
| File-based only | No CLI commands; users edit JSON manually | ✓ |
| Interactive add command | `backmail config add <name>` prompts for IMAP details | |
| Full CRUD commands | `backmail config add/show/remove/set-password` | |

**User's choice:** File-based only
**Notes:** Keeps Phase 2 scope tight. Config management via CLI is out of scope.

---

## Config schema — account structure

| Option | Description | Selected |
|--------|-------------|----------|
| Object with named keys | `{"accounts": {"gmail": {...}}}` | ✓ |
| Array with name field | `{"accounts": [{"name": "gmail", ...}]}` | |

**User's choice:** Object with named keys
**Notes:** Natural key-based lookup, no duplicate names.

---

## Config schema — repoPath resolution

| Option | Description | Selected |
|--------|-------------|----------|
| Tilde-expanded only | Accept `~/mail/gmail`, expand at load | |
| Absolute paths only | Require fully qualified paths | |
| Relative to config dir | `./gmail` resolves relative to config file location | |
| Accept all forms | Tilde, absolute, and relative — resolve at load time | ✓ |

**User's choice:** Accept all forms (tilde-expanded, absolute, or relative to config dir)
**Notes:** User explicitly said "accept all" — resolve to absolute path at load time regardless of form.

---

## Credential key naming

| Option | Description | Selected |
|--------|-------------|----------|
| service=backmail, account=<name> | keytar.setPassword('backmail', 'gmail', secret) | ✓ |
| service=backmail/<host>, account=<username> | Mirrors IMAP identity in keychain | |

**User's choice:** service=`backmail`, account=`<account-name>`
**Notes:** One keyring entry per named account, clean and predictable.

---

## Env var fallback behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Always BACKMAIL_<ACCOUNT>_PASSWORD | Consistent, no special case | ✓ |
| Single account also accepts BACKMAIL_PASSWORD | Shorthand for single-account setups | |

**User's choice:** Always `BACKMAIL_<ACCOUNT>_PASSWORD`
**Notes:** No special-case logic. Simpler to document and implement.

---

## Missing config UX

| Option | Description | Selected |
|--------|-------------|----------|
| Clear error with instructions | Print path + instructions, exit non-zero | ✓ |
| Create template config file | Auto-create annotated config.json | |
| Interactive first-run wizard | Prompt for account details on first run | |

**User's choice:** Clear error with instructions
**Notes:** No magic file creation. User creates config manually.

---

## Missing credentials UX

| Option | Description | Selected |
|--------|-------------|----------|
| Error at command time (lazy) | Throw when command needs the password | ✓ |
| Error at config load time (strict) | Validate credentials for all accounts on parse | |

**User's choice:** Error at command time — lazy validation
**Notes:** Commands like `backmail log` that don't need credentials should work even if password is missing.

---

## Claude's Discretion

- JSON schema validation library choice (or manual validation)
- Exact field validation rules (port range, TLS boolean coercion)
- Internal module structure within `src/core/config.ts`
- Whether to export a `getConfig()` singleton or `loadConfig(path)` function

## Deferred Ideas

None.
