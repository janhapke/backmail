# Phase 6: Credential Infrastructure - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the core credential infrastructure for the v1.1 repository model: a new `RepositoryConfig` type, `loadRepositoryConfig(repoRoot)` function, and a `passwordRef` parser that supports both `keyring:service=X;account=Y` and `env:VARNAME` formats with graceful fallback to `BACKMAIL_PASSWORD`. Pure core module work — no CLI changes, no repo discovery, no init command. Those come in later phases.

Requirements in scope: CRED-01, CRED-02, CRED-03.

</domain>

<decisions>
## Implementation Decisions

### Archive path
- **D-01:** `archive/` path is a hardcoded convention — always `path.join(repoRoot, 'archive')`. No config field. This is the contract, like `.git/` for git. The `RepositoryConfig` type does NOT include an `archivePath` field; callers derive it from the repo root.

### passwordRef format
- **D-02:** The `passwordRef` parser supports both schemes in Phase 6:
  - `keyring:service=backmail;account=<username>` — looks up OS keyring
  - `env:VARNAME` — reads the named environment variable directly
- **D-03:** Plain `BACKMAIL_PASSWORD` env var also accepted as a top-level fallback (when no `passwordRef` is set or when both keyring and env: ref fail). Error message when nothing resolves must mention both options.

### passwordRef parsing implementation
- **D-04:** Parser is strict — unrecognised scheme (anything other than `keyring:` or `env:`) throws a clear error naming the unsupported scheme.
- **D-05:** Malformed `keyring:` refs (missing `service=` or `account=` keys) throw a descriptive parse error, not a silent failure.

### Old config code removal
- **D-06:** `loadConfig()`, `getConfigPath()`, `getConfigDir()`, and `getPassword(accountName)` are **removed** in this phase. They are dead code from v1.0 and keeping them creates confusion about which path is canonical.
- **D-07:** Any tests that covered the old functions are updated to cover the new equivalents (or removed if they tested paths that no longer exist).

### New module structure
- **D-08:** New code lives in `src/core/config.ts` (replacing the old content) — no new file needed. The public API becomes: `loadRepositoryConfig(repoRoot)`, `parsePasswordRef(ref)`, `getPasswordByRef(ref)`.
- **D-09:** `RepositoryConfig` type (Zod-validated): `{ host, port, username, tls, passwordRef }`. No `repoPath` (derived from root), no `archivePath` (hardcoded convention).

### Claude's Discretion
- Exact Zod schema internals and validation error messages (beyond the ones specified above)
- Async vs sync handling for keyring lookups (follow the existing pattern in config.ts: check for Promise return)
- Test structure and fixture approach

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing credential code (being replaced)
- `src/core/config.ts` — Current implementation: AccountConfigSchema, loadConfig(), getPassword(). This file is being gutted and replaced; read it to understand what must be preserved vs removed.
- `src/core/index.ts` — Current exports from core — must be updated to export new functions.

### Requirements
- `.planning/REQUIREMENTS.md` §Credentials — CRED-01, CRED-02, CRED-03 definitions
- `.planning/ROADMAP.md` §Phase 6 — Success criteria for this phase

### Architecture decisions
- `.planning/research/ARCHITECTURE.md` — New component signatures, data flow, core/CLI split rationale
- `.planning/research/PITFALLS.md` §Config / passwordRef Pitfalls — Parsing edge cases, malformed refs, migration concerns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `@napi-rs/keyring` Entry class: already in package.json, already mocked in tests via `vi.mock('@napi-rs/keyring')` — same mock pattern extends to new code
- Zod: already used for config validation — same pattern applies to `RepositoryConfig` schema
- Async/sync keyring pattern: `config.ts` already handles the Promise-vs-string return from `entry.getPassword()` — copy this pattern into `getPasswordByRef()`

### Established Patterns
- All core functions: no `process.exit`, no `console.*`, no CLI imports (ARCH-01)
- Throw `Error` with human-readable messages; callers decide how to surface them
- Zod `.parse()` for validation — throws `ZodError` on invalid input; callers may want to catch and re-throw with friendlier messages

### Integration Points
- `src/core/index.ts` — exports new public API functions
- Existing command handlers in `src/cli/index.ts` currently call `loadConfig()` and `resolveAccount()` — these will break when old code is removed; Phase 8 fixes that. Phase 6 just does the removal and builds the new core, aware that CLI will be temporarily broken.

</code_context>

<specifics>
## Specific Ideas

- The passwordRef format was explicitly designed during milestone planning: `keyring:service=backmail;account=<username>` with key=value pairs separated by semicolons. The parser must match this exactly.
- `env:VARNAME` is the scriptable/CI form — the variable name follows `env:` directly with no extra syntax.
- The `BACKMAIL_PASSWORD` plain env var fallback (no passwordRef) existed in v1.0 and must be preserved as a convenience — useful when people don't want to set up the keyring at all.

</specifics>

<deferred>
## Deferred Ideas

- Migration tooling for users coming from v1.0 central config — out of scope for this phase; noted for future milestone
- `env:` format extensibility (e.g., `env:VARNAME:default`) — keep simple for now

</deferred>

---

*Phase: 06-credential-infrastructure*
*Context gathered: 2026-04-29*
