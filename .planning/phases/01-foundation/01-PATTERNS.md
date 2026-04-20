# Phase 1: Foundation - Pattern Map

**Mapped:** 2026-04-20
**Files analyzed:** 14 new files
**Analogs found:** 0 / 14 — greenfield project (only LICENSE and README.md exist)

---

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `package.json` | config | — | none | greenfield |
| `tsconfig.json` | config | — | none | greenfield |
| `vitest.config.ts` | config | — | none | greenfield |
| `vitest.integration.config.ts` | config | — | none | greenfield |
| `docker-compose.yml` | config | — | none | greenfield |
| `scripts/test-integration.sh` | utility | event-driven | none | greenfield |
| `src/core/index.ts` | service (public API boundary) | request-response | none | greenfield |
| `src/cli/index.ts` | utility (CLI entry point) | request-response | none | greenfield |
| `tests/unit/core-api-boundary.test.ts` | test | request-response | none | greenfield |
| `tests/unit/cli-boundary.test.ts` | test | request-response | none | greenfield |
| `tests/unit/fixtures.test.ts` | test | file-I/O | none | greenfield |
| `tests/integration/imap-connect.test.ts` | test | request-response | none | greenfield |
| `tests/fixtures/fixture-001.eml` | config (test data) | file-I/O | none | greenfield |
| `tests/fixtures/fixture-002.eml` | config (test data) | file-I/O | none | greenfield |

---

## Pattern Assignments

All patterns are sourced from RESEARCH.md (official documentation) since no codebase analogs exist.

---

### `package.json` (config)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Pattern 2 (package.json for ESM CLI)

**Core pattern:**
```json
{
  "name": "backmail",
  "version": "0.1.0",
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
  },
  "devDependencies": {
    "typescript": "6.0.3",
    "tsx": "4.21.0",
    "vitest": "4.1.4",
    "@types/node": "25.6.0"
  },
  "dependencies": {
    "commander": "14.0.3"
  }
}
```

**Key decisions:**
- `"type": "module"` — ESM throughout (D-01)
- `bin` entry points to `dist/cli/index.js` for global install / npx (PKG-01)
- `main`/`exports` point to `dist/core/index.js` — core is the importable API (ARCH-01)
- `dev` script uses `tsx` for zero-config TypeScript execution (D-02)
- `test:integration` delegates to shell script, not a Vitest globalSetup (D-04)

---

### `tsconfig.json` (config)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Pattern 1 (tsconfig.json for Node.js ESM CLI)

**Core pattern:**
```jsonc
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
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

**Key decisions:**
- `"module": "nodenext"` not `"bundler"` — enforces `.js` extensions on relative imports, prevents `ERR_MODULE_NOT_FOUND` at runtime (RESEARCH.md Pitfall 1, Open Question 1)
- `"strict": true` — catches boundary violations early (Claude's Discretion, RESEARCH.md recommendation)
- `"verbatimModuleSyntax": true` — prevents TypeScript from eliding type-only imports, required for nodenext
- `rootDir: "src"` keeps `tests/` out of the compiled output

---

### `vitest.config.ts` (config)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Pattern 3 (Vitest config, unit tests)

**Core pattern:**
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 10_000,
  },
})
```

**Key decisions:**
- Does NOT include `tests/integration/` — unit tests must run without Docker (RESEARCH.md Anti-Patterns)
- `testTimeout: 10_000` — generous for unit tests but not absurd
- Separate from `vitest.integration.config.ts` to keep `npm test` fast

---

### `vitest.integration.config.ts` (config)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Pattern 4 (Vitest config, integration tests)

**Core pattern:**
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
})
```

**Key decisions:**
- `testTimeout: 120_000` — Docker cold pull can take 30-60s on CI (RESEARCH.md Pitfall 2)
- `hookTimeout: 30_000` — beforeAll/afterAll hooks that handle IMAP connection setup
- Only invoked via `scripts/test-integration.sh`, not `npm test`

---

### `docker-compose.yml` (config)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Pattern 5 (Docker Compose for minimal-imap)

**Core pattern:**
```yaml
services:
  imap:
    image: gmitirol/minimal-imap:v1
    ports:
      - "143:143"
    environment:
      IMAP_USERS: "testuser:testpass"
```

**Key decisions:**
- Service name `imap` — used by shell script readiness probe (`docker compose exec -T imap ...`)
- Port `143:143` — plain IMAP (no TLS in test environment, simpler for integration tests)
- `IMAP_USERS` env var — per minimal-imap README (default is `imap`/`imap`; explicit is clearer)
- `gmitirol/minimal-imap:v1` — the only available tag; Alpine + Dovecot, 30.7 MB
- Uses `docker compose` (v2) syntax, not `docker-compose` (v1) — v1 not present on this machine (RESEARCH.md Pitfall 4)

---

### `scripts/test-integration.sh` (utility, event-driven)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Pattern 6 (Integration test shell script)

**Core pattern:**
```bash
#!/usr/bin/env bash
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

**Key decisions:**
- `set -euo pipefail` — fail fast on any error, unset variable, or pipe failure
- `trap cleanup EXIT` — Docker teardown runs even on test failure or Ctrl-C (RESEARCH.md Anti-Patterns: `--remove-orphans`)
- Port readiness probe with `nc -z` loop (not `sleep N`) — handles variable Docker startup time (RESEARCH.md Anti-Patterns, Open Question 2)
- `timeout 60` wraps the readiness loop — prevents infinite hang if container is broken
- `docker compose down --remove-orphans` in cleanup — prevents stale containers on CI

---

### `src/core/index.ts` (service, public API boundary, request-response)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Pattern 7 (core/index.ts API boundary)

**Core pattern:**
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

**Key decisions:**
- No `process.exit()`, no `console.log()`, no readline — these belong exclusively in `src/cli/` (ARCH-01, eimerjs IPC boundary)
- No imports from `src/cli/` — enforced via code review rule; RESEARCH.md Pitfall 3
- Phase 1 exports a skeleton `AccountConfig` interface and stub `ping()` — enough for Phase 2 (config) to extend naturally
- All relative imports within core must use `.js` extension (e.g., `import './utils.js'`) — RESEARCH.md Pitfall 1

---

### `src/cli/index.ts` (utility, CLI entry point, request-response)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Architecture Patterns, Standard Stack (commander)

**Core pattern:**
```typescript
#!/usr/bin/env node
// src/cli/index.ts — ARCH-02: thin wrapper over core only
// No business logic here — all logic lives in src/core/

import { Command } from 'commander'

const program = new Command()

program
  .name('backmail')
  .description('Mirror IMAP mailboxes to git')
  .version('0.1.0')

// Phase 1: no subcommands yet — skeleton only
// Phase 2+ will add: sync, log, checkout, ls, view, restore

program.parse(process.argv)
```

**Key decisions:**
- `#!/usr/bin/env node` shebang — required for `bin` entry point in package.json
- Only imports from `src/core/` and Node.js built-ins / npm packages (ARCH-02)
- `commander` for argument parsing — keeps option parsing structured and typed (RESEARCH.md Don't Hand-Roll)
- Phase 1 is a skeleton: registers the program name/version, no subcommands yet
- `process.exit()` and `console` are acceptable here (this IS the CLI layer)

---

### `tests/unit/core-api-boundary.test.ts` (test, request-response)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Validation Architecture (ARCH-01 boundary check)

**Core pattern:**
```typescript
import { describe, it, expect } from 'vitest'
import * as core from '../../src/core/index.js'

describe('ARCH-01: core module API boundary', () => {
  it('exports AccountConfig type', () => {
    // Type-level check: if AccountConfig is not exported, this file won't compile
    const config: core.AccountConfig = {
      host: 'localhost',
      port: 143,
      username: 'testuser',
      tls: false,
      repoPath: '/tmp/test-repo',
    }
    expect(config.host).toBe('localhost')
  })

  it('exports ping function', () => {
    expect(typeof core.ping).toBe('function')
  })
})
```

**Key decisions:**
- Import uses `.js` extension — required for `nodenext` module resolution (RESEARCH.md Pitfall 1)
- Tests the exports shape of `src/core/index.ts`, not implementation detail
- Run by `npm test` (unit suite) — no Docker dependency

---

### `tests/unit/cli-boundary.test.ts` (test, request-response)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Validation Architecture (ARCH-02 boundary check)

**Core pattern:**
```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

describe('ARCH-02: cli module boundary', () => {
  it('src/cli/index.ts does not import from src/core/../cli/', () => {
    // Read the CLI source and check for forbidden cross-boundary imports
    const cliSource = readFileSync(
      resolve(__dirname, '../../src/cli/index.ts'),
      'utf-8'
    )
    // CLI may import from core but must not have relative imports going outside src/cli/
    // that resolve to non-core paths
    expect(cliSource).not.toMatch(/from ['"]\.\.\/cli\//);
  })

  it('src/core/index.ts does not import from src/cli/', () => {
    const coreSource = readFileSync(
      resolve(__dirname, '../../src/core/index.ts'),
      'utf-8'
    )
    expect(coreSource).not.toMatch(/from ['"]\.\.\/cli\//)
    expect(coreSource).not.toMatch(/from ['"].*\/cli\//)
  })
})
```

**Key decisions:**
- Static source analysis (not import tracing) — simple, fast, no runtime dependency graph needed for Phase 1
- Tests ARCH-02 constraint: core must not import from cli
- Run by `npm test` (unit suite) — no Docker dependency

---

### `tests/unit/fixtures.test.ts` (test, file-I/O)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Validation Architecture (TEST-03 fixture validation)

**Core pattern:**
```typescript
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const FIXTURES_DIR = resolve(__dirname, '../../tests/fixtures')

describe('TEST-03: synthetic .eml fixtures', () => {
  const emlFiles = readdirSync(FIXTURES_DIR).filter(f => extname(f) === '.eml')

  it('at least one .eml fixture exists', () => {
    expect(emlFiles.length).toBeGreaterThan(0)
  })

  emlFiles.forEach(file => {
    it(`${file} is valid RFC 2822 (has required headers)`, () => {
      const content = readFileSync(resolve(FIXTURES_DIR, file), 'utf-8')
      expect(content).toMatch(/^From:/m)
      expect(content).toMatch(/^To:/m)
      expect(content).toMatch(/^Subject:/m)
      expect(content).toMatch(/^Date:/m)
      expect(content).toMatch(/^Message-ID:/m)
    })

    it(`${file} contains no real email addresses`, () => {
      const content = readFileSync(resolve(FIXTURES_DIR, file), 'utf-8')
      // Fixtures must use example.com domain (RFC 2606)
      const emailAddresses = content.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []
      emailAddresses.forEach(addr => {
        expect(addr).toMatch(/@example\.com$/)
      })
    })
  })
})
```

**Key decisions:**
- Validates structure of all `.eml` files dynamically — new fixtures are auto-included
- Enforces RFC 2606 `@example.com` domain — no real email addresses in test fixtures (TEST-03 privacy requirement)
- Checks minimum required RFC 2822 headers

---

### `tests/integration/imap-connect.test.ts` (test, request-response)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Validation Architecture (TEST-01 smoke connect)

**Core pattern:**
```typescript
import { describe, it, expect } from 'vitest'
import * as net from 'node:net'

const IMAP_HOST = process.env.IMAP_HOST ?? 'localhost'
const IMAP_PORT = Number(process.env.IMAP_PORT ?? '143')

describe('TEST-01: IMAP container connectivity', () => {
  it('TCP connection to IMAP port succeeds', () => {
    return new Promise<void>((resolve, reject) => {
      const socket = net.connect(IMAP_PORT, IMAP_HOST, () => {
        socket.destroy()
        resolve()
      })
      socket.on('error', reject)
    })
  })

  it('IMAP greeting contains Dovecot ready banner', () => {
    return new Promise<void>((resolve, reject) => {
      const socket = net.connect(IMAP_PORT, IMAP_HOST, () => {
        socket.once('data', (data) => {
          const banner = data.toString()
          expect(banner).toMatch(/\* OK/)
          socket.destroy()
          resolve()
        })
      })
      socket.on('error', reject)
    })
  })
})
```

**Key decisions:**
- Uses raw `node:net` TCP — no imapflow dependency in Phase 1 (imapflow is a Phase 2+ dependency)
- Checks banner for `* OK` — standard IMAP greeting prefix (RFC 3501)
- `IMAP_HOST`/`IMAP_PORT` env vars allow CI override without code change
- Only run via `scripts/test-integration.sh` (uses `vitest.integration.config.ts`)

---

### `tests/fixtures/fixture-001.eml` (test data, file-I/O)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Pattern 8 (Synthetic .eml fixture)

**Core pattern:**
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

**Key decisions:**
- All addresses use `@example.com` — RFC 2606 reserved domain, no privacy risk (TEST-03)
- `Message-ID` uses `<fixture-NNN@example.com>` — deterministic for test assertions
- Minimal RFC 2822 headers: From, To, Subject, Date, Message-ID, MIME-Version, Content-Type
- Plain text body — no HTML, no attachments in Phase 1 fixtures

---

### `tests/fixtures/fixture-002.eml` (test data, file-I/O)

**Analog:** none — greenfield

**Pattern source:** RESEARCH.md Pattern 8 (same as fixture-001)

**Core pattern:** Same structure as `fixture-001.eml` with different Subject, Date, and Message-ID:
```
From: sender@example.com
To: inbox@example.com
Subject: Test fixture 002
Date: Tue, 02 Jan 2024 09:30:00 +0000
Message-ID: <fixture-002@example.com>
MIME-Version: 1.0
Content-Type: text/plain

Second synthetic test fixture. Used to validate multi-message test scenarios.
```

**Key decisions:**
- A second fixture exercises multi-message test scenarios in Phase 3+ (sync delta counting)
- Different sender/recipient pattern to cover `FROM != TO` assertions
- Phase 1 only needs two fixtures; more added as needed in later phases

---

## Shared Patterns

### ESM Import Extension Convention
**Apply to:** All `.ts` files in `src/` and `tests/`

With `moduleResolution: "nodenext"`, all relative TypeScript imports must use `.js` extension:
```typescript
// Correct — TypeScript finds the .ts file, emits .js at build time
import { someUtil } from './utils.js'

// Wrong — fails at Node.js runtime with ERR_MODULE_NOT_FOUND
import { someUtil } from './utils'
```
Source: RESEARCH.md Pitfall 1, typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options

---

### Node.js ESM `__dirname` Replacement
**Apply to:** All test files and any `src/` file needing `__dirname`

ES modules do not have `__dirname`. Use:
```typescript
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
```

---

### `node:` Protocol for Built-in Imports
**Apply to:** All `.ts` files

Always prefix Node.js built-in imports with `node:` for clarity and to avoid shadowing issues:
```typescript
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as net from 'node:net'
```

---

### Core/CLI Boundary Enforcement
**Apply to:** Any new file added to `src/core/` or `src/cli/`

Rule: `src/core/` files must never import from `src/cli/`.
Rule: `src/core/` files must never call `process.exit()`, `console.log()`, or use readline/interactive I/O.
Rule: `src/cli/` files should only import from `src/core/`, `node:*` built-ins, and npm packages.

Source: REQUIREMENTS.md ARCH-01, ARCH-02; RESEARCH.md Pitfall 3

---

## No Analog Found

All 14 files have no codebase analog — this is a greenfield project.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `package.json` | config | — | First file in project |
| `tsconfig.json` | config | — | First file in project |
| `vitest.config.ts` | config | — | First file in project |
| `vitest.integration.config.ts` | config | — | First file in project |
| `docker-compose.yml` | config | — | First file in project |
| `scripts/test-integration.sh` | utility | event-driven | First file in project |
| `src/core/index.ts` | service | request-response | First file in project |
| `src/cli/index.ts` | utility | request-response | First file in project |
| `tests/unit/core-api-boundary.test.ts` | test | request-response | First file in project |
| `tests/unit/cli-boundary.test.ts` | test | request-response | First file in project |
| `tests/unit/fixtures.test.ts` | test | file-I/O | First file in project |
| `tests/integration/imap-connect.test.ts` | test | request-response | First file in project |
| `tests/fixtures/fixture-001.eml` | test data | file-I/O | First file in project |
| `tests/fixtures/fixture-002.eml` | test data | file-I/O | First file in project |

All patterns are sourced from RESEARCH.md which cites official documentation (typescriptlang.org, vitest-dev/vitest, gmitirol/minimal-imap, npm registry).

---

## Metadata

**Analog search scope:** Entire `/home/jan/dev/backmail/` repository
**Files scanned:** 2 (LICENSE, README.md) — no TypeScript/JavaScript source files exist
**Pattern extraction date:** 2026-04-20
**Pattern sources:** RESEARCH.md (official docs, npm registry, Docker Hub — all verified 2026-04-20)
