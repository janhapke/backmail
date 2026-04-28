# Phase 6: Credential Infrastructure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-29
**Phase:** 06-credential-infrastructure
**Areas discussed:** archive/ path convention, env: passwordRef format, old config code lifecycle

---

## archive/ path convention

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcoded convention | Always path.join(repoRoot, 'archive'). Location is the contract. | ✓ |
| Configurable in config.json | Optional archivePath field. More flexible, more error-prone. | |

**User's choice:** Hardcoded convention
**Notes:** Like git's .git/ — the location is the contract, nothing to misconfigure.

---

## env: passwordRef format

| Option | Description | Selected |
|--------|-------------|----------|
| Both keyring: and env: now | Parser handles both schemes. env: is the CI fallback. | ✓ |
| keyring: only, env: deferred | Minimal Phase 6. BACKMAIL_PASSWORD still works as separate fallback. | |

**User's choice:** Both now
**Notes:** Parser complexity is the same either way; env: makes the tool scriptable from day one.

---

## Old config code lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Remove in this phase | Phase 6 builds the replacement. Dead code removed immediately. | ✓ |
| Keep in parallel | Leave intact until Phase 8 command migration. | |

**User's choice:** Remove in this phase
**Notes:** Keeping dead code alongside new code creates confusion about which path is canonical.

---

## Claude's Discretion

- Exact Zod schema internals and validation error messages
- Async/sync keyring handling details
- Test structure and fixture approach
