---
phase: 06-credential-infrastructure
asvs_level: 1
audited_date: "2026-04-29"
threats_total: 6
threats_closed: 6
threats_open: 0
block_on: high
result: SECURED
---

# Phase 06 Security Audit

**Phase:** 06 — Credential Infrastructure
**ASVS Level:** 1
**Threats Closed:** 6/6
**Threats Open:** 0/6
**Result:** SECURED

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-06-01 | Tampering | mitigate | CLOSED | `src/core/config.ts:53` — `RepositoryConfigSchema.parse(parsed)` called unconditionally; ZodError propagates before any downstream use of config data |
| T-06-02 | Information Disclosure | accept | CLOSED | No `console.*` calls in `src/core/config.ts` (verified by grep); ARCH-01 header comment at line 2 declares the constraint; only the comment text matches, no runtime logging |
| T-06-03 | Information Disclosure | accept | CLOSED | `BACKMAIL_PASSWORD` is a deliberate CI opt-in; documented in accepted risks below; no mitigation applied per plan disposition |
| T-06-04 | Tampering | mitigate | CLOSED | `src/core/config.ts:60` — `/;/g` → `&` replacement applied before `URLSearchParams` construction; `src/core/config.ts:63–66` — strict `!service \|\| !account` guard throws before any empty-string lookup can occur |
| T-06-05 | Denial of Service | accept | CLOSED | `src/core/config.ts:40` — ENOENT produces friendly error with actionable message; no `process.exit` in file; no retry loop; documented in accepted risks below |
| T-06-06 | Elevation of Privilege | mitigate | CLOSED | `src/core/config.ts:76–79` — unrecognised scheme extracted via `split(':')[0]` and thrown immediately; execution does not reach any credential lookup path |

## Accepted Risks Log

| Threat ID | Category | Rationale |
|-----------|----------|-----------|
| T-06-02 | Information Disclosure | Credential is read from OS keyring and returned to the caller. No logging of resolved passwords occurs (ARCH-01 forbids `console.*` in core). The caller (CLI layer) is responsible for deciding how errors are surfaced. Risk accepted by design. |
| T-06-03 | Information Disclosure | `BACKMAIL_PASSWORD` is a documented, deliberate opt-in for CI/CD environments. The user explicitly sets this variable; the application does not write it or expose it beyond reading. No further mitigation is required beyond clear documentation. Risk accepted by design. |
| T-06-05 | Denial of Service | A missing `.backmail/config.json` produces a descriptive error message pointing to `backmail init`. There is no infinite retry, no process crash loop, and no `process.exit` call in core. The error propagates to the CLI layer for display. Risk accepted — this is expected first-run behaviour. |

## Unregistered Threat Flags

None. Neither `06-01-SUMMARY.md` nor `06-02-SUMMARY.md` contains a `## Threat Flags` section. Both executor reports state "no new threat surface introduced beyond what the plan's threat model covers."

## Verification Commands Used

```bash
# T-06-01: Zod schema parse
grep -n "RepositoryConfigSchema.parse" src/core/config.ts
# → config.ts:53

# T-06-04: semicolon replacement + strict key check
grep -n "replace(/;/g" src/core/config.ts
grep -n "!service || !account" src/core/config.ts
# → config.ts:60, config.ts:63

# T-06-06: unknown scheme throw
grep -n "Unsupported passwordRef scheme" src/core/config.ts
# → config.ts:78

# T-06-02/T-06-05 ARCH-01 compliance
grep -n "console\.|process\.exit" src/core/config.ts
# → no matches (only comment text on line 2)
```
