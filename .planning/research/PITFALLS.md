# Pitfalls: Repository Auto-Detection, Interactive Init, and Keyring Storage

**Project:** backmail v1.1 — Repository-Centric UX  
**Researched:** 2026-04-28  
**Confidence:** MEDIUM (keyring platform behavior LOW; repo detection HIGH from git-like patterns; interactive init MEDIUM; config parsing MEDIUM)

---

## Repository Detection Pitfalls

### Critical Pitfall: Symlink Cycles / Infinite Walk-Up

**What goes wrong:**
A symlink in the directory tree points back to a parent directory. Your walk-up algorithm enters an infinite loop: `.backmail/ → /parent → /grandparent → /ancestor → (symlink back to ancestor) → ancestor → ...`

**Why it happens:**
- User manually creates symlinks for directory sharing
- Misconfigured CI/CD environments with symlink-based checkouts
- NFS mounts with symlink loops
- Walk-up code doesn't track visited inodes

**Consequences:**
- CPU spike; process hangs until timeout
- CLI becomes unresponsive
- User must force-kill the process
- Cascading failures in async operations (timeouts in sync, other commands fail waiting)

**Prevention:**
- Track visited inodes (not just paths) during walk-up. Use `fs.statSync()` and cache `{ dev, ino }` pairs to detect cycles.
- Set a maximum walk-up limit (e.g., stop at filesystem root or after 50 levels) as a safety net.
- Example: `const seen = new Set<string>(); const stat = fs.statSync(dir); const inodeKey = \`\${stat.dev}:\${stat.ino}\`; if (seen.has(inodeKey)) break;`
- Handle `ELOOP` errors explicitly from `fs.statSync()` and report clearly.

**Detection:**
- Walk-up taking >5 seconds
- Repeated log entries for the same parent directory
- CPU at 100% during init/command startup

**Testing:**
```bash
ln -s .. cycle
backmail init  # Should fail gracefully, not hang
```

---

### Pitfall: Walk-Up Stops at Wrong .backmail/ Directory

**What goes wrong:**
Repository search finds `.backmail/` in a parent directory that's not the intended project repo. User has:
```
~/project-a/.backmail/     (old, unused project)
~/project-b/               (current project)
~/project-b/src/
```

Running `backmail sync` from `src/` finds the old project's `.backmail/` in `project-a/`, syncs the wrong email account, overwrites wrong git repo.

**Why it happens:**
- Multiple nested projects on same filesystem
- Abandoned old projects not cleaned up
- User assumption that "closest .backmail/" is theirs

**Consequences:**
- Silent data corruption (sync to wrong repo, wrong messages deleted)
- Difficult to debug (user may not notice until commit history is wrong)
- Potential email loss if old repo is later deleted

**Prevention:**
- Document that `.backmail/` detection is first-match, not "most relevant"
- Add `--verify-repo` flag to confirm the found repo matches expected state (e.g., prompt user with account name/host before proceeding)
- Consider `backmail whoami` command to display current repo path and account info
- Log the discovered `.backmail/` path clearly on startup: `Initializing with repo at /path/to/.backmail/`
- For critical operations (sync, restore), require explicit confirmation if repo was auto-detected vs. explicitly specified

**Detection:**
- Unexpected sync results (wrong account name, wrong email count)
- Git log shows messages from wrong account
- User reports "I didn't sync but messages are gone"

---

### Pitfall: Permission Denied at Ancestor Directory

**What goes wrong:**
Walk-up algorithm reaches a directory where the user lacks read permissions. `fs.statSync()` or `fs.readdirSync()` fails with `EACCES`.

Example:
```
/home/janitor/
  ├─ subdir/        (janitor has rwx, but /home is not readable)
  │  └─ project/
  │     └─ .backmail/
```

If `/home` is mode 700 (owner only), walk-up from `project/` reaches `/home`, fails with `EACCES`, and aborts.

**Why it happens:**
- restrictive filesystem permissions (CI/CD containers, shared servers)
- User running process with different uid than directory owner
- Volume mounts in Docker with read-only or restrictive perms
- NFS permissions mismatch

**Consequences:**
- Init fails with cryptic error
- User cannot initialize backmail in any subdirectory
- Works locally but fails in CI pipeline

**Prevention:**
- Catch `EACCES` in walk-up, log it, and stop gracefully (treat as "reached filesystem boundary")
- Don't treat permission errors as fatal; it's just "no .backmail/ found in accessible ancestors"
- Error message: `Walked up to /ancestor/dir but encountered permission denied. Repo must be in an accessible parent directory.`
- Allow `--workdir` to bypass walk-up entirely for restricted environments
- Document that `.backmail/` must be in a directory the user can read

**Detection:**
- `init` command fails with `EACCES` but works with `sudo`
- Works locally but fails in CI container
- Works in one subdirectory but not another

---

### Pitfall: Symlink to .backmail/ Directory Points Outside Repository

**What goes wrong:**
User symlinks `.backmail/` to a shared location:
```
~/project-1/.backmail -> /mnt/shared-config/.backmail
~/project-2/.backmail -> /mnt/shared-config/.backmail
```

Your code resolves the symlink and finds the same config. Both projects now share one config and one git repo, causing conflicts.

**Why it happens:**
- User tries to share config across multiple projects
- Misconfiguration of monorepo structure
- Symlink created by deployment automation

**Consequences:**
- Sync writes messages from both projects into one git repo
- Message IDs collide or conflict
- Both projects' git histories become corrupted
- Hard to notice until restore time

**Prevention:**
- Decide: do you follow symlinks or not?
  - **Follow symlinks (recommended):** Explicitly resolve with `fs.realpathSync()` and document that symlinks are dereferenced. Store the resolved path in memory. Warn if multiple walk-ups resolve to the same underlying repo.
  - **Don't follow symlinks:** Use `fs.lstatSync()` instead of `fs.statSync()` to detect symlinks, reject them with clear error message.
- If you follow symlinks, validate that the resolved path is within expected bounds (not escaping to `/etc/`, `/var/`, etc.)

**Detection:**
- Two `backmail log` commands in different directories show identical commit history
- Git repo contains messages from both projects
- Config path resolves to unexpected location

---

### Pitfall: Running from Filesystem Root

**What goes wrong:**
User runs `backmail init` from `/` or another privileged directory. Walk-up eventually reaches root, finds no `.backmail/`, creates it at `/` level (or fails with permission error).

**Why it happens:**
- User mistakenly runs command from wrong directory
- Scripted initialization with incorrect working directory
- `process.cwd()` is unexpectedly root (rare, but possible in CI)

**Consequences:**
- `.backmail/` created at filesystem root (permission denied) or in unexpected location
- Subsequent commands fail or target wrong repo
- Potential security issue if somehow succeeds

**Prevention:**
- Walk-up should stop at filesystem root and fail gracefully: `if (parent === dir) break;` (reached root)
- Explicit check: `if (resolvedPath === os.homedir() || resolvedPath === '/')` should reject with "Cannot initialize backmail at root or home directory"
- Require an explicit `--workdir` for initialization
- Error message: `Cannot detect or initialize backmail repository from filesystem root. Specify --workdir or change to your project directory.`

**Detection:**
- `.backmail/` exists at `/` (ls -la / | grep backmail)
- Init succeeds but subsequent commands fail with permission denied

---

## Keyring Pitfalls

### Critical Pitfall: Keyring Unavailable at Init Time

**What goes wrong:**
User runs `backmail init` in a headless environment (CI/CD, SSH session, container without D-Bus). Keyring is unavailable (no D-Bus, no GNOME Keyring daemon, no macOS Keychain access).

init prompts for password, tries to store in keyring, fails, but doesn't fall back to env var or ask user to provide alternative.

**Why it happens:**
- @napi-rs/keyring throws error or silently fails when keyring is not accessible
- Async/sync mismatch: code assumes synchronous behavior but keyring op is async
- Platform detection is incomplete (assumes keyring always available on Linux)
- CI/CD runner has no TTY and no keyring available simultaneously

**Consequences:**
- Init fails midway, repo in incomplete state
- User cannot proceed without manual intervention
- Fallback to `BACKMAIL_PASSWORD` env var is not offered
- Password is lost; user must reinit

**Prevention:**
- Wrap keyring operations in try/catch. If keyring.setPassword() throws, offer three options:
  1. `Keyring unavailable. Store password in BACKMAIL_<ACCOUNT>_PASSWORD env var instead? (y/n)`
  2. If user declines, save a placeholder passwordRef in config: `"passwordRef": "env:BACKMAIL_<ACCOUNT>_PASSWORD"` and exit with instruction to set env var
  3. If user agrees, prompt for password again and store in env file template (or document manual step)
- Test keyring availability before init begins: `try { new Entry('backmail', '_test').getPassword() } catch { ... }`
- Document: "If init fails with keyring errors, set BACKMAIL_<ACCOUNT>_PASSWORD env var and use `passwordRef: env:BACKMAIL_<ACCOUNT>_PASSWORD` in config.json"
- Warn on init if running in headless environment: "Running in non-interactive context. Keyring may not be available. Plan to use BACKMAIL_PASSWORD env var."

**Detection:**
- Init completes but password is not in keyring
- `backmail sync` fails: "No credential for account..."
- Init error: "[some cryptic keyring error]"

**Testing:**
```bash
# Headless (no D-Bus, no display)
unset DISPLAY DBUS_SESSION_BUS_ADDRESS
backmail init --account test --host imap.example.com --username user  # Should offer env var fallback
```

---

### Pitfall: Platform-Specific Keyring Backend Behavior

**What goes wrong:**
Password storage succeeds on macOS Keychain but fails on Linux GNOME Keyring (or vice versa). Or: retrieval succeeds on one platform but returns empty string on another.

**macOS Keychain issues:**
- Requires Keychain to be unlocked (user may have locked it)
- macOS 11+ only supported
- May require explicit app entitlements

**GNOME Keyring issues:**
- D-Bus session must be running
- Keyring must be unlocked (default collection)
- gnome-keyring-daemon must be running
- If KWallet is also installed, it may take precedence incorrectly

**KWallet issues (KDE Plasma):**
- Requires KDE Plasma running
- D-Bus and dbus-python required (install may fail)
- SecretService vs KWallet precedence issues
- Wallet creation UI may be triggered during init (not suitable for non-interactive)

**Headless Linux issues:**
- No GNOME Keyring daemon running
- No D-Bus available
- Entry.getPassword() may hang waiting for D-Bus response
- Only fallback is env var

**Why it happens:**
- @napi-rs/keyring delegates to OS-specific backends with different behaviors
- No platform detection or version checking in init flow
- Async behavior differs per platform (some sync, some async)

**Consequences:**
- Password not stored reliably across platforms
- Init succeeds but sync fails with no clear reason
- User can't sync on CI/CD even though it works locally
- Blocking UI might appear in unattended script context

**Prevention:**
- **Async handling:** Code assumes getPassword() may be async. The current config.ts has a workaround:
  ```typescript
  const result = entry.getPassword()
  if (result && typeof (result as any).then === 'function') {
    resolvedPassword = await (result as unknown as Promise<string>)
  }
  ```
  This is correct but fragile. Verify @napi-rs/keyring behavior across platforms before shipping.
  
- **Explicit platform handling:**
  ```typescript
  const keyringBackend = process.platform === 'darwin' ? 'Keychain' : 'SecretService'
  // Log which backend is being used
  ```

- **Fallback strategy:** Always offer env var fallback prominently in init, don't rely solely on keyring.

- **Version check:** On init, log which keyring backend will be used. On older systems (macOS <11), explicitly warn or use env var only.

- **Timeout protection:** If getPassword() hangs on D-Bus, set a timeout (e.g., 2s), catch timeout, and use env var fallback.

- **Testing matrix:** Test init + sync on:
  - macOS Keychain (locked, unlocked, app not authorized)
  - GNOME Keyring (daemon running, not running)
  - KWallet (KDE Plasma installed, not installed)
  - Headless Linux (no D-Bus, no display)

**Detection:**
- Init succeeds locally but sync fails in CI
- Password works on macOS but not Linux
- getPassword() hangs indefinitely on some systems

---

### Pitfall: Async/Await Mismatch in getPassword()

**What goes wrong:**
Entry.getPassword() may return a Promise on some platforms (async) or a string on others (sync). If code awaits indiscriminately, it works on Platform A but fails on Platform B where getPassword() returns a synchronous value.

**Why it happens:**
- @napi-rs/keyring backend behavior is platform-dependent
- Rust bindings for macOS Keychain may be sync; D-Bus (Linux) may be async
- Documentation for @napi-rs/keyring doesn't clarify this
- No version guarantees in @napi-rs/keyring releases

**Consequences:**
- Password retrieval fails intermittently
- Sync works on one platform but not another
- Difficult to reproduce locally (may only appear in CI or specific OS)

**Prevention:**
- **Current code handles this:** config.ts already has the workaround above. Verify it's correct:
  ```typescript
  if (result && typeof (result as any).then === 'function') {
    resolvedPassword = await (result as unknown as Promise<string>)
  } else if (typeof result === 'string') {
    resolvedPassword = result
  }
  ```
  
- **Test coverage:** Add tests for both sync and async behavior:
  ```typescript
  // Mock @napi-rs/keyring to return a Promise
  vi.mock('@napi-rs/keyring', () => ({
    Entry: class {
      getPassword() { return Promise.resolve('password') }
    }
  }))
  
  // Mock to return a string
  vi.mock('@napi-rs/keyring', () => ({
    Entry: class {
      getPassword() { return 'password' }
    }
  }))
  ```

- **Type safety:** Consider wrapping in a helper function with consistent return type:
  ```typescript
  async function getPasswordSafe(service: string, account: string): Promise<string | null> {
    try {
      const entry = new Entry(service, account)
      const result = entry.getPassword()
      if (result && typeof (result as any).then === 'function') {
        return await result
      } else if (typeof result === 'string') {
        return result
      }
      return null
    } catch {
      return null
    }
  }
  ```

**Detection:**
- getPassword() returns undefined or null unexpectedly
- Sync works once, fails on subsequent runs
- Error: "Cannot read property 'then' of string"

---

### Pitfall: Keyring Entry Name Collision

**What goes wrong:**
Multiple accounts share the same service/account name in keyring storage. Example:

User initializes two repos with the same username:
```
~/email-backup/.backmail/config.json → passwordRef: "keyring:service=backmail;account=user@example.com"
~/email-archive/.backmail/config.json → passwordRef: "keyring:service=backmail;account=user@example.com"
```

Both repos try to store/retrieve from the same keyring entry. If password is updated for one account, both see the change.

**Why it happens:**
- Multiple IMAP accounts with same username on same host
- User not aware of keyring collision risk
- No namespace isolation per repository

**Consequences:**
- Password change in one repo affects both
- Confusing debugging when sync fails (which repo's password is wrong?)
- Accidental credential cross-contamination

**Prevention:**
- Include repository identity in keyring service/account name. Options:
  1. **Repository path:** `keyring:service=backmail;account=<repo_path_hash>`
  2. **Repository + host:** `keyring:service=backmail;account=<username>@<host>@<repo_hash>`
  3. **Just warn:** Explicitly check if same keyring entry is used elsewhere, warn user

- If using approach 1/2, ensure hash is stable (use `sha256(absolutePath)` or similar).

- Better: Use descriptive account name from user input:
  ```
  backmail init --account work --username user@example.com
  # Stores as: keyring:service=backmail;account=work
  ```
  Then user keeps account names unique across repos.

- Document in init: "Account names must be unique across all your backmail repositories. Pick something like 'work', 'personal', or 'backup-001'."

**Detection:**
- Two repos with same account name
- Password change in one repo unexpectedly affects the other
- `backmail log` in repo A shows different password behavior than repo B

---

## Interactive Init Pitfalls

### Pitfall: Non-TTY Context (Automated Environments)

**What goes wrong:**
User runs `backmail init` with stdin redirected or in CI/CD where no TTY is available. Code checks `process.stdin.isTTY` but:
- Check is missing, code tries to prompt, hangs waiting for input
- Prompt writes to stdout, but input never comes (stdin closed or piped)
- Script times out or process hangs indefinitely

**Why it happens:**
- CI/CD runners often don't allocate a TTY
- Piping commands: `echo "" | backmail init` (stdin is not a TTY)
- Running in Docker container without `-it` flags
- Scheduled cron jobs (no TTY available)

**Consequences:**
- Init hangs forever; job times out
- User can't initialize backmail in CI/CD at all
- Must fall back to flag-based init, but then password can't be stored securely

**Prevention:**
- **Check TTY early:**
  ```typescript
  import { isatty } from 'node:tty'
  
  if (!isatty(process.stdin.fd)) {
    if (!hasAllRequiredFlags) {
      throw new Error(
        'Running in non-interactive context and required flags missing. ' +
        'Either provide all flags (--account, --host, --username, --password) ' +
        'or set BACKMAIL_PASSWORD env var and use --password-ref flag.'
      )
    }
    // Use flags, skip prompts
  }
  ```

- **Require full flags in non-TTY:** If not interactive, insist on all parameters as flags or error.

- **Document:** "For automated/CI environments, provide all parameters as flags: `backmail init --account work --host imap.gmail.com --username user@gmail.com --password-ref env:BACKMAIL_PASSWORD`"

- **Allow stdin alternatives:** Accept password via stdin or env var even in non-TTY context:
  ```bash
  echo "password123" | backmail init --account work --host imap.gmail.com --username user@gmail.com
  # Or
  BACKMAIL_INIT_PASSWORD=... backmail init --account work --host imap.gmail.com --username user@gmail.com
  ```

**Detection:**
- Init hangs in CI/CD
- Works locally but not in pipeline
- Job times out waiting for input

---

### Pitfall: Interrupted/Partial Init Completion

**What goes wrong:**
User hits Ctrl+C midway through init, or network fails while storing to keyring. Repository is left in an inconsistent state:
- `.backmail/` directory created but config.json incomplete
- Config written but keyring entry missing
- Git repo initialized but archive/ not set up
- User reruns init; unclear what to do with partial state

**Why it happens:**
- User impatience (Ctrl+C)
- Keyring operation times out or fails
- Power loss or network interruption during init
- Disk full while writing config.json

**Consequences:**
- Second init attempt fails (directory already exists)
- Confusing error messages ("config.json exists but is malformed")
- User must manually clean up `.backmail/` to retry
- Risk of losing partial data

**Prevention:**
- **Transactional init:** Write to a temporary location first, then move atomically:
  ```typescript
  const tempDir = path.join(repoPath, '.backmail.init.tmp')
  // Write all files to tempDir
  // If all succeeds, rename to .backmail
  fs.renameSync(tempDir, backMailDir)
  ```

- **Idempotency:** If `.backmail/` exists, check if it's a valid complete repository:
  ```typescript
  function isValidRepository(backMailDir: string): boolean {
    return fs.existsSync(path.join(backMailDir, 'config.json')) &&
           fs.existsSync(path.join(backMailDir, 'archive')) &&
           // Check git repo is valid
           true
  }
  
  if (fs.existsSync(backMailDir)) {
    if (isValidRepository(backMailDir)) {
      // Already initialized
      throw new Error(`Backmail repository already exists at ${backMailDir}. Use --reinit to reset.`)
    } else {
      // Partial; clean up and retry, or ask user
      throw new Error(`Incomplete backmail repository at ${backMailDir}. Delete it and try again, or use --reinit.`)
    }
  }
  ```

- **Recover from partial failure:** If keyring storage fails but config is valid, save a recovery hint:
  ```json
  {
    "config": {...},
    "_initLog": {
      "completedSteps": ["directory", "git", "config"],
      "failedStep": "keyring",
      "recoverySuggestion": "Set BACKMAIL_ACCOUNT_PASSWORD env var and retry"
    }
  }
  ```

- **Signal handling:** On Ctrl+C, clean up temp files before exiting:
  ```typescript
  process.on('SIGINT', () => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    process.exit(0)
  })
  ```

**Detection:**
- Second init fails: "directory already exists"
- config.json corrupted or incomplete
- `.backmail/` exists but `git rev-parse --git-dir` fails

---

### Pitfall: Reinitializing Existing Repository

**What goes wrong:**
User runs `backmail init` on a directory that already has a `.backmail/` repository. Should they:
- Error (refuse to reinit)?
- Overwrite (lose old config)?
- Merge (update account, keep messages)?

Decision is unclear, and behavior surprises user.

**Why it happens:**
- User forgot they already initialized this repo
- User trying to update config (add new account, change password)
- Script runs init unconditionally without checking

**Consequences:**
- Old config/password overwritten
- Messages lost if new account is different
- User has to recover from backup or reinit properly

**Prevention:**
- **Explicit --reinit flag:** Require explicit opt-in to overwrite:
  ```bash
  backmail init  # Fails: repository already exists
  backmail init --reinit  # Proceeds, warns about overwrite
  ```

- **Partial reinit:** Separate commands:
  ```bash
  backmail init          # Full initialization
  backmail config set   # Update existing config
  backmail credentials  # Rotate password/keyring entry
  ```

- **Check before overwrite:** If reinitialized, warn user about existing messages:
  ```
  Backmail repository already exists at /path/.backmail/
  This contains X messages. Are you sure you want to reinitialize and replace the config? (y/n)
  ```

- **Save backup:** Before rewriting config, save old version:
  ```typescript
  const backupPath = `${configPath}.backup.$(date +%s).json`
  fs.copyFileSync(configPath, backupPath)
  ```

**Detection:**
- User expects to update config but entire repo is reset
- Messages are lost after second init
- Git history is truncated

---

## Config & passwordRef Pitfalls

### Pitfall: Malformed passwordRef Parsing

**What goes wrong:**
Config contains malformed passwordRef like:
```json
{
  "passwordRef": "keyring:service=backmail;account=user;extra=garbage;account=different"
}
```

Parser splits by `;`, gets confused by duplicate keys, missing values, or invalid syntax. Silently returns wrong value or crashes.

**Why it happens:**
- User manually edits config.json
- Migration from old config format has bugs
- Parser is too lenient or doesn't validate

**Consequences:**
- Wrong password retrieved
- Sync with wrong credentials
- Cryptic auth failure

**Prevention:**
- **Strict parser with error handling:**
  ```typescript
  function parsePasswordRef(ref: string): { type: 'keyring' | 'env', params: Record<string, string> } {
    const [type, ...pairs] = ref.split(':')
    if (!['keyring', 'env'].includes(type)) {
      throw new Error(`Invalid passwordRef type: ${type}. Must be 'keyring' or 'env'.`)
    }
    
    const params: Record<string, string> = {}
    const pairString = pairs.join(':')
    for (const pair of pairString.split(';')) {
      const [key, value] = pair.split('=')
      if (!key || !value) {
        throw new Error(`Malformed passwordRef: missing key=value in '${pair}'`)
      }
      if (params[key]) {
        throw new Error(`Duplicate key in passwordRef: ${key}`)
      }
      params[key] = value
    }
    
    // Validate required keys
    if (type === 'keyring' && (!params.service || !params.account)) {
      throw new Error(`Keyring passwordRef missing required keys: service, account`)
    }
    if (type === 'env' && !params.VAR) {
      throw new Error(`Env passwordRef missing required key: VAR`)
    }
    
    return { type, params }
  }
  ```

- **Schema validation:** Use Zod to validate config shape:
  ```typescript
  const PasswordRefSchema = z.union([
    z.object({
      type: z.literal('keyring'),
      service: z.string().min(1),
      account: z.string().min(1),
    }),
    z.object({
      type: z.literal('env'),
      variable: z.string().min(1).regex(/^[A-Z_][A-Z0-9_]*$/),
    }),
  ])
  ```

- **Test roundtrip:** Config → parse → stringify → parse should be idempotent.

**Detection:**
- Sync fails: "No credential for account..."
- Config loads but passwordRef is ignored
- Test: `cat config.json | jq .passwordRef` shows unexpected value

---

### Pitfall: Migration from Old Config Format

**What goes wrong:**
Old v1.0 config stored password in plaintext:
```json
{
  "accounts": {
    "work": {
      "host": "imap.gmail.com",
      "port": 993,
      "username": "user@gmail.com",
      "password": "plaintext_password",
      "repoPath": "~/email-work"
    }
  }
}
```

v1.1 changes to per-repo `.backmail/config.json` with `passwordRef`. Old config is lost or ignored.

**Why it happens:**
- Old config format incompatible with new repo-centric design
- No migration tool written
- Assumption that users will reinit

**Consequences:**
- Users can't upgrade without losing credentials or reconfiguring
- Old config becomes dead code
- Data loss if user assumes migration is automatic

**Prevention:**
- **Provide migration tool:**
  ```bash
  backmail migrate --old-config ~/.config/backmail/config.json
  # Output: Created /home/user/email-work/.backmail/config.json
  #         Password stored in keyring as backmail@work
  #         Old config backed up to ~/.config/backmail/config.json.v1.0
  ```

- **Detect old config on startup:** If old `~/.config/backmail/config.json` exists but new `.backmail/` doesn't:
  ```
  Found old backmail v1.0 config at ~/.config/backmail/config.json
  This is not compatible with backmail v1.1.
  To migrate, run: backmail migrate --old-config ~/.config/backmail/config.json
  ```

- **Safe password extraction:** During migration, extract plaintext passwords from old config, store in new keyring, never write plaintext to disk:
  ```typescript
  const oldPassword = oldConfig.accounts.work.password
  const entry = new Entry('backmail', 'work')
  entry.setPassword(oldPassword)  // Store securely
  delete oldConfig.accounts.work.password  // Never save plaintext
  ```

- **Validation:** After migration, test that `backmail log` works in new repo before removing old config.

**Detection:**
- Users report "my config is not working after upgrade"
- Old credentials are still in plaintext somewhere
- Sync fails with "no credential found" even though old config had password

---

### Pitfall: Environment Variable Expansion in Config

**What goes wrong:**
Config contains environment variable references, but they're not expanded:
```json
{
  "passwordRef": "env:$BACKMAIL_PASSWORD"
}
```

or:

```json
{
  "repoPath": "~/projects/$PROJECT_NAME/email"
}
```

Code doesn't expand `$VAR`, interprets literally as `$BACKMAIL_PASSWORD` (not the env var value).

**Why it happens:**
- User assumes config.json is like shell script (it's not)
- No explicit expansion function called
- Zod schema doesn't pre-process strings

**Consequences:**
- `passwordRef` can't be resolved
- `repoPath` points to wrong location
- Sync fails or creates wrong directory

**Prevention:**
- **Explicit no-expansion:** Document that config.json does NOT expand environment variables. Use literal values only.
- **Only expand where sensible:** If you do support expansion, make it explicit:
  ```typescript
  function expandPath(p: string): string {
    if (p.startsWith('~/')) {
      return path.join(os.homedir(), p.slice(2))
    }
    // Do NOT expand $VAR — too risky for security
    return p
  }
  ```
- **If passwordRef is `env:VARNAME`:** Don't use `$VARNAME`, just the bare name:
  ```json
  {
    "passwordRef": "env:BACKMAIL_PASSWORD"
  }
  ```
  Then code reads `process.env.BACKMAIL_PASSWORD`, not `process.env.$BACKMAIL_PASSWORD`.

- **Security note:** Expanding environment variables in config files is a common injection vector (see OpenClaw CVEs). Avoid it entirely.

**Detection:**
- getPassword() fails to find variable
- Sync error: "BACKMAIL_$PASSWORD not found"
- repoPath points to literal `$PROJECT_NAME` instead of expanded value

---

## --workdir Pitfalls

### Pitfall: Relative Path Resolution Against Wrong Base

**What goes wrong:**
User runs `backmail sync --workdir ../other-repo` from `/home/user/project/src/`. Code resolves relative path against `process.cwd()` instead of the script location or explicitly specified base.

Expected: `/home/user/other-repo/`  
Actual: Resolved against `src/` → `/home/user/project/src/../other-repo` → `/home/user/project/other-repo/`

**Why it happens:**
- Relative path resolution uses `path.resolve()` without a base
- `process.cwd()` changes when user changes directory
- User assumption about relative path semantics

**Consequences:**
- Sync targets wrong repo
- Messages from one repo go to another
- User confused about which directory is being synced

**Prevention:**
- **Explicit base:** Always resolve relative paths against `process.cwd()` explicitly and document it:
  ```typescript
  function resolveWorkdir(workdir: string): string {
    if (path.isAbsolute(workdir)) {
      return path.resolve(workdir)
    }
    // Relative paths are always resolved from CWD
    return path.resolve(process.cwd(), workdir)
  }
  ```

- **Log resolved path:** On startup, log the resolved `--workdir`:
  ```
  Using workdir: /home/user/other-repo/ (resolved from --workdir ../other-repo relative to /home/user/project/src/)
  ```

- **No symlink tricks:** After resolving, validate the result:
  ```typescript
  const resolved = path.resolve(process.cwd(), workdir)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Workdir does not exist: ${resolved}`)
  }
  // Optionally resolve symlinks
  const realPath = fs.realpathSync(resolved)
  ```

**Detection:**
- Sync targets wrong directory
- Log shows unexpected path
- Messages appear in wrong repo

---

### Pitfall: Missing Directory with --workdir

**What goes wrong:**
User specifies `--workdir /non/existent/path`. Code doesn't validate, creates it automatically, or errors later at init time.

**Why it happens:**
- User typo in path
- Directory was deleted between commands
- Assumption that workdir always exists

**Consequences:**
- Silent creation of wrong directory (user doesn't notice)
- Init creates `.backmail/` in wrong location
- Later sync targets wrong repo

**Prevention:**
- **Validate early:** Check that `--workdir` exists before proceeding:
  ```typescript
  function validateWorkdir(workdir: string): void {
    const resolved = path.resolve(process.cwd(), workdir)
    if (!fs.existsSync(resolved)) {
      throw new Error(`Workdir does not exist: ${resolved}. Create it first or omit --workdir for auto-detection.`)
    }
  }
  ```

- **Only create during init:** If `backmail init --workdir /new/path`, create the directory as part of init, not as a side effect of `--workdir` parsing.

**Detection:**
- Repo created in unexpected location
- `.backmail/` found at `/` or `/tmp/` instead of intended path
- User runs init without seeing "created directory" message

---

### Pitfall: Path Traversal / Symlink Escape via --workdir

**What goes wrong:**
User specifies `--workdir` with symlink that escapes intended boundaries:
```bash
backmail sync --workdir /mnt/controlled-dir/../../etc/
# Or via symlink:
backmail sync --workdir /mnt/sym-escape  # -> /etc
```

Code doesn't validate, syncs to `/etc` or other sensitive location, corrupting system files.

**Why it happens:**
- No path validation or boundary checking
- Symlinks are followed without realizing they escape
- User (or attacker) uses relative components like `../..`

**Consequences:**
- Data written to unintended location (system corruption)
- Potential security issue if backmail can run with elevated privileges
- .backmail/ and git repo created outside intended scope

**Prevention:**
- **Validate path is normalized:**
  ```typescript
  const workdir = path.resolve(basePath, provided)
  const normalized = path.resolve(workdir)  // Remove .. and .
  if (normalized !== workdir) {
    throw new Error(`Workdir contains invalid path traversal: ${provided}`)
  }
  ```

- **Option 1 — No symlink resolution:**
  ```typescript
  const workdir = path.resolve(basePath, provided)
  // DO NOT call fs.realpathSync() — it resolves symlinks
  // Validate path is under an allowed parent
  ```

- **Option 2 — Resolve symlinks, validate result:**
  ```typescript
  const workdir = path.resolve(basePath, provided)
  const realPath = fs.realpathSync(workdir)
  // Check realPath is still within allowed boundaries
  if (!realPath.startsWith(allowedRoot)) {
    throw new Error(`Workdir escapes allowed boundaries: ${realPath}`)
  }
  ```

- **Document:** `--workdir` accepts absolute or relative-to-CWD paths. Symlinks are followed. Relative paths are resolved against CWD, not against script location.

**Detection:**
- Files created in `/etc` or other system directories
- `.backmail/` appears in unexpected locations
- Filesystem corruption reports

---

## Summary of Critical Prevention Patterns

| Domain | Critical Pattern | Implementation |
|--------|------------------|-----------------|
| Repo detection | Symlink cycle tracking | Cache visited inodes, set walk-up limit |
| Repo detection | Permission boundary | Catch EACCES, stop gracefully |
| Keyring | Headless fallback | Offer env var alternative, test early |
| Keyring | Platform async/sync | Handle both Promise and string returns |
| Init | TTY detection | Check `isatty()`, require all flags in non-TTY |
| Init | Transactional writes | Write to temp, move atomically, clean on SIGINT |
| passwordRef | Strict parsing | Validate schema, reject malformed syntax |
| --workdir | Path validation | Normalize, check existence, validate symlink boundaries |

---

## Sources

- [Architecture Symlink Handling](https://github.com/sindresorhus/find-up)
- [Node.js TTY Documentation](https://nodejs.org/api/tty.html)
- [Node.js fs.realpathSync Security](https://nodejs.org/en/blog/vulnerability/march-2026-security-releases/)
- [Keyring Backend Differences](https://keyring.readthedocs.io/)
- [Environment Variable Injection Pitfalls](https://dailycve.com/openclaw-cli-backend-environment-variable-injection-cve-2026-4039-high/)
- [Directory Walk Permission Handling](https://github.com/coder/code-server/issues/4058)
- [Docker WORKDIR Best Practices](https://docs.docker.com/reference/build-checks/workdir-relative-path/)
- [Dockerfile WORKDIR Pitfalls](https://codepathfinder.dev/registry/docker/best-practice/DOCKER-BP-018)
