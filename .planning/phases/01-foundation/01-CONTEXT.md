# Phase 1: Foundation - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Set up the TypeScript project scaffold, enforce the core/CLI module split, and wire up the Docker-backed Dovecot integration test environment. No email functionality is implemented — this phase establishes the skeleton that every later phase builds on.

Key deliverables:
- `package.json` + `tsconfig.json` + tooling config
- `src/core/` module with a public TypeScript API (no CLI imports)
- `src/cli/` thin wrapper over core
- `npm run test:integration` that starts Dovecot via docker-compose, runs tests, tears down

</domain>

<decisions>
## Implementation Decisions

### Module system
- **D-01:** ESM — `"type": "module"` in `package.json`. All imports/exports use ES module syntax. `tsconfig.json` targets ESNext with `moduleResolution: "bundler"` (or `"node16"`).

### Build tooling
- **D-02:** tsx for dev (run `.ts` files directly, no build step), tsc for production output to `dist/`. `package.json` scripts: `"dev": "tsx src/cli/index.ts"`, `"build": "tsc"`.

### Test runner
- **D-03:** Vitest — native ESM support, no transform config needed, Jest-compatible API. `testTimeout` set high enough for Docker container startup (~60s).

### Docker test orchestration
- **D-04:** docker-compose + shell script. `npm run test:integration` invokes a script that: `docker-compose up -d` → run Vitest → `docker-compose down`. No testcontainers dependency.

### Claude's Discretion
- tsconfig strictness level (recommend strict: true)
- Exact folder structure within `src/core/` and `src/cli/`
- Synthetic `.eml` fixture design and scope
- Docker Compose service name and port configuration for minimal-imap/Dovecot
- Whether to add a `vitest.config.ts` or configure via `vite.config.ts`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project requirements
- `.planning/REQUIREMENTS.md` — ARCH-01, ARCH-02 (core/CLI split), TEST-01, TEST-02, TEST-03 (integration test setup)
- `.planning/PROJECT.md` — eimerjs IPC boundary note, imapflow library choice, minimal-imap Docker container reference

### External
- [minimal-imap Docker image](https://github.com/gmitirol/minimal-imap) — Alpine + Dovecot container used for integration tests

No additional specs or ADRs defined yet — requirements are fully captured in REQUIREMENTS.md and decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None yet — greenfield project. Only `LICENSE` and `README.md` exist.

### Established Patterns
- None yet — this phase defines the patterns.

### Integration Points
- `src/core/index.ts` will be the public API boundary that Phase 2+ builds into
- `src/cli/index.ts` will be the CLI entry point that wraps core
- eimerjs IPC boundary: core module must remain importable without CLI (for future Electron)

</code_context>

<specifics>
## Specific Ideas

- No specific references from discussion — open to standard TypeScript project layout.
- Keep the `src/core/` API clean enough that Phase 2 (config) can extend it naturally.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-04-20*
