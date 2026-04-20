# Phase 1: Foundation - Research

**Researched:** 2026-04-20
**Domain:** TypeScript ESM project scaffold, core/CLI module split, Vitest + Docker integration test infrastructure
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (Module system):** ESM — `"type": "module"` in `package.json`. All imports/exports use ES module syntax. `tsconfig.json` targets ESNext with `moduleResolution: "bundler"` (or `"node16"`).
- **D-02 (Build tooling):** tsx for dev (run `.ts` files directly, no build step), tsc for production output to `dist/`. `package.json` scripts: `"dev": "tsx src/cli/index.ts"`, `"build": "tsc"`.
- **D-03 (Test runner):** Vitest — native ESM support, no transform config needed, Jest-compatible API. `testTimeout` set high enough for Docker container startup (~60s).
- **D-04 (Docker test orchestration):** docker-compose + shell script. `npm run test:integration` invokes a script that: `docker-compose up -d` → run Vitest → `docker-compose down`. No testcontainers dependency.

### Claude's Discretion

- tsconfig strictness level (recommend strict: true)
- Exact folder structure within `src/core/` and `src/cli/`
- Synthetic `.eml` fixture design and scope
- Docker Compose service name and port configuration for minimal-imap/Dovecot
- Whether to add a `vitest.config.ts` or configure via `vite.config.ts`

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ARCH-01 | Core sync/restore/browse logic is a clean TypeScript module with a public API — no CLI-specific code in core | `src/core/index.ts` as public boundary; verified via TypeScript project references or barrel exports |
| ARCH-02 | CLI is a thin wrapper over core — all functionality callable programmatically (eimerjs IPC boundary) | `src/cli/index.ts` imports only from `src/core/`; enforced by `noImplicitAny` + code review |
| TEST-01 | Integration tests use the minimal-imap Docker container as a real IMAP server | `gmitirol/minimal-imap:v1` on port 143; default user `imap`/`imap` |
| TEST-02 | `npm run test:integration` starts the Docker container, runs tests, tears it down automatically | Shell script wraps `docker compose up -d` + Vitest + `docker compose down`; Vitest `globalSetup` alternative also viable |
| TEST-03 | Test fixtures are synthetic `.eml` files committed to the repo — no real email, reproducible | `tests/fixtures/*.eml`; minimal RFC 2822 content |
</phase_requirements>

---

## Summary

This phase establishes the TypeScript project skeleton for backmail: a CLI tool that syncs IMAP mailboxes to git. The core constraint is the eimerjs IPC boundary — `src/core/` must be importable by a future Electron app without pulling in CLI-specific code, so the core/CLI split must be enforced structurally from the start, not just by convention.

The locked decisions are well-chosen. TSX 4.x handles ESM TypeScript natively; Vitest 4.x has native ESM support and a `testTimeout` knob for slow Docker startups; the docker-compose shell-script approach for integration tests is the standard lightweight pattern and avoids testcontainers complexity. The one open question on D-01 — `moduleResolution: "bundler"` vs `"node16/nodenext"` — has a clear answer: `nodenext` is the correct choice for a Node.js CLI that will also be compiled to `dist/` and distributed via npm. `bundler` is appropriate only for Vite/webpack pipelines and would allow extensionless imports that fail at runtime in Node.js.

The minimal-imap Docker image (`gmitirol/minimal-imap:v1`) exposes port 143 with default credentials `imap`/`imap`. It is a static image last updated ~5 years ago (Alpine 3.12/3.13 + Dovecot) with no updates planned — this is intentional for a test fixture. The image is lean (30.7 MB) and suitable for CI.

**Primary recommendation:** Use `module: "nodenext"` (not `"bundler"`) in tsconfig. Keep the Docker orchestration in a shell script rather than Vitest `globalSetup` to keep the test runner decoupled from Docker lifecycle management — this is simpler to debug and easier to run Docker cleanup on CI failure.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| IMAP sync/restore/browse logic | API / Backend (core module) | — | Must be importable without CLI; eimerjs IPC boundary |
| CLI argument parsing + formatting | CLI layer (src/cli/) | — | Thin wrapper; no business logic here |
| Integration test infrastructure | Test / CI layer | Docker (external) | Tests call core directly; Docker provides IMAP server |
| TypeScript compilation | Build tooling (tsc) | Dev runtime (tsx) | tsc for dist/, tsx for fast iteration |
| Module boundary enforcement | TypeScript compiler | Code review | Structural separation, not just convention |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| typescript | 6.0.3 | Type checking + tsc compilation | Language; enforces ARCH-01/02 boundary |
| tsx | 4.21.0 | Run `.ts` files directly in dev, no build step | Zero-config ESM TypeScript runner; locked decision D-02 |
| vitest | 4.1.4 | Test runner | Native ESM, Jest-compatible API, `testTimeout` config; locked decision D-03 |
| @types/node | 25.6.0 | Node.js type definitions | Required for fs, path, child_process in CLI/core |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| commander | 14.0.3 | CLI argument parsing | Wire up in src/cli/ — keeps option parsing out of core |

**Version verification:** All versions confirmed against npm registry on 2026-04-20. [VERIFIED: npm registry]

**Installation:**
```bash
npm install --save-dev typescript tsx vitest @types/node
npm install commander
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tsx (dev runner) | ts-node | tsx is zero-config for ESM; ts-node requires `--esm` flag and loader configuration |
| vitest | jest | Jest requires `--experimental-vm-modules` for ESM; Vitest works natively |
| shell script (Docker orchestration) | testcontainers | testcontainers adds a heavyweight npm dependency; shell script is simpler and more debuggable |
| commander (CLI parsing) | yargs / minimist | commander is the most ergonomic for typed TypeScript CLIs at this scale |

---

## Architecture Patterns

### System Architecture Diagram

```
npm run test:integration
        │
        ▼
scripts/test-integration.sh
        │
        ├─── docker compose up -d ──► gmitirol/minimal-imap:v1
        │                                  (port 143, imap/imap)
        │
        ├─── vitest run --config vitest.integration.config.ts
        │         │
        │         ├─► tests/integration/*.test.ts
        │         │         │
        │         │         └─► src/core/index.ts  (public API)
        │         │                   │
        │         │                   └─► [imapflow in Phase 2+]
        │         │
        │         └─► tests/fixtures/*.eml  (synthetic, committed)
        │
        └─── docker compose down
```

Unit tests run separately:
```
npm test
    │
    └─► vitest run  (src/**/*.test.ts, no Docker)
```

### Recommended Project Structure

```
backmail/
├── src/
│   ├── core/
│   │   └── index.ts          # Public API barrel — ARCH-01 boundary
│   └── cli/
│       └── index.ts          # Thin CLI wrapper — ARCH-02 boundary
├── tests/
│   ├── fixtures/
│   │   └── *.eml             # Synthetic RFC 2822 fixtures — TEST-03
│   ├── unit/                 # No Docker dependency
│   └── integration/          # Requires Docker
├── scripts/
│   └── test-integration.sh   # Docker up → vitest → Docker down
├── docker-compose.yml        # Dovecot service definition
├── vitest.config.ts          # Unit test config
├── vitest.integration.config.ts  # Integration test config (higher testTimeout)
├── tsconfig.json
└── package.json
```

### Pattern 1: tsconfig.json for Node.js ESM CLI

**What:** TypeScript config for a Node.js project distributed via npm that uses native ESM.
**When to use:** Any Node.js CLI that sets `"type": "module"` in package.json.

```jsonc
// Source: https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",   // implied by module:nodenext
    "target": "ES2022",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Why `nodenext` not `bundler`:** With `moduleResolution: "bundler"`, TypeScript allows extensionless relative imports (`import './utils'`) that fail at Node.js runtime with `ERR_MODULE_NOT_FOUND`. For a CLI compiled to `dist/` and run by Node.js directly, `nodenext` is correct. [CITED: typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options]

**Note on D-01 conflict:** CONTEXT.md lists `"bundler"` as an option alongside `"node16"`. The recommendation here is `"nodenext"` (which supersedes `"node16"`). Both enforce extensions; `nodenext` is the current canonical form. This is Claude's Discretion territory — recommend `nodenext`.

### Pattern 2: package.json for ESM CLI

```json
{
  "name": "backmail",
  "type": "module",
  "bin": { "backmail": "./dist/cli/index.js" },
  "main": "./dist/core/index.js",
  "exports": {
    ".": "./dist/core/index.js"
  },
  "scripts": {
    "dev": "tsx src/cli/index.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "bash scripts/test-integration.sh",
    "typecheck": "tsc --noEmit"
  }
}
```

### Pattern 3: Vitest config (unit tests)

```typescript
// Source: https://github.com/vitest-dev/vitest/blob/main/docs/config/testtimeout.md
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 10_000,
  },
})
```

### Pattern 4: Vitest config (integration tests)

```typescript
// vitest.integration.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 120_000,   // Docker startup can take 30-60s on cold pull
    hookTimeout: 30_000,
  },
})
```

### Pattern 5: Docker Compose for minimal-imap

```yaml
# docker-compose.yml
# Source: https://github.com/gmitirol/minimal-imap (Dockerfile: EXPOSE 143)
services:
  imap:
    image: gmitirol/minimal-imap:v1
    ports:
      - "143:143"
    environment:
      IMAP_USERS: "testuser:testpass"
```

### Pattern 6: Integration test shell script

```bash
#!/usr/bin/env bash
# scripts/test-integration.sh
set -euo pipefail

cleanup() {
  echo "Tearing down Docker..."
  docker compose down --remove-orphans
}
trap cleanup EXIT

echo "Starting IMAP container..."
docker compose up -d

echo "Waiting for IMAP to be ready..."
timeout 60 bash -c 'until docker compose exec -T imap nc -z localhost 143 2>/dev/null; do sleep 1; done'

echo "Running integration tests..."
npx vitest run --config vitest.integration.config.ts

echo "Done."
```

### Pattern 7: core/index.ts API boundary

```typescript
// src/core/index.ts — ARCH-01: no CLI imports, no process.exit, no console
// This file is the eimerjs IPC boundary

export interface AccountConfig {
  host: string
  port: number
  username: string
  tls: boolean
  repoPath: string
}

// Phase 1: skeleton only — real implementations land in Phase 2+
export async function ping(config: AccountConfig): Promise<boolean> {
  throw new Error('Not implemented')
}
```

### Pattern 8: Synthetic .eml fixture (TEST-03)

```
From: test@example.com
To: recipient@example.com
Subject: Test fixture 001
Date: Mon, 01 Jan 2024 12:00:00 +0000
Message-ID: <fixture-001@example.com>
MIME-Version: 1.0
Content-Type: text/plain

This is a synthetic test fixture. No real email content.
```

### Anti-Patterns to Avoid

- **`moduleResolution: "bundler"` in a Node.js CLI:** Allows extensionless imports that fail at runtime. Use `nodenext`. [CITED: typescriptlang.org]
- **Calling `process.exit()` or `console.log()` in `src/core/`:** Breaks the eimerjs IPC boundary. These belong exclusively in `src/cli/`.
- **Single vitest config for both unit + integration tests:** Integration tests have Docker dependency and a 60s+ timeout. They must be separable so `npm test` (unit) stays fast. Use two config files.
- **Docker `up` without `--remove-orphans` in cleanup:** Leaves stale containers on CI. Always `docker compose down --remove-orphans` in the trap.
- **Relying on `docker-compose` (v1 CLI):** The v1 `docker-compose` binary is deprecated. Use `docker compose` (v2, built into Docker CLI). [VERIFIED: docker --version = 28.3.3, Compose v2.39.1 available on this machine]
- **Hardcoding Docker startup wait as `sleep N`:** Container may be ready faster or slower. Use a readiness probe loop (nc or grep IMAP capability banner).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript execution in dev | Custom loader/transpile pipeline | tsx | tsx handles all ESM/CJS/paths edge cases including `--tsconfig` scoping |
| CLI argument parsing | Manual `process.argv` parsing | commander | Commander handles subcommands, required options, help text, type coercion |
| Test isolation between unit + integration | Single test run with env flags | Two vitest configs | Config-level separation is explicit and avoids accidental cross-contamination |
| Docker readiness detection | Fixed `sleep 30` | Loop with `nc` / banner check | Reduces CI wait time; handles fast machines and slow CI |

**Key insight:** This phase is pure scaffolding. The value is in the structural decisions (core/CLI split, ESM module resolution) — not in bespoke tooling. Use battle-tested tools for everything that isn't business logic.

---

## Common Pitfalls

### Pitfall 1: ESM relative imports need `.js` extension

**What goes wrong:** With `moduleResolution: "nodenext"`, TypeScript requires explicit `.js` extensions on relative imports — even though you're writing `.ts` files. `import './utils'` fails at runtime; `import './utils.js'` works (TypeScript rewrites to `.js` at compile time).

**Why it happens:** Node.js ESM resolver does not auto-append extensions. TypeScript mirrors Node.js behavior exactly in `nodenext` mode.

**How to avoid:** Always write `import './utils.js'` in source files. TypeScript will find the `.ts` file during type-checking and emit the `.js` file at build time. [CITED: typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options]

**Warning signs:** `ERR_MODULE_NOT_FOUND` errors when running `dist/` output directly.

### Pitfall 2: Vitest testTimeout too low for Docker startup

**What goes wrong:** Default Vitest `testTimeout` is 5000ms (5s). Cold Docker image pull + container startup for minimal-imap takes 10-60s. Tests fail with `Timeout: test timed out` before IMAP is even ready.

**Why it happens:** Docker cold pulls on CI are slow. The shell script readiness probe handles the wait, but any test that implicitly waits for the IMAP connection also needs headroom.

**How to avoid:** Set `testTimeout: 120_000` in `vitest.integration.config.ts`. The shell script also uses a readiness probe before invoking Vitest.

**Warning signs:** Intermittent test failures on CI that pass locally (local has cached image layers).

### Pitfall 3: Core module importing CLI modules

**What goes wrong:** A developer adds a utility to `src/cli/` and imports it from `src/core/`. Works fine for CLI use. Breaks when Electron tries to import core via eimerjs IPC (CLI code may call `process.exit()` or use readline).

**Why it happens:** JavaScript/TypeScript has no enforced module boundary at the language level.

**How to avoid:** Keep `src/core/` as a pure library. No imports from `src/cli/`. Enforce via code review rule: "any import in `src/core/` that references `src/cli/` is a bug." Optionally use TypeScript project references to make this a compiler error.

**Warning signs:** `src/core/index.ts` imports anything from `../cli/`.

### Pitfall 4: docker-compose v1 vs v2 syntax

**What goes wrong:** Scripts use `docker-compose` (hyphen, v1 binary) which is deprecated and not installed in newer Docker Desktop / Docker Engine installations.

**Why it happens:** Stack Overflow examples and older tutorials still show `docker-compose`.

**How to avoid:** Always use `docker compose` (space, v2). The machine running this project has Docker 28.3.3 with Compose v2.39.1 — v2 is the only version present. [VERIFIED: docker compose version = v2.39.1]

**Warning signs:** `command not found: docker-compose`

---

## Code Examples

Verified patterns from official sources:

### Vitest globalSetup pattern (alternative to shell script)

```typescript
// Source: https://github.com/vitest-dev/vitest/blob/main/docs/config/globalsetup.md
// vitest-global-setup.ts — use ONLY if shell-script approach is too limiting

import type { TestProject } from 'vitest/node'
import { execSync } from 'node:child_process'

export function setup(project: TestProject) {
  execSync('docker compose up -d', { stdio: 'inherit' })
  project.provide('imapHost', 'localhost')
  project.provide('imapPort', 143)
}

export function teardown() {
  execSync('docker compose down --remove-orphans', { stdio: 'inherit' })
}
```

NOTE: The locked decision (D-04) prefers the shell-script approach, not globalSetup. Document this as an alternative only.

### tsx watch mode (dev)

```bash
# Source: https://github.com/privatenumber/tsx/blob/master/docs/getting-started.md
tsx watch ./src/cli/index.ts
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ts-node` for dev execution | `tsx` | ~2022 | Zero-config ESM support; tsx is the ecosystem default |
| `moduleResolution: "node"` | `"nodenext"` | TypeScript 4.7 (2022) | Proper ESM enforcement; extensions required |
| `moduleResolution: "node16"` | `"nodenext"` | TypeScript 4.7 (2022) | `nodenext` is the stable alias; `node16` still works but `nodenext` is preferred |
| `docker-compose` (v1) | `docker compose` (v2) | Docker 2023+ | v1 binary removed from modern Docker Desktop |
| Jest for TypeScript tests | Vitest | 2022+ | No transform config needed for ESM |

**Deprecated/outdated:**
- `ts-node --esm`: Works but requires loader flags; tsx supersedes it
- `moduleResolution: "node"` (classic): Does not understand `package.json` exports field; should not be used for new Node.js projects
- `docker-compose` binary (v1): Removed from Docker Desktop 4.20+ and Docker Engine modern installs

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `nodenext` is the correct `moduleResolution` for this project (D-01 mentions `"bundler"` as an option) | Standard Stack, Pattern 1 | If user prefers `bundler` because tsx handles extensions at dev time, the dist/ output would still require extensions — only a concern if distributing the library. Risk: low for a CLI, but should be confirmed. |
| A2 | minimal-imap `v1` tag is the only/correct tag to use | Standard Stack, Pattern 5 | Docker Hub shows only one tag (`v1`, last updated ~5 years ago). If the image is unavailable or incompatible with newer Docker, tests fail. Risk: low but worth a `docker pull` smoke test in Wave 0. |

---

## Open Questions

1. **`moduleResolution: "bundler"` vs `"nodenext"` (D-01)**
   - What we know: D-01 lists both as options. Official TypeScript docs recommend `nodenext` for Node.js CLI/library projects.
   - What's unclear: Whether tsx's dev-time handling of extensionless imports makes `bundler` acceptable for the dev workflow even if `dist/` output needs explicit extensions.
   - Recommendation: Use `nodenext`. tsx at dev time is unaffected (tsx resolves `.ts` files regardless). The `dist/` output must run in Node.js natively, so `nodenext` prevents a class of runtime errors.

2. **Docker readiness probe mechanism**
   - What we know: minimal-imap exposes port 143. Standard IMAP greeting is `* OK Dovecot ready.`
   - What's unclear: Whether `nc -z localhost 143` is sufficient or whether a banner check is needed.
   - Recommendation: Use `nc -z` port probe first; if flaky on CI, upgrade to a banner-level check with `openssl s_client` or a minimal Node.js TCP connect.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Engine | TEST-01, TEST-02 | Yes | 28.3.3 | — |
| Docker Compose v2 | TEST-02 | Yes | v2.39.1 | — |
| Node.js | Build, dev, test | Yes | v24.11.1 | — |
| npm | Package install | Yes | 11.6.2 | — |

**Missing dependencies with no fallback:** None.

**Notes:** Docker Compose v2 (`docker compose`) confirmed available. The legacy `docker-compose` (v1) binary is NOT present — scripts must use `docker compose` (space). [VERIFIED: docker compose version = v2.39.1 on this machine]

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.4 |
| Config file (unit) | `vitest.config.ts` — Wave 0 gap |
| Config file (integration) | `vitest.integration.config.ts` — Wave 0 gap |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run && bash scripts/test-integration.sh` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-01 | `src/core/index.ts` exports a TypeScript API with no CLI imports | unit (import check) | `npx vitest run tests/unit/core-api-boundary.test.ts` | Wave 0 |
| ARCH-02 | `src/cli/index.ts` imports only from `src/core/` and node builtins | unit (import check) | `npx vitest run tests/unit/cli-boundary.test.ts` | Wave 0 |
| TEST-01 | Integration test connects to minimal-imap on port 143 | integration | `bash scripts/test-integration.sh` | Wave 0 |
| TEST-02 | `npm run test:integration` starts Docker, runs tests, tears down | smoke | `npm run test:integration` | Wave 0 |
| TEST-03 | `tests/fixtures/*.eml` files exist and are valid RFC 2822 | unit | `npx vitest run tests/unit/fixtures.test.ts` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run` (unit only, no Docker)
- **Per wave merge:** `npx vitest run && npm run test:integration`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `vitest.config.ts` — unit test runner config
- [ ] `vitest.integration.config.ts` — integration test config with `testTimeout: 120_000`
- [ ] `tests/unit/core-api-boundary.test.ts` — ARCH-01 boundary check
- [ ] `tests/unit/cli-boundary.test.ts` — ARCH-02 boundary check
- [ ] `tests/unit/fixtures.test.ts` — TEST-03 fixture validation
- [ ] `tests/integration/imap-connect.test.ts` — TEST-01 smoke connect
- [ ] `scripts/test-integration.sh` — TEST-02 orchestration
- [ ] `docker-compose.yml` — IMAP service definition
- [ ] Framework install: `npm install --save-dev vitest`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not applicable — Phase 1 has no auth implementation |
| V3 Session Management | No | Not applicable — Phase 1 has no session logic |
| V4 Access Control | No | Not applicable — Phase 1 has no access control |
| V5 Input Validation | No | Not applicable — Phase 1 has no user input processing |
| V6 Cryptography | No | Not applicable — Phase 1 has no crypto |

**Phase 1 security note:** The only security-relevant concern is that `tests/fixtures/*.eml` must contain synthetic (not real) email content. This is encoded in TEST-03 and enforced structurally by the fixture design.

---

## Sources

### Primary (HIGH confidence)

- [/privatenumber/tsx on Context7] — CLI usage, package.json scripts, ESM registration
- [/vitest-dev/vitest on Context7] — testTimeout, globalSetup, include/exclude patterns, globalSetup with provide/inject
- [typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options] — `nodenext` vs `bundler` recommendation
- [gmitirol/minimal-imap Dockerfile] — EXPOSE 143 confirmed
- npm registry — tsx@4.21.0, vitest@4.1.4, typescript@6.0.3, @types/node@25.6.0, commander@14.0.3

### Secondary (MEDIUM confidence)

- [hub.docker.com/r/gmitirol/minimal-imap] — `v1` tag, 30.7 MB, default credentials `imap`/`imap`
- [github.com/gmitirol/minimal-imap README] — `IMAP_USERS` env var format

### Tertiary (LOW confidence)

- None — all claims verified with primary or secondary sources

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions npm-verified 2026-04-20
- Architecture: HIGH — patterns from official Context7 docs
- Docker image: MEDIUM — Docker Hub metadata verified; image is 5 years old with no updates, `v1` is the only tag
- Pitfalls: HIGH — sourced from official TypeScript ESM docs and verified local environment

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (stable ecosystem; tsx/vitest/typescript patch versions may update but patterns are stable)
