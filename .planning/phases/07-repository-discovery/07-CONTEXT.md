# Phase 7: Repository Discovery - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Add repository auto-detection to the CLI: walk up from CWD looking for `.backmail/`, expose a `--workdir` global flag to override, and print a clear error when neither locates a repo. Migrate all existing commands away from the removed `loadConfig()` to use `findRepository()` + `loadRepositoryConfig()`. The `--account` registry and `resolveAccount()` remain until Phase 8 — Phase 7 only fixes the discovery plumbing.

Requirements in scope: DISC-01, DISC-02, DISC-03.

</domain>

<decisions>
## Implementation Decisions

### Walk-up algorithm
- **D-01:** `findRepository(startDir: string): string | null` lives in `src/core/discovery.ts` — pure function, no side effects, fully unit-testable. CLI reads `process.cwd()` and passes it in; `--workdir` path is passed directly.
- **D-02:** Walk stops at filesystem root (`/`). No git-root check — the walk always continues to `/` regardless of any `.git/` boundary above. Simpler rule, no false negatives inside git monorepos.
- **D-03:** Detection criterion is `.backmail/` directory existence (not `config.json`). Matches how git detects `.git/` — presence of the marker dir is sufficient.

### `--workdir` global flag
- **D-04:** `--workdir <path>` is a global Commander option on the root `program` object, not per-command. Syntax: `backmail --workdir /path/to/repo log`. Relative paths are resolved against CWD before use.
- **D-05:** When `--workdir` is given, skip walk-up entirely — pass the specified path directly as `repoRoot`. If `.backmail/` does not exist at that path, error immediately (same DISC-03 message, same exit code).

### DISC-03 error message
- **D-06:** Simple two-line format, no CWD path shown:
  ```
  Error: Not inside a backmail repository.
  Use `backmail init` to create one, or `--workdir <path>` to specify a path.
  ```
  Exit code 1.

### CLI migration
- **D-07:** `getConfig()` helper (which calls removed `loadConfig()`) is replaced with a new `getRepoRoot()` helper that runs discovery, then calls `loadRepositoryConfig(repoRoot)`. Both steps can throw — errors are caught at the command action level and printed to stderr.
- **D-08:** `archivePath` is derived as `path.join(repoRoot, 'archive')` inline in each command action — no new config field. This matches CONTEXT.md D-01 from Phase 6.
- **D-09:** Commands that currently use `resolveAccount()` keep that call for now — Phase 8 removes the account registry. Phase 7 only replaces config loading, not account resolution.

### Module exports
- **D-10:** `src/core/discovery.ts` exports: `findRepository(startDir: string): string | null`. Added to `src/core/index.ts` re-exports.

### Claude's Discretion
- Exact `path.resolve` / `path.dirname` walk implementation
- Whether `findRepository` uses sync `fs.existsSync` or async stat (sync preferred for simplicity — called once at CLI startup)
- Test fixture approach for unit tests (mock fs or temp directories)

</decisions>

<specifics>
## Specific Ideas

- Walk-up stops at filesystem root — no git-root boundary check, maximally permissive.
- Detection uses `.backmail/` directory presence only, not `config.json` (lenient, matches git's `.git/` convention).
- Error message is concise, no debug path output.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 6 output (being integrated)
- `src/core/config.ts` — `loadRepositoryConfig(repoRoot)`, `RepositoryConfig` type — this is what discovery feeds into
- `src/core/index.ts` — Current core exports; `findRepository` must be added here

### CLI entry point (being migrated)
- `src/cli/index.ts` — Current CLI: uses removed `loadConfig()` + `resolveAccount()`. Phase 7 replaces `loadConfig()` usage only.

### Requirements
- `.planning/REQUIREMENTS.md` §Discovery — DISC-01, DISC-02, DISC-03 definitions
- `.planning/ROADMAP.md` §Phase 7 — Success criteria

### Architecture decisions
- `.planning/phases/06-credential-infrastructure/06-CONTEXT.md` D-01 — `archive/` is always `path.join(repoRoot, 'archive')`, no config field

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/config.ts:loadRepositoryConfig(repoRoot)`: Takes a repo root string → reads `.backmail/config.json` → returns `RepositoryConfig`. `findRepository()` feeds directly into this.
- `src/cli/index.ts:getConfig()`: Pattern to replace — currently calls removed `loadConfig()`. New version calls `findRepository(process.cwd())` then `loadRepositoryConfig(repoRoot)`.

### Established Patterns
- ARCH-01/02: No `process.exit`, `console.*`, or CLI imports in `src/core/`. `findRepository()` in core must accept `startDir` parameter, not read `process.cwd()` directly.
- Commander global options: `program.option('--workdir <path>', '...')` then read via `program.opts().workdir` inside each `.action()` callback.

### Integration Points
- `src/cli/index.ts`: Each command action currently calls `getConfig()` — these become `getRepoRoot()` calls.
- `src/core/index.ts`: Add `findRepository` to re-exports.
- New file: `src/core/discovery.ts` — the walk-up implementation.

</code_context>

<deferred>
## Deferred Ideas

- Stopping walk at git root boundary — deferred, user chose filesystem root
- `--account` flag removal / `resolveAccount()` removal — Phase 8
- Init command (`backmail init`) — Phase 9
- CR-01: Unsafe BigInt() from corrupted folder JSON state — carried from Phase 3

</deferred>

---

*Phase: 07-repository-discovery*
*Context gathered: 2026-04-29*
