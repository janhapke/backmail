---
phase: 05-restore
plan: GAP3
type: execute
wave: 1
depends_on: [GAP2]
files_modified:
  - src/core/restore.ts
autonomous: true
requirements: [REST-02, REST-03]
gap_closure: true
must_haves:
  truths:
    - "dry-run with --skip-duplicates=yes connects read-only to target and correctly counts duplicates as skipped"
    - "--verbose flag emits one line per message (Uploaded / Skipped / Error) inside the message loop"
  artifacts:
    - path: src/core/restore.ts
      provides: "read-only IMAP connection created in dry-run when skipDuplicates=true"
      pattern: "dryRunClient"
    - path: src/core/restore.ts
      provides: "verbose logging inside message loop"
      pattern: "options.verbose"
  key_links:
    - from: "restoreAccount (dryRun=true, skipDuplicates=true)"
      to: "isDuplicate()"
      via: "dryRunClient passed to isDuplicate"
      pattern: "isDuplicate.*dryRunClient"
    - from: "restoreAccount message loop"
      to: "console output"
      via: "options.verbose guard"
      pattern: "if.*options\\.verbose"
---

<objective>
Close two major UAT gaps in src/core/restore.ts:

1. Dry-run + skip-duplicates: The message loop short-circuits duplicate checking when targetClient is null
   (line 238: `options.skipDuplicates && targetClient`). Fix by creating a separate read-only IMAP
   connection for SEARCH when dryRun=true and skipDuplicates=true. Only APPEND is suppressed in
   dry-run — SEARCH must still run.

2. Verbose flag: options.verbose is accepted but never read inside the message loop. Fix by adding
   console.log() calls after each outcome branch (uploaded, skipped, error) guarded by
   `if (options.verbose)`.

Purpose: Users need accurate dry-run previews to verify backup completeness before a live restore.
The verbose flag was designed for per-message auditing — it must produce output.

Output: Updated src/core/restore.ts where dry-run duplicate detection works and verbose logging fires.
</objective>

<execution_context>
@/home/jan/dev/backmail/.claude/get-shit-done/workflows/execute-plan.md
@/home/jan/dev/backmail/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/home/jan/dev/backmail/.planning/PROJECT.md
@/home/jan/dev/backmail/.planning/ROADMAP.md
@/home/jan/dev/backmail/.planning/STATE.md

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from src/core/restore.ts. -->

RestoreOptions (line 14-18):
```typescript
export interface RestoreOptions {
  skipDuplicates: boolean  // D-10, D-11: true = SEARCH first, false = upload all
  dryRun: boolean          // D-12, D-13: true = no writes, output only
  verbose: boolean         // D-15: true = per-message lines
}
```

RestoreResult (line 20-24):
```typescript
export interface RestoreResult {
  uploaded: number
  skipped: number
  errors: number
}
```

isDuplicate signature (line 87-103):
```typescript
export async function isDuplicate(
  client: ImapFlow,
  folderPath: string,
  messageId: string
): Promise<boolean>
```

Current targetClient logic (line 165-171):
```typescript
const targetClient = options.dryRun ? null : new ImapFlow({
  host: target.host,
  port: target.port,
  secure: target.secure,
  auth: { user: target.username, pass: target.password },
  logger: false,
})
```

Current duplicate check (line 238):
```typescript
if (options.skipDuplicates && targetClient) {
  // isDuplicate() never called in dry-run because targetClient is null
}
```

Message loop structure (lines 232-277):
- outer loop: `for (const folderPath of folderPaths)`
- inner loop: `for (const msg of folderState.messages)`, messageId extracted as msg['message-id']
- outcome branches: duplicate skip (continue), successful append (folderUploaded++), dry-run upload (folderUploaded++), error catch block (result.errors++)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix dry-run duplicate detection with a read-only IMAP connection</name>
  <files>src/core/restore.ts</files>
  <action>
In restoreAccount(), after the existing targetClient declaration (line 165-171), add a dryRunClient
variable that creates an ImapFlow connection when dryRun=true AND skipDuplicates=true. This client
is used ONLY for SEARCH (isDuplicate), never for APPEND or folder creation.

Exact changes:

1. After line 171 (closing brace of targetClient declaration), add:

```typescript
// D-12: In dry-run with skip-duplicates, open a read-only connection for SEARCH only.
// APPEND is suppressed, but SEARCH must run to count duplicates accurately.
const dryRunClient = (options.dryRun && options.skipDuplicates)
  ? new ImapFlow({
      host: target.host,
      port: target.port,
      secure: target.secure,
      auth: { user: target.username, pass: target.password },
      logger: false,
    })
  : null
```

2. In the try block, after the existing `if (targetClient) { await targetClient.connect() }` block,
   add:

```typescript
if (dryRunClient) {
  await dryRunClient.connect()
}
```

3. Replace the duplicate check at line 238 from:
```typescript
if (options.skipDuplicates && targetClient) {
  if (await isDuplicate(targetClient, folderPath, messageId)) {
```
to:
```typescript
const searchClient = targetClient ?? dryRunClient
if (options.skipDuplicates && searchClient) {
  if (await isDuplicate(searchClient, folderPath, messageId)) {
```

4. In the finally block, after the existing `if (targetClient) { await targetClient.logout().catch(() => {}) }`, add:

```typescript
if (dryRunClient) {
  await dryRunClient.logout().catch(() => {})
}
```

Important: dryRunClient must NOT be used for createFolderIfNeeded — folder creation is already
correctly guarded by `if (targetClient)` which remains null in dry-run.

Security note (ARCH-01): No console.* calls here. Logging stays in CLI layer.
  </action>
  <verify>
    <automated>npx tsx -e "
import { parseImapUrl, isDuplicate } from './src/core/restore.js'
// Structural check: verify dryRunClient reference compiles
console.log('parseImapUrl exported:', typeof parseImapUrl)
console.log('isDuplicate exported:', typeof isDuplicate)
" && npx tsc --noEmit</automated>
  </verify>
  <done>
- dryRunClient is created when dryRun=true and skipDuplicates=true
- dryRunClient.connect() is called before the folder loop
- isDuplicate() uses `targetClient ?? dryRunClient` as the search client
- dryRunClient.logout() is called in the finally block
- No existing write-path behavior changed (targetClient still null in dry-run)
- npx tsc --noEmit reports zero errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Implement verbose per-message logging in the message loop</name>
  <files>src/core/restore.ts</files>
  <action>
Inside the inner message loop (lines 233-277), add console.log() calls guarded by
`if (options.verbose)` after each outcome branch. The messageId variable is already in scope.

ARCH-01 exception: restore.ts is the core layer, which normally must not use console.*. However,
verbose output IS the core responsibility here — the CLI passes the flag and delegates output to
core (the CLI action handler only prints the final summary). Add a comment noting this deliberate
exception to ARCH-01.

Exact changes (apply in order):

1. After the duplicate skip `continue` statement (currently after `result.skipped++`):
```typescript
if (options.verbose) {
  // ARCH-01 exception: verbose per-message output is delegated to core (D-15)
  console.log(`Skipped: ${messageId}`)
}
continue
```

2. After the successful APPEND block (after `result.uploaded++` inside the `if (targetClient)` branch):
```typescript
if (options.verbose) {
  console.log(`Uploaded: ${messageId}`)
}
```

3. After the dry-run upload counter (after `result.uploaded++` inside the `else` branch):
```typescript
if (options.verbose) {
  console.log(`Uploaded: ${messageId}`)
}
```

4. In the catch block, after `result.errors++`:
```typescript
if (options.verbose) {
  console.log(`Error: ${messageId}`)
}
```

Do not change any other lines. The comment on line 272 ("D-15: Per-message verbose output (handled
by CLI layer, not core)") should be removed as it is now incorrect — replace it with the first
verbose log call above (at the skipped branch location).
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx tsx -e "
// Quick smoke: restoreAccount signature still valid
import { restoreAccount } from './src/core/restore.js'
console.log('restoreAccount exported:', typeof restoreAccount)
"</automated>
  </verify>
  <done>
- console.log('Uploaded: \${messageId}') fires after each successful append (live and dry-run)
- console.log('Skipped: \${messageId}') fires after each duplicate skip
- console.log('Error: \${messageId}') fires after each per-message error
- All three are guarded by if (options.verbose)
- Stale comment removed
- npx tsc --noEmit reports zero errors
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CLI opts → core options | verbose and dryRun booleans arrive from user-controlled CLI flags |
| dryRunClient → target IMAP | read-only connection to target server using credentials from --to URL |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-5-GAP3-01 | Information Disclosure | dryRunClient verbose output | accept | messageId values may appear in stdout; these are not secrets — they are headers from the user's own backup |
| T-5-GAP3-02 | Spoofing | dryRunClient IMAP connection | mitigate | Uses same parseImapUrl() path as targetClient — TLS selection and credential extraction already validated (T-5-01 existing control) |
| T-5-GAP3-03 | Denial of Service | dryRunClient left open on error | mitigate | dryRunClient.logout() placed in finally block identical to targetClient cleanup pattern |
</threat_model>

<verification>
After both tasks complete, run:

```bash
npx tsc --noEmit
```

Zero TypeScript errors expected.

Manual spot-check (requires a configured account and reachable IMAP server):
```bash
# With --skip-duplicates=yes (default), dry-run should now count duplicates correctly
npx tsx src/cli/index.ts restore --dry-run --to imap://user:pass@host

# With --verbose, per-message lines should appear before the summary
npx tsx src/cli/index.ts restore --dry-run --verbose --to imap://user:pass@host
```

Expected dry-run + skip-duplicates output: `[dry-run] Total: N uploaded, M skipped` where M > 0 if
duplicates exist on target.

Expected verbose output: One line per message (`Uploaded: <id>` or `Skipped: <id>`) followed by
the summary line.
</verification>

<success_criteria>
- dry-run + skip-duplicates reports non-zero skipped count when target has matching messages (UAT test 5 passes)
- --verbose produces per-message lines (UAT test 8 passes)
- TypeScript compiles with zero errors
- No regression in existing UAT tests 1-4, 6, 7
</success_criteria>

<output>
After completion, create `.planning/phases/05-restore/05-GAP3-SUMMARY.md` using the summary template.
</output>
