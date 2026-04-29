---
phase: 08-command-migration
reviewed: 2026-04-29T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/cli/index.ts
  - src/core/browse.ts
  - src/core/index.ts
  - tests/unit/browse.test.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-04-29
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the CLI entry point, the browse core module, the core public API barrel, and the browse unit tests produced during phase 08 (command migration).

The architecture is sound: the CLI layer stays thin, all business logic lives in `src/core/`, and the browse module correctly sanitizes message IDs before filesystem lookups. The test suite covers the main success and failure paths well.

Four warnings were found. The most impactful are: `parseInt` without NaN validation in the `log` command, five catch blocks using an unsafe `as Error` cast instead of the already-defined helper, and a date-boundary bug in `resolveDate` that can silently miss midnight commits. A free-form `--format` string is accepted and cast without validation at the CLI layer.

Three informational items cover dead utility code, a leftover `ping` stub, and a non-null assertion that could be expressed more defensively.

---

## Warnings

### WR-01: `parseInt` result passed to core without NaN guard

**File:** `src/cli/index.ts:112`

**Issue:** When the user passes a non-numeric value to `--limit` (e.g., `--limit abc`), `parseInt('abc', 10)` returns `NaN`. `NaN` is then passed directly to `getLog()` as the `limit` argument, which forwards it to simple-git as `{ maxCount: NaN }`. The resulting git behavior is implementation-defined and could return all commits, zero commits, or throw an opaque error — none of which produce a useful user-facing message.

**Fix:**
```typescript
const parsed = parseInt(opts.limit, 10)
if (isNaN(parsed) || parsed <= 0) {
  console.error('Error: --limit must be a positive integer or "unlimited"')
  process.exit(1)
}
const limitValue: number | 'unlimited' = opts.limit === 'unlimited' ? 'unlimited' : parsed
```

---

### WR-02: Unsafe `as Error` cast in five catch blocks

**File:** `src/cli/index.ts:98, 118, 134, 161, 183`

**Issue:** Every catch block except `restore` uses `(err as Error).message` directly. If anything other than an `Error` instance is thrown (a string, a plain object, `null`, etc.), `.message` resolves to `undefined` and `console.error` prints the literal string `"undefined"`. The file already defines `getErrorMessage(err)` at line 40 for exactly this purpose, but it is only called in the `restore` command.

**Fix:** Replace all five occurrences:
```typescript
// Instead of:
console.error((err as Error).message)

// Use the existing helper:
console.error(getErrorMessage(err))
```

Affected lines: 98 (`sync`), 118 (`log`), 134 (`checkout`), 161 (`ls`), 183 (`view`).

Note: the `sync` command also calls `syncAccount` which internally constructs IMAP connections. If those errors embed connection URLs, the `sanitizeErrorMessage` helper should also be applied to `sync` errors, not only `restore`.

---

### WR-03: `--format` value is not validated before being cast and used

**File:** `src/cli/index.ts:175`

**Issue:** The `view` command accepts `--format <fmt>` as a free string and immediately casts it with `as 'eml' | 'plaintext' | 'json'` without any runtime validation. An unknown value like `--format xml` passes through the cast, reaches `viewMessage`, and triggers the `throw new Error(\`Unknown format: ${format}\`)` at `src/core/browse.ts:339` after parsing the full EML file. The error message also echoes the user-supplied value unsanitized.

**Fix:** Add a validation guard in the CLI action before calling core:
```typescript
const VALID_FORMATS = ['eml', 'plaintext', 'json'] as const
if (!VALID_FORMATS.includes(opts.format as typeof VALID_FORMATS[number])) {
  console.error(`Error: --format must be one of: eml, plaintext, json`)
  process.exit(1)
}
const format = opts.format as 'eml' | 'plaintext' | 'json'
```

---

### WR-04: Date boundary bug in `resolveDate` — midnight commits can be missed

**File:** `src/core/browse.ts:40-42`

**Issue:** `resolveDate` queries git log with `--after: "${dateStr} 00:00:00"` and `--before: "${dateStr} 23:59:59"`. Git's `--after` filter is exclusive at the boundary: a commit with an author timestamp of exactly `YYYY-MM-DD 00:00:00` (midnight) is excluded. Additionally, commits at `23:59:59` are excluded by the exclusive `--before`. This means `checkoutCommit` can silently return "No sync commit found for date YYYY-MM-DD" even when a valid sync commit exists for that day if it was committed at midnight or in the final second.

**Fix:** Use a half-open interval: `--after` set to the end of the prior day, and `--before` set to the start of the next day:
```typescript
const git = simpleGit(repoPath)
const log = await git.log({
  '--after': `${dateStr}T00:00:00-1second`,  // git also accepts date math
  '--before': `${nextDay}T00:00:00`,
  '--max-count': '1',
})
```

A simpler approach that avoids date arithmetic entirely is to use `--since` and `--until` with inclusive day-granularity:
```typescript
const log = await git.log({
  '--since': dateStr,
  '--until': dateStr,
  '--max-count': '1',
})
```
`--since`/`--until` in git interpret a plain date (`YYYY-MM-DD`) as inclusive for that entire calendar day.

---

## Info

### IN-01: `getErrorMessage` helper is defined but used in only one of six catch blocks

**File:** `src/cli/index.ts:40-44`

**Issue:** `getErrorMessage` at line 40 is defined to safely convert unknown thrown values to strings, but is only called once (in `restore` at line 242). The other five catch blocks bypass it and use an unsafe cast instead. This is both dead utility code in practice and an inconsistency that masks a correctness problem (see WR-02).

**Fix:** Apply `getErrorMessage` in all catch blocks (see WR-02 fix). Once applied consistently, the helper earns its keep.

---

### IN-02: `ping` stub still exported from public API barrel with no deprecation annotation

**File:** `src/core/index.ts:15-17`

**Issue:** The `ping` function is a Phase 1 scaffold that throws `'Not implemented'`. It is still exported from the public API barrel with no `@deprecated` annotation, no TODO marker, and no comment indicating whether it will be implemented or removed. Callers who import it and call it will receive a runtime error.

**Fix:** If `ping` is not planned for implementation, remove it from the export. If it is planned, annotate it:
```typescript
/** @deprecated Stub — not yet implemented. Will throw at runtime. */
export async function ping(_config: unknown): Promise<boolean> {
  throw new Error('Not implemented')
}
```

---

### IN-03: Non-null assertion on `log.latest` after total guard

**File:** `src/core/browse.ts:47`

**Issue:** `log.latest!.hash` uses a non-null assertion. The preceding `log.total === 0` guard makes this safe in practice, but the `!` operator suppresses TypeScript's null-safety checking. If the guard were ever refactored or removed, the assertion could cause a runtime crash.

**Fix:**
```typescript
const hash = log.latest?.hash
if (!hash) {
  throw new Error(`No sync commit found for date ${dateStr}`)
}
return hash
```

This replaces both the `total === 0` check and the non-null assertion with a single, safe pattern.

---

_Reviewed: 2026-04-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
