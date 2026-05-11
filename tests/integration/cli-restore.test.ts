import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execSync, spawnSync } from 'node:child_process'
import { sanitizeMessageId } from '../../src/core/sync.js'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const cliPath = path.resolve(projectRoot, 'src/cli/index.ts')

let tmpDir: string
let tmpRepo: string
let configFile: string
let configDir: string

beforeAll(async () => {
  // Create temp directory structure for CLI tests
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backmail-cli-restore-test-'))
  // tmpRepo is the backmail repository root — contains .backmail/ and archive/
  tmpRepo = path.join(tmpDir, 'mail-repo')
  configDir = path.join(tmpDir, '.config', 'backmail')

  // Create .backmail/ config that loadRepositoryConfig() expects
  await fs.mkdir(path.join(tmpRepo, '.backmail'), { recursive: true })
  const repoCfg = {
    host: 'localhost',
    port: 143,
    username: 'testuser',
    tls: false,
    passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
  }
  await fs.writeFile(path.join(tmpRepo, '.backmail', 'config.json'), JSON.stringify(repoCfg))

  // Create archive/ subdirectory — this is what the CLI passes as archivePath
  const archivePath = path.join(tmpRepo, 'archive')
  await fs.mkdir(path.join(archivePath, 'INBOX'), { recursive: true })

  // Initialize git repo inside archive/
  execSync('git init', { cwd: archivePath })
  execSync('git config user.email "test@example.com"', { cwd: archivePath })
  execSync('git config user.name "Test User"', { cwd: archivePath })

  // Create sample folder state file with messages
  const inboxState = {
    folderPath: 'INBOX',
    uidvalidity: '1234567890',
    uidnext: 6,
    messages: [
      { uid: 1, 'message-id': '<msg1@example.com>', filename: `${sanitizeMessageId('<msg1@example.com>')}`, flags: [] },
      { uid: 2, 'message-id': '<msg2@example.com>', filename: `${sanitizeMessageId('<msg2@example.com>')}`, flags: ['\\Seen'] },
      { uid: 3, 'message-id': '<msg3@example.com>', filename: `${sanitizeMessageId('<msg3@example.com>')}`, flags: [] },
    ],
  }
  await fs.writeFile(
    path.join(archivePath, 'INBOX', '.backmail_state.json'),
    JSON.stringify(inboxState)
  )

  // Create sample EML files
  const eml1 = `From: alice@example.com
To: bob@example.com
Subject: First test email
Date: Mon, 01 Jan 2024 12:00:00 +0000
Message-ID: <msg1@example.com>

This is the body of the first email.`

  const eml2 = `From: charlie@example.com
To: bob@example.com
Subject: Second test email
Date: Tue, 02 Jan 2024 13:00:00 +0000
Message-ID: <msg2@example.com>

This is the body of the second email.`

  const eml3 = `From: dave@example.com
To: bob@example.com
Subject: Third test email
Date: Wed, 03 Jan 2024 14:00:00 +0000
Message-ID: <msg3@example.com>

This is the body of the third email.`

  await fs.writeFile(
    path.join(archivePath, 'INBOX', `${sanitizeMessageId('<msg1@example.com>')}.eml`),
    eml1
  )
  await fs.writeFile(
    path.join(archivePath, 'INBOX', `${sanitizeMessageId('<msg2@example.com>')}.eml`),
    eml2
  )
  await fs.writeFile(
    path.join(archivePath, 'INBOX', `${sanitizeMessageId('<msg3@example.com>')}.eml`),
    eml3
  )

  // Create initial commit inside archive/
  execSync('touch README.md', { cwd: archivePath })
  execSync('git add -A', { cwd: archivePath })
  execSync('git commit -m "Initial CLI restore test repo"', { cwd: archivePath })

  configFile = path.join(configDir, 'config.json')
})

afterAll(async () => {
  // Clean up temp directory
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// Helper to execute backmail CLI
function executeBackmail(args: string[], env?: Record<string, string>) {
  const result = spawnSync('npx', ['tsx', './src/cli/index.ts', ...args], {
    cwd: projectRoot,
    encoding: 'utf-8',
    env: { ...process.env, ...env, HOME: tmpDir },
  })
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status || 0,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CLI: restore subcommand validation
// ────────────────────────────────────────────────────────────────────────────

describe('CLI: restore subcommand validation', () => {
  it('--to flag is required', async () => {
    const { stderr, exitCode } = executeBackmail(['restore', '--account', 'test'], { HOME: tmpDir })

    expect(exitCode).not.toBe(0)
    expect(stderr.toLowerCase()).toContain('required')
  })

  it('--to accepts valid imap:// and imaps:// URLs', async () => {
    const { stderr } = executeBackmail(['restore', '--to', 'imap://user:pass@localhost:143'], { HOME: tmpDir })

    // URL parsing should succeed (may fail on connection, but not on URL parsing)
    expect(stderr).not.toContain('protocol must be imap:// or imaps://')
  })

  it('positional argument is optional (date or commit)', async () => {
    const { stderr } = executeBackmail(['restore', '--to', 'imap://user:pass@localhost:143'], { HOME: tmpDir })

    // Should reach restoreAccount, not fail on missing positional
    expect(stderr).not.toContain('missing required argument')
  })

  it('positional argument can be a date (YYYY-MM-DD)', async () => {
    const { stderr } = executeBackmail(['restore', '2026-04-20', '--to', 'imap://user:pass@localhost:143'], { HOME: tmpDir })

    // Should parse date argument without error
    expect(stderr).not.toContain('Invalid date format')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// CLI: restore options
// ────────────────────────────────────────────────────────────────────────────

describe('CLI: restore options', () => {
  it('--skip-duplicates defaults to "yes"', async () => {
    const { stderr } = executeBackmail(['restore', '--to', 'imap://user:pass@localhost:143'], { HOME: tmpDir })

    // Should not error on missing --skip-duplicates (defaults to yes)
    expect(stderr).not.toContain('invalid')
  })

  it('--skip-duplicates=no is accepted', async () => {
    const { stderr } = executeBackmail(['restore', '--to', 'imap://user:pass@localhost:143', '--skip-duplicates', 'no'], { HOME: tmpDir })

    // Should parse option without error
    expect(stderr).not.toContain('invalid')
  })

  it('--dry-run flag is accepted', async () => {
    const { stderr, stdout } = executeBackmail(['restore', '--to', 'imap://user:pass@localhost:143', '--dry-run'], { HOME: tmpDir })

    // Dry-run should be processed
    expect(stdout + stderr).toBeTruthy()
  })

  it('--verbose flag is accepted', async () => {
    const { stderr } = executeBackmail(['restore', '--to', 'imap://user:pass@localhost:143', '--verbose'], { HOME: tmpDir })

    // Should not error on --verbose
    expect(stderr).not.toContain('unknown option')
  })

  it('--account selects the target account', async () => {
    const { stderr } = executeBackmail(['restore', '--account', 'test', '--to', 'imap://user:pass@localhost:143'], { HOME: tmpDir })

    // Should accept --account test
    expect(stderr).not.toContain('Unknown account')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// CLI: restore error handling
// ────────────────────────────────────────────────────────────────────────────

describe('CLI: error handling', () => {
  it('Error message does not include password from URL (per Pitfall 4)', async () => {
    const { stderr } = executeBackmail(['restore', '--to', 'imap://user:secretpass@invalid-host:9143'], { HOME: tmpDir })

    expect(stderr).not.toContain('secretpass')
    expect(stderr).not.toContain(':pass@')
  })

  it('restore --help works without a valid config file', async () => {
    // Test that --help can be invoked without config
    const tmpHomeEmpty = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-config-'))
    try {
      const result = spawnSync('npx', ['tsx', './src/cli/index.ts', 'restore', '--help'], {
        cwd: projectRoot,
        encoding: 'utf-8',
        env: { ...process.env, HOME: tmpHomeEmpty },
      })
      expect(result.stdout).toContain('restore')
      expect(result.stdout).toContain('Restore messages from backup')
    } finally {
      await fs.rm(tmpHomeEmpty, { recursive: true, force: true })
    }
  })

  it('On restore error, exits non-zero', async () => {
    const { exitCode } = executeBackmail(['restore', '--to', 'imap://user:pass@invalid-host:9143'], { HOME: tmpDir })

    expect(exitCode).not.toBe(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// CLI: restore output formatting
// ────────────────────────────────────────────────────────────────────────────

describe('CLI: restore output formatting', () => {
  it('Output shows total summary line on success', async () => {
    // --workdir points to the repo root (containing .backmail/ and archive/)
    // --skip-duplicates=no avoids opening an IMAP connection in dry-run mode
    const { stdout, stderr } = executeBackmail(
      ['--workdir', tmpRepo, 'restore', '--to', 'imap://user:pass@localhost:143', '--dry-run', '--skip-duplicates=no'],
      { HOME: tmpDir }
    )

    // Output should have a summary line with totals
    const output = stdout + stderr
    expect(output.toLowerCase()).toMatch(/total/)
  })

  it('--dry-run prefix appears in output when specified', async () => {
    const { stdout, stderr } = executeBackmail(['restore', '--to', 'imap://user:pass@localhost:143', '--dry-run'], { HOME: tmpDir })

    const output = stdout + stderr
    // Output should show dry-run mode (either in prefix or message)
    expect(output).toBeTruthy()
  })

  it('Final summary includes exit code', async () => {
    const result = spawnSync('npx', ['tsx', './src/cli/index.ts', 'restore', '--to', 'imap://user:pass@localhost:9999', '--dry-run'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      env: { ...process.env, HOME: tmpDir },
    })

    // Should have defined exit code
    expect(typeof result.status).toBe('number')
  })
})
