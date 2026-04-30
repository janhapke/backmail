# Phase 9: Init Command - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-30
**Phase:** 09-init-command
**Areas discussed:** Prompt library, Keyring write failures, Path argument design, Core module boundary

---

## Prompt Library

| Option | Description | Selected |
|--------|-------------|----------|
| @inquirer/prompts | Modern ESM-native successor to inquirer; typed, well-maintained, large ecosystem | ✓ |
| enquirer | Lighter, less actively maintained (last release 2021) | |
| readline (built-in) | Zero deps but verbose; no built-in validation or select prompts | |

**User's choice:** `@inquirer/prompts`
**Notes:** Prompt design (input/confirm/password types with defaults) delegated to Claude.

---

## Keyring Write Failures

| Option | Description | Selected |
|--------|-------------|----------|
| Fail with clear error | Keyring unavailable → error, mention `--password-ref env:BACKMAIL_PASSWORD` | ✓ |
| Auto-fall-back to env: passwordRef | Silently write `env:BACKMAIL_PASSWORD` ref if keyring fails | |

**User's choice:** Fail with clear error

**Follow-up: What flags to support?**

| Option | Description | Selected |
|--------|-------------|----------|
| --password-ref only | Accepts full ref string, supports `env:VAR` syntax | |
| --password (plaintext) | Writes to keyring; fails if keyring unavailable | ✓ |

**User's clarification:** Support BOTH `--password <plaintext>` (writes to keyring) AND `--password-ref <ref>` (writes ref directly, enabling `env:BACKMAIL_PASSWORD` for CI). Help text must explain `env:` syntax. Confirmed BACKMAIL_PASSWORD runtime fallback stays as-is (already in `getPasswordByRef()`).

---

## Path Argument Design

| Option | Description | Selected |
|--------|-------------|----------|
| Positional arg on init | `backmail init [path]`, git-style, independent of --workdir | ✓ |
| Reuse --workdir global flag | `backmail --workdir /path init`, consistent but semantically awkward | |

**User's choice:** Positional arg on init

**Follow-up: Full flag coverage?**

| Option | Description | Selected |
|--------|-------------|----------|
| Full flag coverage | --host, --port, --username, --tls/--no-tls, --password, --password-ref | ✓ |
| Minimal flags | Only --host, --username, --password | |

**User's choice:** Full flag coverage (required by REPO-05 CI mode)

---

## Core Module Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| src/core/init.ts | Core function, ARCH-01 compliant, eimerjs-ready | ✓ |
| CLI action handler only | Simpler now, not testable as unit | |

**User's choice:** `src/core/init.ts`

**Follow-up: Who owns keyring write?**

| Option | Description | Selected |
|--------|-------------|----------|
| CLI writes keyring, passes passwordRef to core | Core stays pure; keyring is I/O at CLI boundary | ✓ |
| Core handles keyring write | Core takes full ownership including @napi-rs/keyring | |

**User's choice:** CLI writes keyring, passes passwordRef string to `initRepository()`

---

## Claude's Discretion

- Exact prompt wording and per-field validation
- `simple-git` vs raw `git init` for archive initialisation
- Whether `initRepository()` uses async or sync fs
- Unit test structure and fixture approach

## Deferred Ideas

None.
