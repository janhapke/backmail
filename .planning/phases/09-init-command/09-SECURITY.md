---
phase: 9
slug: init-command
status: secured
threats_open: 0
asvs_level: 1
created: 2026-05-01
---

# Phase 9 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| test file → source file | Tests read source files via readFileSync; no untrusted input | source code (non-sensitive) |
| user input → CLI flags | host, port, username come from CLI flags or TTY prompts | user-supplied strings |
| --password flag → OS keyring | Plaintext password in process args (visible in `ps aux`) | IMAP password (sensitive) |
| CLI → initRepository() | targetDir resolved to absolute path before passing to core | filesystem path |
| initRepository() → filesystem | Writes to targetDir; no sanitization needed beyond path.resolve() in caller | config.json (passwordRef, not password) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-9-setup-01 | Information Disclosure | package.json | accept | @inquirer/prompts is a public package; no sensitive data in install | closed |
| T-9-02-01 | Tampering | initRepository targetDir | accept | path.resolve() called in CLI (cli/index.ts:274) before passing targetDir; already absolute in core | closed |
| T-9-02-02 | Information Disclosure | config.json file permissions | accept | passwordRef is a reference string, not the password itself; password stored in OS keyring | closed |
| T-9-02-03 | Denial of Service | non-destructive guard | mitigate | REPO-04: fs.existsSync check in both CLI (cli/index.ts:277) and core (init.ts:16) before any writes | closed |
| T-9-03-01 | Information Disclosure | --password flag in process args | accept | --password-ref preferred for CI; documented in --password-ref help text (cli/index.ts:264-265) | closed |
| T-9-03-02 | Tampering | path positional arg | mitigate | path.resolve(dirPath) at cli/index.ts:274 collapses ../ and makes path absolute | closed |
| T-9-03-03 | Information Disclosure | keyring write failure error message | mitigate | getErrorMessage(err) at cli/index.ts:355 — extracts only error message, not plaintext password | closed |
| T-9-03-04 | Denial of Service | non-TTY without flags | mitigate | Explicit console.error + process.exit(1) for each missing param when isTTY=false (cli/index.ts:291,313,322,334,347) | closed |
| T-9-03-05 | Elevation of Privilege | prompts in non-TTY | mitigate | isTTY = process.stdin.isTTY === true (cli/index.ts:283) checked before every inquirer prompt call | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-9-01 | T-9-setup-01 | @inquirer/prompts is a well-maintained public package with no sensitive data flow at install time | Jan Hapke | 2026-05-01 |
| AR-9-02 | T-9-02-01 | path.resolve() in CLI layer is sufficient; additional traversal checks in core add no practical security since the path is already absolute | Jan Hapke | 2026-05-01 |
| AR-9-03 | T-9-02-02 | config.json stores only a passwordRef string (e.g. `keyring:service=backmail;account=user`), never the plaintext password. File permission defaults (0o666 minus umask) are acceptable for a user-owned directory | Jan Hapke | 2026-05-01 |
| AR-9-04 | T-9-03-01 | --password flag visibility in `ps aux` is a known limitation of CLI password entry. --password-ref with env: or keyring: syntax is documented as the preferred CI approach. Accepted as residual risk for interactive developer use only | Jan Hapke | 2026-05-01 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-01 | 9 | 9 | 0 | gsd-secure-phase (automated) |
