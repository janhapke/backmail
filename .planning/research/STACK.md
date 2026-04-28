# Stack Research: backmail v1.1

**Domain:** TypeScript CLI application for email backup and restore via IMAP
**Researched:** 2026-04-28
**Focus:** Additions needed for interactive CLI init, git-style repo detection, and keyring password storage

---

## Executive Summary

The v1.1 milestone introduces three new capability areas: interactive CLI prompting for `backmail init`, git-style repository detection via directory walk-up, and OS keyring integration for password storage. The existing stack (TypeScript, Node.js, commander, imapflow, simple-git, zod, vitest) is well-suited for these additions. Research recommends:

1. **@clack/prompts** for interactive CLI (modern, lightweight, beautiful defaults)
2. **@napi-rs/keyring** stays as-is (already in package.json; production-grade, 77K weekly downloads)
3. **find-git-root** for directory walk-up detection (lightweight, maintained alternative to custom code)
4. No breaking changes to existing stack; Zod handles passwordRef parsing natively

---

## Existing Stack (Confirmed Sufficient)

| Technology | Current Version | Purpose | Status |
|------------|-----------------|---------|--------|
| TypeScript | 6.0.3 | Language and static typing | ✓ Current |
| Node.js | (specified in .nvmrc or CI) | Runtime | ✓ Current |
| commander | 14.0.3 | CLI framework | ✓ Sufficient; global flags work via hooks |
| imapflow | 1.3.2 | IMAP client | ✓ Sufficient |
| simple-git | 3.36.0 | Git operations | ✓ Sufficient |
| @napi-rs/keyring | ^1.2.0 | OS keyring access | ✓ Sufficient; no change needed |
| zod | ^4.3.6 | Schema validation | ✓ Sufficient for passwordRef parsing |
| mailparser | ^3.9.8 | Email parsing | ✓ Sufficient |
| vitest | 4.1.4 | Test runner | ✓ Sufficient |
| tsx | 4.21.0 | TypeScript execution (dev) | ✓ Sufficient |

**Notes:**
- **commander global flags:** Use `preAction` hook on root command to implement `--workdir` middleware that walks up to find `.backmail/` and sets context for all subcommands.
- **Zod passwordRef parsing:** Define a discriminated union with `z.union([z.object({ type: z.literal('keyring'), service: z.string(), account: z.string() }), z.object({ type: z.literal('env'), varname: z.string() })])` to handle `keyring:service=X;account=Y` and `env:VARNAME` formats.
- **@napi-rs/keyring:** Already present (^1.2.0). No upgrade needed; latest (1.2.0, 77K weekly downloads) is mature and used by Microsoft (MSAL) and Azure SDK for production auth flows.

---

## Recommended Additions

### 1. Interactive CLI Prompting: @clack/prompts

| Property | Value |
|----------|-------|
| **Package** | @clack/prompts |
| **Current Version** | 1.2.0 (as of April 2026) |
| **Purpose** | Interactive prompts for `backmail init` command (text input, select, confirm, multiselect, spinner) |
| **Why This Choice** | Modern, lightweight (4KB gzipped), beautiful default styling, simple function-based API (no classes or config), ESM-native |
| **Alternative Considered** | Inquirer.js / @inquirer/prompts (larger bundle, more setup, older design) |
| **npm install** | `npm install @clack/prompts` |

**Details:**

- Provides text, confirm, select, multiselect, and autocomplete prompts with spinner support
- Opinionated ANSI styling out of the box (no chalk configuration needed)
- ~80% smaller bundle than Inquirer
- Clean function-based API (each prompt is a named export, no registration required)
- Handles multi-step wizard flows naturally via `group()` API
- ESM-first (aligns with `"type": "module"` in package.json)

**Usage Pattern for `backmail init`:**
```typescript
import { text, confirm, select, spinner } from '@clack/prompts';

const username = await text({ message: 'Email username?' });
const passwordStored = await confirm({ message: 'Store password in OS keyring?' });
const folder = await select({ message: 'Select mailbox folder', options: [...] });

const s = spinner();
s.start('Initializing repository...');
// ... init logic
s.stop('Done!');
```

---

### 2. Git Repository Detection: find-git-root (Optional Enhancement)

| Property | Value |
|----------|-------|
| **Package** | find-git-root |
| **Current Version** | Latest available on npm |
| **Purpose** | Walk up directory tree to find `.backmail/` directory (similar to how git finds `.git/`) |
| **Why This Choice** | Lightweight, battle-tested in Node.js ecosystem, supports git worktrees |
| **Alternative Considered** | Custom walk-up logic in TypeScript (manual implementation) |
| **npm install** | `npm install find-git-root` |

**Details:**

- Searches for `.git/` by walking up from cwd; can be adapted for `.backmail/`
- Returns path synchronously or asynchronously
- Handles git worktrees correctly
- Alternatively, implement a simple custom walk-up function if lighter dependencies are preferred:

```typescript
// Custom implementation (minimal, no extra dep)
function findBackmailRoot(startDir = process.cwd()): string | null {
  let current = startDir;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, '.backmail'))) {
      return current;
    }
    current = path.dirname(current);
  }
  return null;
}
```

**Recommendation:** Use custom walk-up function to avoid an extra dependency. The logic is 5 lines of TypeScript and aligns with the principle of keeping the dependency graph lean (backmail already has 8 direct dependencies). This is NOT a blocker; research provided the option.

---

### 3. Optional: Password Reference Parser Utility

**Decision:** NOT a new package. Zod already handles this.

Zod's string parsing with custom `.transform()` can parse `keyring:service=X;account=Y` and `env:VARNAME` formats:

```typescript
const passwordRefSchema = z.string()
  .transform((input) => {
    if (input.startsWith('keyring:')) {
      const params = new URLSearchParams(input.slice(8)); // Remove 'keyring:'
      return { type: 'keyring', service: params.get('service'), account: params.get('account') };
    }
    if (input.startsWith('env:')) {
      return { type: 'env', varname: input.slice(4) };
    }
    throw new Error(`Invalid passwordRef format: ${input}`);
  });
```

No new package needed.

---

## Alternatives Considered

### Interactive Prompting

| Option | Recommended | Why Not |
|--------|-------------|---------|
| **@clack/prompts** | ✓ YES | Modern, lightweight, beautiful defaults, ESM-native. Best fit for v1.1. |
| Inquirer.js (@inquirer/prompts) | No | Larger bundle (even modular version), more configuration required, older design. Good for highly customizable scenarios (not backmail). |
| Enquirer | No | Less actively maintained; @clack/prompts has replaced it in modern tooling (webpack, eslint communities moving to clack). |
| prompts (terkelg/prompts) | No | Smaller bundle but less beautiful defaults; clack is the modern evolution. |

### Keyring Storage

| Option | Recommended | Why Not |
|--------|-------------|---------|
| **@napi-rs/keyring (current)** | ✓ YES (already used) | 77K weekly downloads, used by Microsoft (MSAL) and Azure SDK. No change needed. |
| cross-keychain | No | Built on top of @napi-rs/keyring; adds a layer we don't need. Stick with direct @napi-rs/keyring. |
| keytar (old standard) | No | Deprecated; @napi-rs/keyring is the modern replacement. Avoids libsecret issues on Linux. |
| plain-text env vars only | No | Security risk; OS keyring is the right pattern for CLI tools storing credentials. |

### Directory Walk-Up

| Option | Recommended | Why Not |
|--------|-------------|---------|
| **Custom function** | ✓ YES (preferred) | 5 lines of TypeScript; avoids extra dependency. Already in backmail's lean dependency philosophy. |
| find-git-root (npm) | Alternative | Works (slight adaptation for `.backmail/` instead of `.git/`), but custom function is simpler. |
| find-root (npm) | No | Looks for package.json; doesn't fit the `.backmail/` use case. |

---

## Versions Verified (as of 2026-04-28)

| Package | Version | Last Published | Notes |
|---------|---------|-----------------|-------|
| @clack/prompts | 1.2.0 | ~March 2026 | Latest; ESM-native, 6958+ projects using it |
| @napi-rs/keyring | 1.2.0 | ~January 2026 | No upgrade needed; production-grade |
| commander | 14.0.3 | (in package.json) | Current; supports preAction hooks for middleware |
| zod | ^4.3.6 | (in package.json) | Current; sufficient for passwordRef parsing |
| TypeScript | 6.0.3 | Latest | Current |

---

## Installation Commands

### Add @clack/prompts (Required for v1.1)

```bash
npm install @clack/prompts
```

### Keep as-is (No Changes)

```bash
# Already present; no updates needed
npm list @napi-rs/keyring commander imapflow simple-git zod
```

---

## Integration Points for v1.1

1. **`backmail init` command:**
   - Uses `@clack/prompts` for interactive prompting
   - Calls `@napi-rs/keyring.setPassword()` to store password
   - Writes `passwordRef: "keyring:service=backmail;account=<username>"` to `.backmail/config.json`

2. **Global `--workdir` flag:**
   - Implement via `program.option('-w, --workdir <path>')` in commander
   - Add `preAction` hook to resolve workdir and walk-up for `.backmail/`
   - Pass resolved workdir to all subcommand actions

3. **Password resolution:**
   - Parse `passwordRef` with custom Zod schema (no new packages)
   - Fallback to `BACKMAIL_PASSWORD` env var if present
   - Call `@napi-rs/keyring.getPassword()` for keyring refs

---

## Confidence Levels

| Area | Confidence | Reasoning |
|------|-----------|-----------|
| @clack/prompts fit | **HIGH** | Actively used by major projects, ESM-native, aligns with backmail's modern stack |
| @napi-rs/keyring sufficiency | **HIGH** | Already in use; verified adoption by Microsoft; no upgrade needed |
| commander global flags pattern | **HIGH** | preAction hooks are documented commander feature; well-established pattern |
| Zod passwordRef parsing | **HIGH** | Zod's discriminated unions and transform are standard; no edge cases |
| Directory walk-up approach | **HIGH** | Simple custom logic; alternatively find-git-root is well-tested |

---

## Sources

- [@clack/prompts - npm](https://www.npmjs.com/package/@clack/prompts)
- [Clack documentation](https://www.clack.cc/)
- [@clack/prompts: Modern Alternative to Inquirer.js](https://dev.to/chengyixu/clackprompts-the-modern-alternative-to-inquirerjs-1ohb)
- [@napi-rs/keyring - npm](https://www.npmjs.com/package/@napi-rs/keyring)
- [GitHub - Brooooooklyn/keyring-node](https://github.com/Brooooooklyn/keyring-node)
- [cross-keychain documentation](https://magarcia.io/cross-platform-secret-storage-with-cross-keychain/)
- [find-git-root - npm](https://www.npmjs.com/package/find-git-root)
- [Commander.js documentation](https://tj.github.io/commander.js/)
- [The Definitive Guide to Commander.js](https://betterstack.com/community/guides/scaling-nodejs/commander-explained/)
- [Zod documentation](https://zod.dev/)
- [npm trends - prompting libraries comparison](https://npmtrends.com/chalk-vs-commander-vs-enquirer-vs-inquirer-vs-prompt-vs-prompts)
