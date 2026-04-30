# Phase 8: Command Migration - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Remove the account registry from all CLI commands and clean up all legacy account-model code from the codebase. The core function signatures (`syncAccount`, `restoreAccount`) already accept `RepositoryConfig` and `archivePath` — the CLI layer was updated in Phase 7. Phase 8 finishes the job: remove `--account` options, remove the `accounts` subcommand, and scrub legacy types from `browse.ts` and `core/index.ts`.

Requirements in scope: CMD-01, CMD-02.

</domain>

<decisions>
## Implementation Decisions

### `--account` flag removal
- **D-01:** Remove `--account <name>` option registration from every command (`log`, `checkout`, `ls`, `view`, `restore`, `sync`). Commander produces its own "unknown option" error when a caller passes `--account`. No custom error handling required.
- **D-02:** The `sync` command also has `--all` option (syncs all accounts). This option is removed too — the repository config holds exactly one account; `--all` has no meaning.

### `accounts` subcommand
- **D-03:** Remove the `accounts` command entirely. Commander emits its own "unknown command" error. No custom redirect message needed.

### Legacy type and function removal
- **D-04:** Delete `LegacyAccountConfig`, `LegacyBackmailConfig`, and `resolveAccount` from `src/core/browse.ts`.
- **D-05:** Remove the `resolveAccount` re-export from `src/core/index.ts`.
- **D-06:** Remove the `resolveAccount` import from `src/cli/index.ts` (currently imported but never called in action handlers — dead import).

### CLI helper cleanup
- **D-07:** `getConfig()` in `src/cli/index.ts` is dead after `accounts` is removed (no other command calls it). Remove `getConfig()`. Each command that needs config already calls `getRepoRoot()` + `loadRepositoryConfig()` inline.

### What does NOT change
- **D-08:** `getPasswordByRef` stays exported from `src/core/index.ts` — Phase 9 (`init`) will need it.
- **D-09:** `resolveAccount` removal does NOT affect `restoreAccount`, `syncAccount`, or any Phase 3–5 logic — those already use `RepositoryConfig`.
- **D-10:** No changes to `src/core/sync.ts`, `src/core/restore.ts` — both already use `RepositoryConfig`.

### Claude's Discretion
- Exact order of edits within each file
- Whether to delete dead `opts.account` destructuring in action handlers (yes, remove it; keeping unused destructured vars is noise)

</decisions>

<specifics>
## Specific Notes

- Build is already green with no TypeScript errors — Phase 8 is pure cleanup, no new function signatures.
- `src/core/browse.ts` already marks legacy types as `@deprecated` with "Kept for Phase 8 removal" — that's the green light to delete.
- After removing `resolveAccount` from `core/index.ts`, run `npm run build` to confirm no stray imports remain.
- Unit tests reference `resolveAccount` in the Phase 4 browse test suite — remove those test cases alongside the function.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Files being modified
- `src/cli/index.ts` — remove: `--account` options, `--all` on sync, `accounts` command, `getConfig()` helper, `resolveAccount` import
- `src/core/browse.ts` — remove: `LegacyAccountConfig`, `LegacyBackmailConfig`, `resolveAccount` function
- `src/core/index.ts` — remove: `resolveAccount` from re-exports

### Files NOT changing
- `src/core/sync.ts` — already uses `RepositoryConfig`; no changes
- `src/core/restore.ts` — already uses `RepositoryConfig`; no changes
- `src/core/config.ts` — no changes
- `src/core/discovery.ts` — no changes

### Requirements
- `.planning/REQUIREMENTS.md` §Command Migration — CMD-01, CMD-02 definitions
- `.planning/ROADMAP.md` §Phase 8 — Success criteria

### Prior phase context
- `.planning/phases/07-repository-discovery/07-CONTEXT.md` D-09 — `resolveAccount` kept in Phase 7 intentionally; Phase 8 removes it
- `.planning/phases/06-credential-infrastructure/06-CONTEXT.md` D-01 — `archivePath = path.join(repoRoot, 'archive')` convention (already applied in CLI)

</canonical_refs>

<code_context>
## Existing Code Insights

### What to delete (Phase 7 kept these deliberately)
- `src/cli/index.ts:49` — `resolveAccount` in import list
- `src/cli/index.ts:34-43` — `getConfig()` function (used only by `accounts` command)
- `src/cli/index.ts:115-122` — `accounts` command block
- `src/cli/index.ts` — `.option('--account <name>', ...)` on log, checkout, ls, view, restore
- `src/cli/index.ts` — `.option('--all', 'sync all configured accounts')` on sync
- `src/core/browse.ts:27-62` — `LegacyAccountConfig`, `LegacyBackmailConfig`, `resolveAccount`
- `src/core/index.ts:33-34` — `resolveAccount` re-export line

### Build status
- `npm run build` passes with 0 errors as of Phase 7 completion
- `npm test` (124 unit tests) passes

### Test files to update
- `tests/unit/browse.test.ts` — likely contains `resolveAccount` test cases; remove them alongside the function

</code_context>

<deferred>
## Deferred

- Init command (`backmail init`) — Phase 9
- `--account` flag was left on commands in Phase 7 (D-09) intentionally — now removed in Phase 8
- CR-01: Unsafe BigInt() from corrupted folder JSON — carried from Phase 3

</deferred>

---

*Phase: 08-command-migration*
*Context gathered: 2026-04-29*
