# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 01-foundation
**Areas discussed:** Module system, Build tooling, Test runner, Docker test orchestration

---

## Module system

| Option | Description | Selected |
|--------|-------------|----------|
| ESM (`"type": "module"`) | Native ES modules, future-proof, clean import/export, some tsconfig setup | ✓ |
| CommonJS | Traditional Node.js, `require()`/`module.exports`, broadest compat | |

**User's choice:** ESM  
**Notes:** No additional clarification needed.

---

## Build tooling

| Option | Description | Selected |
|--------|-------------|----------|
| tsx (dev) + tsc (prod) | Run .ts directly in dev via tsx, compile with tsc for dist | ✓ |
| tsc only | Compile everything with tsc, including dev | |
| esbuild (dev + prod) | Fast bundler producing single output file | |

**User's choice:** tsx for dev, tsc for production  
**Notes:** No additional clarification needed.

---

## Test runner

| Option | Description | Selected |
|--------|-------------|----------|
| Vitest | Native ESM, fast, Jest-compatible API, first-class TypeScript | ✓ |
| Jest + ts-jest | Mature but needs transform config for ESM, more boilerplate | |

**User's choice:** Vitest  
**Notes:** No additional clarification needed.

---

## Docker test orchestration

| Option | Description | Selected |
|--------|-------------|----------|
| testcontainers-node | Programmatic container lifecycle in Vitest setup/teardown | |
| docker-compose + shell scripts | Shell script wraps `docker-compose up -d` → test → `docker-compose down` | ✓ |

**User's choice:** docker-compose + shell scripts  
**Notes:** No additional clarification needed.

---

## Claude's Discretion

- tsconfig strictness, exact folder layout within src/core/ and src/cli/
- Synthetic .eml fixture design
- Docker Compose service configuration details
- vitest.config.ts structure

## Deferred Ideas

None.
