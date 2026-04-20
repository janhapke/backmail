# Phase 2: Configuration - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can configure named IMAP accounts with secure credentials, and the CLI resolves the config file from the correct OS-appropriate path. This phase builds the config module in `src/core/` and wires the `backmail` CLI to read it. No sync, browse, or restore functionality — config loading is the deliverable.

</domain>

<decisions>
## Implementation Decisions

### Config CLI commands
- **D-01:** File-based only — no `backmail config` subcommands in Phase 2. Users create and edit `config.json` manually. The CLI reads and validates it; no interactive config management.

### Config schema
- **D-02:** Named accounts as a top-level object with account name as key: `{"accounts": {"gmail": {...}, "work": {...}}}`. No duplicate name collisions possible; key-based lookup at O(1).
- **D-03:** `repoPath` accepts any of: tilde-expanded (`~/mail/gmail`), absolute (`/home/jan/mail/gmail`), or relative to the config file directory (`./gmail`). All resolved to absolute at load time.
- **D-04:** Config file is JSON at the OS-appropriate path: `~/.config/backmail/config.json` (Linux), `~/Library/Application Support/backmail/config.json` (macOS), `%APPDATA%\backmail\config.json` (Windows).

### Credential storage
- **D-05:** keytar service name: `"backmail"`, account key: the account name from config (e.g., `"gmail"`). One keyring entry per named account.
- **D-06:** Env var fallback: always `BACKMAIL_<ACCOUNT>_PASSWORD` (uppercased account name). No special-case for single account — consistent across all configs.
- **D-07:** Credential lookup order: keytar first → env var → throw (not at load time, see D-09).

### Missing/invalid config behavior
- **D-08:** No config file at startup → clear error with path and instructions: `No config found at <OS path>. Create it with your IMAP accounts — see README for format.` Exit non-zero. No template file creation, no wizard.
- **D-09:** Missing credentials are NOT validated at config load time. Error is thrown lazily when a command actually needs the password (sync, restore). Error message: `No credential for account "<name>" — set BACKMAIL_<NAME>_PASSWORD or add to OS keyring.`

### Claude's Discretion
- JSON schema validation library choice (or manual validation)
- Exact field validation rules (e.g., port range, TLS boolean coercion)
- Internal module structure within `src/core/config.ts`
- Whether to export a `getConfig()` singleton or a `loadConfig(path)` function
- `backmail` command to show which account is being used when running subcommands

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §CONFIG-01, CONFIG-02, CONFIG-03 — OS config paths, multi-account schema, keytar + env var credential spec

### Project context
- `.planning/PROJECT.md` — eimerjs IPC boundary note (core module must remain importable without CLI), plain IMAP only (no OAuth)

### Existing core API
- `src/core/index.ts` — `AccountConfig` interface already defined (`host, port, username, tls, repoPath`) — Phase 2 extends this file or imports from it; do not redefine

### Phase 1 decisions
- `.planning/phases/01-foundation/01-CONTEXT.md` — ESM, tsx, Vitest, core/CLI split rules

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/index.ts`: `AccountConfig` interface already defined — Phase 2 config schema must align with this type. Extend or re-export rather than redefine.
- `src/cli/index.ts`: Commander skeleton with no subcommands — Phase 2 adds at minimum a passthrough that reads config before any command runs.
- Vitest + docker-compose test infra already in place — integration tests for config loading can run without Docker (no IMAP needed for config unit tests).

### Established Patterns
- ESM (`"type": "module"`) — all imports use `.js` extensions in source
- No `process.exit()` or `console.*` in `src/core/` — config error must throw, not exit
- ARCH-02: CLI is a thin wrapper — config loading logic belongs in `src/core/config.ts`, not `src/cli/`

### Integration Points
- `src/core/index.ts` is the public API boundary — config types and `loadConfig` go here or in a file re-exported through it
- `src/cli/index.ts` calls the config loader before dispatching to subcommands (Phase 3+ will need it)
- keytar is not yet in `package.json` — Phase 2 adds it as a dependency

</code_context>

<specifics>
## Specific Ideas

No specific references — open to standard approaches for config file loading and keytar integration.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-configuration*
*Context gathered: 2026-04-20*
