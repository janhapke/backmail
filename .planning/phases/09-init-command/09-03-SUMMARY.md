---
phase: 09-init-command
plan: "03"
subsystem: cli
tags: [init, cli, prompts, keyring, tty]
dependency_graph:
  requires: [09-02]
  provides: [init-command-cli]
  affects: [src/cli/index.ts]
tech_stack:
  added: []
  patterns: [ARCH-02, commander-command, inquirer-prompts, napi-rs-keyring]
key_files:
  modified:
    - src/cli/index.ts
decisions:
  - "isTTY check corrected to process.stdin.isTTY === true — undefined (piped stdin) must be treated as non-TTY, not interactive. D-10 revised: undefined means no real TTY attached."
  - "--tls/--no-tls pair: opts.tls !== undefined detects 'neither passed' — requires explicit choice in non-TTY, avoiding Commander default ambiguity (Pitfall 4)"
  - "promptPassword alias avoids shadowing opts.password in action handler"
---

# Plan 03 Summary: init Command CLI Integration

## What Was Built

Added the `backmail init [path]` command to `src/cli/index.ts`. The command collects IMAP configuration and credentials either interactively (TTY) or from flags (non-TTY/CI), writes credentials to the OS keyring, and delegates to `initRepository()`.

## Files Changed

- `src/cli/index.ts` — added 3 imports + init command block (~110 lines)

## Key Implementation Points

- **Imports added**: `@inquirer/prompts` (input, confirm, password as promptPassword), `@napi-rs/keyring` (Entry), `initRepository` from `../core/index.js`
- **7 options**: `--host`, `--port`, `--username`, `--tls`, `--no-tls`, `--password`, `--password-ref`
- **TTY/non-TTY branching** for all 5 parameters — isTTY = `process.stdin.isTTY === true` (undefined treated as non-TTY)
- **REPO-04 guard**: upfront `fs.existsSync(.backmail)` check BEFORE any prompts — exits immediately
- **Credential paths**: `--password-ref` writes ref directly; `--password` (or TTY prompt) writes to keyring and derives `keyring:service=backmail;account=<username>` ref
- **Keyring failure**: D-05 error with `--password-ref env:BACKMAIL_PASSWORD` hint

## Test Results

- 174 passing / 11 failing — identical to pre-change baseline
- All 11 failures are pre-existing IMAP integration tests requiring a running Docker container (ECONNREFUSED 127.0.0.1:143) — not affected by this plan

## Requirements Satisfied

- REPO-02: `backmail init [path]` command exists and is registered
- REPO-03: Interactive prompts in TTY mode for all parameters
- REPO-05: Non-TTY mode errors on any missing required parameter without calling prompts
