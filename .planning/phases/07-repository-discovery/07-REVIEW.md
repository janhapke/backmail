---
phase: 07-repository-discovery
reviewed: 2026-04-29T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/core/discovery.ts
  - tests/unit/discovery.test.ts
  - src/core/index.ts
  - src/cli/index.ts
  - src/core/sync.ts
  - src/core/restore.ts
  - src/core/browse.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-04-29
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed 7 files covering the new repository discovery feature (`src/core/discovery.ts`) and related modules touched by Phase 7 integration (`src/core/index.ts`, `src/cli/index.ts`, `src/core/sync.ts`, `src/core/restore.ts`, `src/core/browse.ts`, `tests/unit/discovery.test.ts`).

The new `findRepository` function in `discovery.ts` is correct and clean — the walk-up logic, root termination, and nearest-repository-first semantics are all sound. The test suite covers the key cases.

Four warnings were found across the broader codebase touched in this phase: an unvalidated `parseInt` that produces `NaN` in the CLI log command, console.log calls inside a core module that violate ARCH-01, a lossy folder-name reversal heuristic in the restore legacy path, and incorrect folder names surfaced by `listFolders`. Three info-level items cover a redundant test, a missing `--format` validation, and inconsistent config helper usage in the CLI.

## Warnings

### WR-01: `parseInt` with no NaN guard passes `NaN` to `getLog`

**File:** `src/cli/index.ts:134`
**Issue:** When `--limit` is provided but is not `"unlimited"` and is not a valid integer string (e.g. `backmail log --limit foo`), `parseInt('foo', 10)` returns `NaN`. `NaN` is passed as-is to `getLog(archivePath, NaN)`. Inside `getLog`, the branch `limit === 'unlimited'` is false, so `{ maxCount: NaN }` is passed to `simple-git`, which silently treats it as `0` or `undefined`, returning unexpected results or no commits at all — with no error reported to the user.

**Fix:**
```typescript
const rawLimit = opts.limit === 'unlimited' ? 'unlimited' : parseInt(opts.limit, 10)
if (rawLimit !== 'unlimited' && isNaN(rawLimit)) {
  console.error(`Error: --limit must be a positive integer or "unlimited", got: ${opts.limit}`)
  process.exit(1)
}
const commits = await getLog(archivePath, rawLimit)
```

---

### WR-02: `console.log` / `console.error` calls inside core module violate ARCH-01

**File:** `src/core/restore.ts:260,280,294,296,302`
**Issue:** The `restoreAccount` function calls `console.log` and `console.error` directly for verbose per-message output. This violates the ARCH-01 rule documented at the top of `restore.ts` itself ("no console.*"). The core module should never write to stdout/stderr — output is the CLI layer's responsibility. The inline comment on line 261 labels this an "ARCH-01 exception" but no such exception is defined in the architecture.

As a practical consequence, any library consumer of `src/core/index.ts` who calls `restoreAccount` will get surprise console output they cannot suppress, and testing verbose output requires capturing stdout rather than inspecting return values.

**Fix:** Add a `onProgress` callback to `RestoreOptions` (or use a simple logger interface) and replace all direct console calls with it. The CLI layer passes a callback that writes to stdout; tests pass a no-op or a spy.

```typescript
// In RestoreOptions
export interface RestoreOptions {
  skipDuplicates: boolean
  dryRun: boolean
  verbose: boolean
  onProgress?: (line: string) => void  // NEW
}

// In restoreAccount — replace every console.log with:
options.onProgress?.(`Skipped: ${messageId}`)
options.onProgress?.(`Uploaded: ${messageId}`)
options.onProgress?.(`Error: ${messageId}`)
```

---

### WR-03: Legacy folder-name reversal produces wrong paths (restore.ts)

**File:** `src/core/restore.ts:211`
**Issue:** The legacy fallback that reconstructs a folder's IMAP path from its sanitized filename uses `sanitizedName.replace(/_/g, '/')`. This is incorrect: any folder name that legitimately contains an underscore (e.g. `Sent_Items`, `My_Archive`) will be reconstructed as `Sent/Items` or `My/Archive` — producing a wrong IMAP path. This causes folders to be created under incorrect names on the target server and messages to be appended to the wrong folder.

The current path (lines 205-213) is only taken for "legacy state files" that have no `folderPath` field. New files written by `syncFolder` always include `folderPath`, so this code path is rarely hit in practice — but it is silently wrong when it is.

**Fix:** Either remove the legacy fallback entirely and emit an error for state files missing `folderPath`, or use an explicit stored mapping. Do not attempt to reverse a lossy sanitization:

```typescript
// Instead of the lossy reversal:
const sanitizedName = folderFilename.replace(/\.json$/, '')
folderPaths.push(sanitizedName.replace(/_/g, '/'))  // WRONG

// Do this:
// Option A: skip with warning
console.warn(`Skipping legacy state file with no folderPath: ${folderFilename}`)
// (or surface via result.errors++)
continue

// Option B: store a side-channel mapping during sync (add to FolderState schema)
// FolderState already has folderPath — new syncs are fine; only legacy syncs hit this
```

---

### WR-04: `listFolders` returns sanitized filenames, not original IMAP folder names

**File:** `src/core/browse.ts:229-242`
**Issue:** `listFolders` reads filenames from the `folders/` directory and strips `.json`, returning the sanitized filename (e.g. `INBOX_Sent_Items`) rather than the original IMAP path (e.g. `INBOX/Sent Items`). The CLI prints these directly to stdout (cli/index.ts:174-177). Users see filesystem-mangled names, not the actual folder names they know from their mail client.

The `FolderState` JSON stored by `syncFolder` already includes a `folderPath` field (the original IMAP path). `listFolders` could read each JSON file to return the authentic path instead of inferring it from the sanitized filename.

**Fix:**
```typescript
export async function listFolders(repoPath: string): Promise<string[]> {
  const foldersPath = path.join(repoPath, 'folders')
  try {
    const files = await fs.readdir(foldersPath)
    const jsonFiles = files.filter((f) => f.endsWith('.json'))
    const names: string[] = []
    for (const f of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(foldersPath, f), 'utf-8')
        const state = JSON.parse(raw) as { folderPath?: string }
        names.push(state.folderPath ?? f.slice(0, -5))
      } catch {
        names.push(f.slice(0, -5)) // fallback to sanitized name on parse error
      }
    }
    return names.sort()
  } catch {
    return []
  }
}
```

---

## Info

### IN-01: Redundant test case in `discovery.test.ts`

**File:** `tests/unit/discovery.test.ts:44-48`
**Issue:** The test "returns null when walking all the way to filesystem root" (lines 44-48) duplicates the assertion of "returns null when .backmail/ not found anywhere in walk" (lines 24-27). Both start `findRepository` from `tmpDir` with no `.backmail/` present and expect `null`. The only distinction is the additional `not.toThrow()` check, which is already implied by the second `expect` succeeding. Consider either merging the two tests or renaming/differentiating to test a distinct scenario (e.g. starting from a directory that is itself the filesystem root).

**Fix:** Merge into a single test or, for a more meaningful distinction, start from `path.parse(os.tmpdir()).root` directly to explicitly cover the root-directory edge case.

---

### IN-02: No validation of `--format` option before passing to `viewMessage`

**File:** `src/cli/index.ts:200`
**Issue:** The `--format` option accepts any string and casts it directly to `'eml' | 'plaintext' | 'json'` via `as`. An invalid value like `--format xml` reaches `viewMessage`, which reads the file from disk and parses it before throwing `Error: Unknown format: xml` at the very end. The error message does not hint at valid values.

**Fix:** Validate the format at the CLI layer before doing any I/O:
```typescript
const validFormats = ['eml', 'plaintext', 'json'] as const
type Format = typeof validFormats[number]
if (!validFormats.includes(opts.format as Format)) {
  console.error(`Error: unknown format "${opts.format}". Valid formats: eml, plaintext, json`)
  process.exit(1)
}
const format = opts.format as Format
```

---

### IN-03: Inconsistent config loading pattern in CLI commands

**File:** `src/cli/index.ts:38-46,80-84`
**Issue:** The `getConfig()` helper (lines 38-46) calls `getRepoRoot()` internally and then `loadRepositoryConfig(repoRoot)`. However, most commands (`sync`, `restore`, `log`, `checkout`, `ls`, `view`) call `getRepoRoot()` and `loadRepositoryConfig()` individually rather than using `getConfig()`. Only the `accounts` command (line 120) uses `getConfig()`. This inconsistency means there are two different code paths for the same operation, and changes to error handling in one path are not reflected in the other.

**Fix:** Either use `getConfig()` consistently in all commands that need both root and config, or remove `getConfig()` and inline the two calls everywhere. The current inconsistency does not introduce a bug but is a maintenance hazard.

---

_Reviewed: 2026-04-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
