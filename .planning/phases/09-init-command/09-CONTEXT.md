# Phase 9: Init Command - Context

**Gathered:** 2026-04-30
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement `backmail init [path]` — an interactive command that creates a fully functional backmail repository: `.backmail/config.json`, `.backmail/log`, `archive/` (initialised git repo), and `worktrees/`. Supports interactive prompts (TTY), full flag-only mode (CI/non-TTY), keyring credential storage, and is non-destructive (refuses to overwrite existing repo).

Requirements in scope: REPO-01, REPO-02, REPO-03, REPO-04, REPO-05.

</domain>

<decisions>
## Implementation Decisions

### Prompt library
- **D-01:** Use `@inquirer/prompts` as the interactive prompt library. ESM-native, well-maintained, typed. Install as a production dependency.
- **D-02:** Prompt types: `input` for host/port/username, `confirm` for TLS (default: true), `password` (masked) for password. Port default: 993, TLS default: true.
- **D-03:** Claude's discretion on exact prompt wording and validation logic (e.g., port must be 1–65535 integer).

### Keyring write and credential flags
- **D-04:** `init` supports two credential flags (both optional — prompts if missing in TTY):
  - `--password <plaintext>` — init writes the password to the OS keyring, then stores `keyring:service=backmail;account=<username>` as `passwordRef` in config.json.
  - `--password-ref <ref>` — init writes the ref string directly to config.json without any keyring interaction. Enables CI usage with `--password-ref env:BACKMAIL_PASSWORD`. Help text must explain `env:VAR` syntax.
- **D-05:** If keyring write fails (unavailable D-Bus / no keyring daemon), init prints a clear error and exits non-zero. No silent fallback. The error message must mention `--password-ref env:BACKMAIL_PASSWORD` as the CI workaround.
- **D-06:** `BACKMAIL_PASSWORD` env var as a runtime fallback is unchanged (already in `getPasswordByRef()` from Phase 6) — this is not an init concern.

### Path argument design
- **D-07:** `backmail init [path]` — `[path]` is a positional argument on the `init` command itself, defaulting to CWD. Follows `git init [path]` UX. Does NOT interact with the global `--workdir` flag (which targets existing repos, not new ones).
- **D-08:** Full flag coverage for every parameter, required by REPO-05 CI mode:
  - `--host <host>`, `--port <port>`, `--username <username>`, `--tls` / `--no-tls`
  - `--password <plaintext>`, `--password-ref <ref>`
  - All flags optional; init prompts for any missing in a TTY, exits with error if missing in non-TTY (REPO-05).

### Core module boundary
- **D-09:** `initRepository(targetDir: string, config: RepositoryConfig, passwordRef: string): Promise<void>` lives in `src/core/init.ts`. It handles:
  - Directory creation (`.backmail/`, `.backmail/log`, `archive/`, `worktrees/`)
  - Writing `.backmail/config.json` (using `RepositoryConfig` + `passwordRef`)
  - Initialising git repo at `archive/`
  - Non-destructive check: throws if `.backmail/` already exists (REPO-04)
- **D-10:** The CLI action handler owns all interactive I/O and keyring write:
  - Prompts for missing params using `@inquirer/prompts`
  - Detects non-TTY (`process.stdin.isTTY === false`) and errors if any required param is missing
  - Calls `new Entry(service, account).setPassword(password)` to write keyring
  - Derives `passwordRef` string and passes it to `initRepository()`
- **D-11:** `initRepository()` is exported from `src/core/index.ts` (alongside `syncAccount`, `restoreAccount`).

### What does NOT change
- **D-12:** `getPasswordByRef()` unchanged — it already handles `keyring:`, `env:`, and `BACKMAIL_PASSWORD` fallback at runtime.
- **D-13:** No changes to `src/core/config.ts`, `src/core/discovery.ts`, or any existing command.
- **D-14:** `archivePath = path.join(repoRoot, 'archive')` convention is used internally in `initRepository()` for the git repo init location.

### Claude's Discretion
- Exact prompt wording and per-field validation (e.g., port integer check)
- `simple-git` vs raw `git init` shell command for archive initialisation (simple-git already in dependencies)
- Whether `initRepository()` uses async fs from `node:fs/promises` or sync fs
- Unit test structure and fixture approach for init

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core modules being extended
- `src/core/config.ts` — `RepositoryConfig` type and `loadRepositoryConfig()` — `initRepository()` writes config.json in this same schema
- `src/core/index.ts` — current core exports; `initRepository` must be added here
- `src/core/discovery.ts` — `findRepository()` — init must NOT call this (init creates new repos); but understand the `.backmail/` marker convention

### CLI entry point (adding init command)
- `src/cli/index.ts` — current CLI structure; `init` is a new top-level command alongside sync/log/ls etc.

### Credential infrastructure
- `src/core/config.ts` — `parsePasswordRef()`, `getPasswordByRef()` — understand the passwordRef format before writing init
- `.planning/phases/06-credential-infrastructure/06-CONTEXT.md` D-02, D-03 — passwordRef format and fallback chain

### Requirements
- `.planning/REQUIREMENTS.md` §Repository Init — REPO-01 through REPO-05 definitions
- `.planning/ROADMAP.md` §Phase 9 — Success criteria

### Architecture decisions
- `.planning/phases/06-credential-infrastructure/06-CONTEXT.md` D-01 — `archive/` is always `path.join(repoRoot, 'archive')`
- `.planning/phases/07-repository-discovery/07-CONTEXT.md` D-03, D-06 — `.backmail/` directory is the marker, DISC-03 error message format

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@napi-rs/keyring` Entry class: already in package.json, already mocked in tests via `vi.mock('@napi-rs/keyring')` — use same mock pattern in init CLI tests
- `simple-git`: already in dependencies — use `git.init()` to initialise the archive git repo
- `RepositoryConfig` + Zod schema: defined in `src/core/config.ts` — `initRepository()` creates a config object of this type and serialises to JSON
- `parsePasswordRef()`: available in `src/core/config.ts` — use in CLI to validate `--password-ref` flag value before writing

### Established Patterns
- Core functions: no `process.exit`, no `console.*`, no CLI imports (ARCH-01)
- Throw `Error` with human-readable messages from core; CLI catches and prints to stderr then exits
- `syncAccount`, `restoreAccount` are the reference pattern for core function signatures
- `getRepoRoot()` in CLI: parallel helper needed is `resolveInitTarget(positionalPath)` → resolves to absolute path, checks it exists

### Integration Points
- `src/core/index.ts` — add `export { initRepository } from './init.js'`
- `src/cli/index.ts` — add `program.command('init')` with positional `[path]` arg and all flags

</code_context>

<specifics>
## Specific Ideas

- `--password-ref` help text must explicitly mention `env:BACKMAIL_PASSWORD` syntax so users know how to use it without a keyring
- Error message when keyring write fails must mention `--password-ref env:BACKMAIL_PASSWORD` as the workaround
- "repository already exists" error (REPO-04) is triggered by `.backmail/` directory presence — same marker `findRepository()` uses

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 09-init-command*
*Context gathered: 2026-04-30*
