# Features Research: backmail v1.1

**Project:** backmail — TypeScript CLI email backup tool with repository-centric UX  
**Researched:** 2026-04-28  
**Scope:** Init command patterns, repo auto-detection, interactive CLI prompting, credential reference patterns  
**Overall confidence:** MEDIUM-HIGH (patterns verified via documentation and ecosystem tools; some domain-specific nuances need phase validation)

---

## Init Command Patterns

### Table Stakes: What a Modern Init Command Must Do

Based on ecosystem patterns (npm init, cargo init, gh repo create, git init), a production-quality init command requires:

#### 1. **Dual-Mode Operation**
- **Interactive mode** (default): Prompt user for all parameters, with sensible defaults pre-filled
- **Fully automated mode** (flags): Accept all parameters as CLI flags for scripting / CI
- **Hybrid mode**: Flags provided = skip those prompts; missing flags = prompt interactively
- **Pattern:** `--yes` / `-y` flag skips all prompts and uses defaults (npm, cargo convention)
- **Example:** `backmail init` (interactive) vs `backmail init --name mailbox --host imap.example.com --user alice@example.com --password-fallback env` (fully scripted)

**Confidence:** HIGH (verified in npm, cargo, gh)

#### 2. **Transparent Feedback & Progress**
- **Pre-action confirmation:** Show what will be created before creating it
  - Proposed directory structure: `.backmail/`, `archive/`, `worktrees/`
  - Proposed config layout
  - Where password will be stored (keyring service and account name)
- **Action transparency:** Log what's being done as it happens
  - "Creating .backmail/ directory..."
  - "Initializing git repository in archive/..."
  - "Storing password in system keyring..."
  - "Writing config.json..."
- **Success confirmation:** Show what was created and key next steps
  - Absolute path to repository
  - How to run first `backmail sync`
  - How to override repo detection if needed
- **Non-destructive:** Refuse to overwrite existing .backmail/ directory; suggest moving or explicitly providing `--force` flag

**Confidence:** MEDIUM (from CLI best practices; specific patterns vary by tool, need phase validation for exact format)

#### 3. **Input Validation & Clear Error Messages**
- **Early validation:** Validate inputs as prompted, don't wait until end
  - IMAP host: Check it's resolvable (DNS lookup or regex validation)
  - Email: Basic format check
  - Port: Valid port range (1-65535)
- **Descriptive errors:** Don't say "invalid input"; explain what's wrong
  - ❌ "Invalid host"
  - ✓ "Host must be a valid domain or IP address (e.g., imap.gmail.com)"
- **Suggestions:** Offer common defaults for known providers
  - If user enters "gmail.com", suggest "imap.gmail.com"
  - If user doesn't know the IMAP host, point them to provider docs
- **Validation happens before commitment:** Don't create directories until all inputs are valid

**Confidence:** HIGH (verified in CLI guidelines and multiple tools)

#### 4. **Sensible Defaults**
- **Repository name:** Derive from hostname or user preference
  - `backmail init --host imap.gmail.com --user alice@gmail.com` → defaults name to "gmail" or "alice-gmail"
- **Config location:** Always `.backmail/config.json` in the initialized directory
- **Git initial branch:** Use `main` (not `master`, aligns with modern git)
- **Archive location:** Always `archive/` subdirectory (enforced)
- **Worktrees location:** Always `worktrees/` subdirectory (enforced)
- **Default branch for new repo:** `main` (via `git init --initial-branch=main`)

**Confidence:** HIGH (standard practice across ecosystem)

#### 5. **Password Handling During Init**
- **Prompt clearly:** "Password: " (hidden input, no echo)
- **Confirm password:** Require re-entry to catch typos; don't assume keyring save succeeded
- **Keyring fallback:** If keyring save fails, offer `BACKMAIL_PASSWORD` env var as fallback
  - "⚠️ Failed to save password to system keyring. Set BACKMAIL_PASSWORD environment variable instead."
  - Show the exact format: `export BACKMAIL_PASSWORD="your-password"`
- **Never log password:** Not in config, not in stdout, not in logs
- **Test credentials:** Optional `--test-credentials` flag to verify IMAP connection before finishing

**Confidence:** MEDIUM (keyring integration is complex; phase implementation should validate fallback behavior)

---

## Repo Auto-Detection Patterns

### How Git Does It (The Standard)

Git's walk-up algorithm is well-documented and battle-tested:

1. Start in current working directory
2. Look for `.git/` directory
3. If not found, move to parent directory and repeat
4. Stop when:
   - `.git/` is found → use that repo root
   - Filesystem boundary crossed → stop (don't cross mounted volumes)
   - Root directory `/` reached → "fatal: not a git repository"

**Git controls this via:**
- `GIT_CEILING_DIRECTORIES` env var: List of directories Git won't walk past (e.g., mount points)
- `GIT_DIR` env var: Explicitly set repository location (disables auto-detection)
- `--git-dir` flag: Same as `GIT_DIR`, takes precedence

**Confidence:** HIGH (git-scm.com documentation)

### backmail Equivalent

For backmail, apply the same pattern with `.backmail/` as the marker:

```
Current directory: /home/jan/Projects/backmail-repo/archive/worktrees/2024-01
├─ Walk up: /home/jan/Projects/backmail-repo/archive/worktrees/
├─ Walk up: /home/jan/Projects/backmail-repo/archive/
├─ Walk up: /home/jan/Projects/backmail-repo/
│  ✓ Found .backmail/ → Use this repo root
└─ Stop
```

**Implementation details:**
- Walk up from `process.cwd()`
- Check for `.backmail/` in each directory
- Stop on filesystem boundary (via `os.homedir()` or mount point check—optional for v1.1)
- Return `null` if not found (triggers "repository not found" error)

**Confidence:** HIGH (direct pattern from git)

### Edge Cases & Error Handling

**1. Repository Not Found**
- **Error message:** "fatal: not a backmail repository (or any of the parent directories): .backmail/"
- **Rationale:** Exact wording from git to leverage user muscle memory
- **Suggested next step:** "Run 'backmail init <path>' to create a repository"

**Confidence:** MEDIUM (pattern from git; exact messaging needs phase validation)

**2. Multiple Repositories (Nested)**
- Scenario: User has a `.backmail/` directory inside another `.backmail/` repository
- **Behavior:** Stop at first (closest) `.backmail/` found (git same behavior with `.git/`)
- **This is expected:** User can override with `--workdir` if they need the outer repo

**Confidence:** HIGH (git precedent)

**3. Symlinks in Path**
- **Git behavior:** Resolves symlinks before walking up (via `realpath`)
- **Recommended for backmail:** Same approach—resolve symlinks first
- **Rationale:** Avoids user confusion when symlink points into another repo

**Confidence:** MEDIUM (git pattern, but node.js symlink handling needs validation)

---

## Interactive CLI Prompting UX

### Table Stakes: What Users Expect

Based on ecosystem standards (npm init, cargo init, inquirer patterns, gh auth):

#### 1. **Default Values Visible in Prompts**
```
? IMAP host (imap.gmail.com): [user presses enter → uses default]
? Email address: alice@gmail.com
? Port (993): [user presses enter → uses default]
```

**Pattern:**
- Show default in square brackets after prompt text
- Pressing Enter without input accepts default
- Pressing Ctrl+C cancels the entire init (no partial state)

**Library recommendation:** `@inquirer/prompts` (modern, TypeScript-first, 2026 recommended over legacy inquirer)

**Confidence:** HIGH (verified in npm, cargo, inquirer documentation)

#### 2. **Feedback Checkmarks & Progress**
- ✓ Directory structure created
- ✓ Git repository initialized
- ✓ Password stored in system keyring
- ✓ Configuration written

**Pattern:** Show checkmark emoji or status indicator as each step completes. Don't wait for all steps to finish before feedback.

**Alternative (minimal):** Just show "Creating .backmail/... done" with a newline.

**Confidence:** MEDIUM (modern CLI convention, but minimalist alternative also acceptable)

#### 3. **Validation Errors Shown Immediately**
```
? IMAP host (imap.gmail.com): invalid..host
✗ Invalid format. Expected: hostname or IP (e.g., imap.gmail.com)
? IMAP host (imap.gmail.com): [cursor back here]
```

**Pattern:**
- Show error message in red (if terminal supports color)
- Re-prompt for the same field
- Don't move to next field until valid
- Keep user in loop (don't exit; let them retry)

**Confidence:** HIGH (CLI best practices and multiple tools)

#### 4. **Confirmation Before Destructive Operations**
- If `.backmail/` already exists:
  ```
  ⚠️  .backmail/ already exists in /home/jan/Projects/my-repo/
  ? Overwrite? (y/N): [default is No]
  ```
- If Git repo already exists:
  ```
  ? Git repository already initialized. Reinitialize? (y/N): [default is No]
  ```

**Pattern:**
- Always ask before overwriting
- Default to "No" (safe by default)
- Show what would be affected

**Confidence:** HIGH (git and gh both follow this)

#### 5. **Spinners for Long-Running Operations**
- IMAP credential test (if `--test-credentials` used)
- Git repo initialization (if large, though usually fast)
- Keyring operations (which can block briefly on some systems)

**Pattern:**
```
Testing IMAP credentials... ⠋
Testing IMAP credentials... ⠙
Testing IMAP credentials... ✓ Connected
```

**Library:** ora (standard in Node.js CLI ecosystem)

**Confidence:** MEDIUM (good practice; optional for v1.1 MVP)

#### 6. **Non-Interactive Mode Support**
```bash
backmail init \
  --name my-mailbox \
  --host imap.gmail.com \
  --user alice@gmail.com \
  --password "$PASSWORD" \
  --quiet
```

**Flags:**
- `--name <name>` → Repository name
- `--host <host>` → IMAP host
- `--user <user>` → IMAP user
- `--password <password>` → Password (can come from env var)
- `--port <port>` → IMAP port (optional, defaults to 993)
- `--quiet` → Suppress progress output, only show errors
- `--yes` / `-y` → Accept all prompts with defaults (even if some flags missing)
- `--test-credentials` → Test IMAP connection before finishing

**Rationale:**
- Enables scripting and CI/CD
- Flags take precedence over prompts
- Flags not provided → prompt interactively
- `--quiet` for automation pipelines where output is piped

**Confidence:** HIGH (npm, cargo, git all support this pattern)

---

## passwordRef / Credential Reference Patterns

### The Problem Being Solved

Config files (JSON/YAML) can't store secrets safely. Options:
1. ❌ Store password in plaintext in config.json → insecure
2. ❌ Store password only in memory → lost on restart
3. ✓ Reference a secret stored elsewhere (keyring, env var) → secure + discoverable

### Recommended Format: `keyring:service=X;account=Y`

**Syntax:** `"passwordRef": "keyring:service=backmail;account=alice@gmail.com"`

**Parsing rules:**
```
Format: "keyring:service=<service>;account=<account>"
- service: Logical service name (e.g., "backmail")
- account: Account identifier (e.g., email, username)
Example: "keyring:service=backmail;account=alice@gmail.com"
```

**Why this format:**
- **Self-documenting:** You can read the config and understand the reference without docs
- **Extensible:** Can add more backends later (e.g., `env:BACKMAIL_PASSWORD`, `vault:path/to/secret`)
- **Matches ecosystem:** Git uses `credential.helper` string format with similar conventions
- **Platform-independent:** Works on Windows (Credential Manager), macOS (Keychain), Linux (Secret Service)

**Confidence:** MEDIUM-HIGH (invented for backmail, but pattern aligns with kubectl, git; needs phase validation)

### Implementation: Keyring Access

**Node.js library recommendation:** `keytar` (npm)

**Why keytar:**
- Cross-platform (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- Well-maintained, used in VS Code and Electron apps
- Simple async API: `getPassword(service, account)`, `setPassword(service, account, password)`
- Type definitions included (TypeScript-safe)

**Modern alternative:** `@napi-rs/keyring` (newer, faster, 100% compatible with keytar API)

**Confidence:** HIGH (verified via npm and GitHub discussions)

### Fallback Chain (Resolution Order)

When backmail needs a password:

```
1. Check passwordRef in config
   - If "keyring:..." → Try keyring lookup (service, account)
   - If "env:VAR_NAME" → Try environment variable
   - If lookup fails → go to step 2

2. Environment variable BACKMAIL_PASSWORD
   - Use if set (no keyring access needed)

3. Prompt user
   - If both above failed, ask for password interactively
   - (Could offer to save to keyring)

4. Exit with error
   - If user cancels prompt
```

**Confidence:** MEDIUM (pattern is reasonable; exact UX needs phase validation)

### Error Handling: Keyring Unavailable

Scenarios where keyring access fails:
- No system keyring installed (Linux without GNOME Keyring / KDE Wallet)
- Headless environment (SSH session, CI runner)
- Keyring locked or uninitialized
- Permission denied (user doesn't have keyring access)

**Behavior:**
1. Try keyring lookup (if passwordRef is keyring:...)
2. If fails, check BACKMAIL_PASSWORD env var
3. If not set, suggest:
   ```
   ⚠️  Could not access system keyring.
   Set environment variable instead:
   export BACKMAIL_PASSWORD="your-password"
   ```
4. Then prompt for password if interactive mode

**Confidence:** MEDIUM (keyring failure modes are system-dependent; need phase testing)

### Config File Format

In `.backmail/config.json`:

```json
{
  "host": "imap.gmail.com",
  "port": 993,
  "user": "alice@gmail.com",
  "passwordRef": "keyring:service=backmail;account=alice@gmail.com",
  "folders": ["INBOX", "Sent Mail", "Drafts"],
  "archive": "archive",
  "worktrees": "worktrees"
}
```

**Not in config:**
- Actual password (always external)
- Sensitive credentials (always referenced)

**Stored in config:**
- Metadata about the reference (service name, account)
- IMAP connection parameters (non-sensitive)
- Folder list and archive locations

**Confidence:** HIGH (consistent with how git and kubectl structure their configs)

### Credential Provider Pattern (Like kubectl)

For future extensibility, adopt kubectl-style provider format:

```json
{
  "passwordProvider": {
    "name": "keyring",  // or "env", or "command"
    "config": {
      "service": "backmail",
      "account": "alice@gmail.com"
    }
  }
}
```

**Advantages:**
- Structured, not string-based
- Easier to validate and document
- Scales to complex providers (e.g., AWS Secrets Manager, HashiCorp Vault)

**Trade-off:**
- More verbose than `"keyring:service=X;account=Y"`
- Can support both formats (string for simplicity, object for advanced use)

**Confidence:** LOW (future extensibility; might be overengineering for v1.1)

**Recommendation for v1.1:** Use simple string format (`keyring:service=X;account=Y`); plan for object format in v2.

---

## Feature Dependency Graph

```
backmail init
├── Creates .backmail/ directory
├── Initializes git repo (archive/)
├── Prompts for IMAP credentials
│   ├── Stores password in keyring
│   └── Writes passwordRef to config
├── Writes config.json
└── (Optional) Tests IMAP connection

Repo auto-detection
├── Required by: sync, log, ls, view, checkout, restore
├── Enabled by: Walk-up search for .backmail/
└── Overridable by: --workdir flag

--workdir global flag
├── Overrides auto-detection
├── Applied to all commands
├── Takes precedence over auto-detected path
└── Example: backmail --workdir /path/to/repo sync
```

---

## Table Stakes: Feature Checklist for MVP

| Feature | Status | Notes |
|---------|--------|-------|
| **Init command** | Required | Must support interactive + non-interactive modes |
| **Directory structure creation** | Required | .backmail/, archive/, worktrees/ |
| **Git repo initialization** | Required | In archive/ subdirectory, main branch |
| **Interactive password prompt** | Required | Hidden input, confirmation |
| **Keyring storage** | Required | System keyring (macOS/Windows/Linux) |
| **passwordRef config field** | Required | Extensible format for credential references |
| **BACKMAIL_PASSWORD fallback** | Required | When keyring unavailable or headless |
| **Repo auto-detection** | Required | Walk-up search for .backmail/ from CWD |
| **--workdir global flag** | Required | Override auto-detection for all commands |
| **Init validation** | Required | IMAP host, email, port; sensible errors |
| **Transparent feedback** | Recommended | Progress indicators, success/error messages |
| **IMAP credential test** | Optional | `--test-credentials` flag, helpful but not MVP |
| **Confirmation before overwrite** | Recommended | Refuse to clobber existing .backmail/ |

---

## Pitfalls to Avoid

### Critical

1. **Storing password in config.json**
   - **Why it's bad:** Config files often end up in version control or are world-readable
   - **Prevention:** Always use passwordRef pointing to external storage
   - **Detection:** Code review check: no password field in config schema

2. **Repo auto-detection without fallback**
   - **Why it's bad:** Leads to confusing "file not found" errors when run from wrong directory
   - **Prevention:** Clear error message: "fatal: not a backmail repository (or any of the parent directories): .backmail/"
   - **Detection:** Test from subdirectories and outside repo

3. **Keyring lookup without env var fallback**
   - **Why it's bad:** Breaks in CI/CD, headless, or systems without keyring
   - **Prevention:** Always check BACKMAIL_PASSWORD before failing
   - **Detection:** Test in CI environment without keyring installed

### Moderate

4. **Overwriting existing config without confirmation**
   - **Why it's bad:** User loses custom configuration
   - **Prevention:** Always ask before `--force` overwrite
   - **Detection:** Run init twice, second time should ask

5. **Storing password in shell history**
   - **Why it's bad:** `backmail init --password mypassword` leaks to ~/.bash_history
   - **Prevention:** Accept password interactively only, never from CLI flag (except env var)
   - **Detection:** Don't expose `--password` flag; use `BACKMAIL_PASSWORD` env var instead

6. **Inconsistent error messages**
   - **Why it's bad:** Users don't know what went wrong or how to fix it
   - **Prevention:** Define error message standards upfront (see "Input Validation" section)
   - **Detection:** Review all error paths in code

---

## Confidence Assessment

| Area | Level | Rationale |
|------|-------|-----------|
| Init command patterns | HIGH | Verified via npm, cargo, git, gh documentation |
| Repo auto-detection | HIGH | Direct git precedent, well-documented |
| Interactive prompting | MEDIUM-HIGH | Ecosystem standards clear; exact UX needs phase validation |
| Keyring integration | MEDIUM | keytar library is solid; system keyring failures are environment-dependent |
| passwordRef format | MEDIUM | Pattern is sound; extensibility needs phase testing |
| Table stakes features | HIGH | Derived from ecosystem best practices |
| Error messages | MEDIUM | General principles clear; specific messages need user testing |

---

## Open Questions for Phase Implementation

1. **Init CLI flag support:** Should all IMAP connection parameters be CLI flags, or only some?
   - Options: Full (--host, --port, --user, --password, --name), Minimal (--name, --no-interactive), Hybrid
   - Recommendation: Full support for scripting; interactive mode when flags missing

2. **Keyring service naming:** Use fixed "backmail" or per-account?
   - `keyring:service=backmail;account=alice@gmail.com` (current recommendation)
   - `keyring:service=alice-gmail;account=alice@gmail.com` (per-account)
   - Recommendation: Fixed "backmail" service, account identifies the specific mailbox

3. **Password confirmation in init:** Re-prompt to confirm (reduce typos) or trust user?
   - Recommendation: Always confirm, especially since password is hidden

4. **IMAP credential validation:** Test connection during init, or trust user and fail on sync?
   - Recommendation: Optional `--test-credentials` flag (helpful for troubleshooting, not MVP)

5. **Symlink handling in auto-detection:** Resolve symlinks before walking up?
   - Recommendation: Yes, resolve to avoid confusion (git pattern)

6. **Filesystem boundary detection:** Stop at mount points or only at root?
   - Recommendation: Only at root for v1.1 (can enhance later if needed)

---

## Sources

- [Git - git-init Documentation](https://git-scm.com/docs/git-init)
- [Git - git Documentation](https://git-scm.com/docs/git)
- [Git - gitcredentials Documentation](https://git-scm.com/docs/gitcredentials)
- [GitHub CLI (gh): Practical Patterns for PRs, Issues, and API](https://32blog.com/en/cli/cli-github-cli-gh)
- [Command Line Interface Guidelines](https://clig.dev/)
- [Best Practices Building a CLI Tool for Your Service - Zapier](https://zapier.com/engineering/how-to-cli/)
- [UX patterns for CLI tools](https://www.lucasfcosta.com/blog/ux-patterns-cli-tools)
- [npm-init | npm Docs](https://docs.npmjs.com/cli/v11/commands/npm-init/)
- [cargo init - The Cargo Book](https://doc.rust-lang.org/cargo/commands/cargo-init.html)
- [Inquirer Node.js: Complete Guide to Interactive CLI Prompts](https://copyprogramming.com/howto/inquirer-on-node-js)
- [@inquirer/prompts - npm](https://www.npmjs.com/package/@inquirer/prompts)
- [keytar - npm](https://www.npmjs.com/package/keytar)
- [GitHub - atom/node-keytar: Native Password Node Module](https://github.com/atom/node-keytar)
- [How to securely store sensitive information in Electron with node-keytar](https://cameronnokes.com/blog/how-to-securely-store-sensitive-information-in-electron-with-node-keytar/)
- [Keyring Node.js binding - GitHub](https://github.com/Brooooooklyn/keyring-node)
- [OAuth token in encrypted keychain discussion - cli/cli](https://github.com/cli/cli/discussions/8980)
- [Configure secure credential storage - Zowe Docs](https://docs.zowe.org/v3.2.x/user-guide/cli-configure-scs-on-headless-linux-os/)
- [Best Practices for Environment-Specific Configurations](https://onenine.com/best-practices-for-environment-specific-configurations/)
- [Storing credentials the right way!](https://medium.com/developer-secrets/storing-credentials-the-right-way-78074ae21727)
- [CLI Reference | Supabase Docs](https://supabase.com/docs/reference/cli/global-flags)
- [GitHub - joeyates/imap-backup: Backup and Migrate IMAP Email Accounts](https://github.com/joeyates/imap-backup)
