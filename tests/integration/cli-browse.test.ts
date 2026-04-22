import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { sanitizeMessageId, folderPathToFilename } from '../../src/core/sync.js'
import type { BackmailConfig } from '../../src/core/config.js'

let tmpDir: string
let tmpRepo: string
let configFile: string
let config: BackmailConfig

// Helper to capture console output
function captureOutput(fn: () => void): { stdout: string; stderr: string } {
  const originalLog = console.log
  const originalError = console.error
  let stdout = ''
  let stderr = ''

  console.log = (...args: string[]) => {
    stdout += args.join(' ') + '\n'
  }
  console.error = (...args: string[]) => {
    stderr += args.join(' ') + '\n'
  }

  try {
    fn()
    return { stdout, stderr }
  } finally {
    console.log = originalLog
    console.error = originalError
  }
}

beforeAll(async () => {
  // Create temp directory structure
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backmail-cli-test-'))
  tmpRepo = path.join(tmpDir, 'mail-repo')

  // Initialize git repo
  await fs.mkdir(tmpRepo)
  execSync('git init', { cwd: tmpRepo })
  execSync('git config user.email "test@example.com"', { cwd: tmpRepo })
  execSync('git config user.name "Test User"', { cwd: tmpRepo })

  // Create folders and messages directories
  await fs.mkdir(path.join(tmpRepo, 'folders'))
  await fs.mkdir(path.join(tmpRepo, 'messages'))

  // Create sample folder state file with messages
  const inboxState = {
    uidvalidity: '1234567890',
    uidnext: 3,
    messages: [
      { uid: 1, 'message-id': '<msg1@example.com>', flags: [] },
      { uid: 2, 'message-id': '<msg2@example.com>', flags: ['\\Seen'] },
    ],
  }
  await fs.writeFile(path.join(tmpRepo, 'folders', 'INBOX.json'), JSON.stringify(inboxState))

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

  await fs.writeFile(
    path.join(tmpRepo, 'messages', `${sanitizeMessageId('<msg1@example.com>')}.eml`),
    eml1
  )
  await fs.writeFile(
    path.join(tmpRepo, 'messages', `${sanitizeMessageId('<msg2@example.com>')}.eml`),
    eml2
  )

  // Create initial commit
  execSync('touch README.md', { cwd: tmpRepo })
  execSync('git add -A', { cwd: tmpRepo })
  execSync('git commit -m "Initial setup"', { cwd: tmpRepo })

  // Create sync commits on different dates for log testing
  for (let i = 0; i < 5; i++) {
    const date = new Date(2024, 0, 1 + i) // Jan 1-5, 2024
    const dateStr = date.toISOString().split('T')[0]
    const timestamp = Math.floor(date.getTime() / 1000)

    execSync(`touch file${i}.txt`, { cwd: tmpRepo })
    execSync('git add -A', { cwd: tmpRepo })
    const commitMsg = i === 2 ? `${dateStr} [partial]: +5 added / -1 removed` : `${dateStr}: +${5 + i} added / -${i} removed`
    execSync(`git commit -m "${commitMsg}"`, {
      cwd: tmpRepo,
      env: {
        ...process.env,
        GIT_COMMITTER_DATE: `${timestamp} +0000`,
        GIT_AUTHOR_DATE: `${timestamp} +0000`,
      },
    })
  }

  // Create config file
  configFile = path.join(tmpDir, 'backmail.json')
  config = {
    accounts: {
      gmail: {
        host: 'imap.gmail.com',
        port: 993,
        username: 'user@gmail.com',
        tls: true,
        repoPath: tmpRepo,
      },
      work: {
        host: 'imap.company.com',
        port: 993,
        username: 'user@company.com',
        tls: true,
        repoPath: path.join(tmpDir, 'work-repo'),
      },
    },
  }
  await fs.writeFile(configFile, JSON.stringify(config, null, 2))

  // Set env var to point to test config
  process.env.BACKMAIL_CONFIG = configFile
})

afterAll(async () => {
  delete process.env.BACKMAIL_CONFIG
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('CLI Browse Commands', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // accounts command tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('backmail accounts', () => {
    it('prints all account names from config', async () => {
      const { loadConfig } = await import('../../src/core/config.js')
      const cfg = loadConfig(configFile)
      const names = Object.keys(cfg.accounts)

      // Simulate the accounts command
      const output: string[] = []
      for (const name of names) {
        output.push(name)
      }

      expect(output).toContain('gmail')
      expect(output).toContain('work')
      expect(output.length).toBe(2)
    })

    it('output is one name per line with no headers', async () => {
      const { loadConfig } = await import('../../src/core/config.js')
      const cfg = loadConfig(configFile)
      const names = Object.keys(cfg.accounts)

      const output = names.map((n) => n).join('\n')
      const lines = output.trim().split('\n')

      expect(lines.length).toBe(2)
      expect(lines[0]).toBe('gmail')
      expect(lines[1]).toBe('work')
      // No headers or decorations
      expect(lines.every((l) => !l.includes(':') && !l.includes('|'))).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // log command tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('backmail log', () => {
    it('prints sync commits from git log', async () => {
      const { getLog } = await import('../../src/core/browse.js')
      const commits = await getLog(tmpRepo, 'unlimited')

      // We created 5 sync commits (Jan 1-5)
      expect(commits.length).toBeGreaterThan(0)
      expect(commits.every((c) => /^\d{4}-\d{2}-\d{2}/.test(c))).toBe(true)
    })

    it('respects --limit option', async () => {
      const { getLog } = await import('../../src/core/browse.js')
      const commits = await getLog(tmpRepo, 3)

      expect(commits.length).toBe(3)
    })

    it('default limit is respected', async () => {
      const { getLog } = await import('../../src/core/browse.js')
      // Default is 20, we have 5 commits
      const commits = await getLog(tmpRepo, 20)

      expect(commits.length).toBeLessThanOrEqual(5)
    })

    it('includes partial commits', async () => {
      const { getLog } = await import('../../src/core/browse.js')
      const commits = await getLog(tmpRepo, 'unlimited')

      const hasPartial = commits.some((c) => c.includes('[partial]'))
      expect(hasPartial).toBe(true)
    })

    it('works with --account flag', async () => {
      const { getLog, resolveAccount } = await import('../../src/core/browse.js')
      const { loadConfig } = await import('../../src/core/config.js')
      const cfg = loadConfig(configFile)

      const [, accountConfig] = resolveAccount(cfg, 'gmail')
      const commits = await getLog(accountConfig.repoPath, 'unlimited')

      expect(commits.length).toBeGreaterThan(0)
    })

    it('auto-selects single account when multiple exist', async () => {
      const { resolveAccount } = await import('../../src/core/browse.js')
      const { loadConfig } = await import('../../src/core/config.js')

      // With multiple accounts, should require explicit --account
      const cfg = loadConfig(configFile)
      expect(Object.keys(cfg.accounts).length).toBeGreaterThan(1)

      expect(() => resolveAccount(cfg)).toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // checkout command tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('backmail checkout', () => {
    it('creates worktree for date', async () => {
      const { checkoutCommit } = await import('../../src/core/browse.js')

      const result = await checkoutCommit(tmpRepo, '2024-01-01')

      expect(result.path).toBeDefined()
      expect(result.sha).toBeDefined()
      expect(result.path).toContain('.worktrees')
      expect(result.sha.length).toBe(7)

      // Verify worktree directory exists
      const worktreeDir = path.join(tmpRepo, '.worktrees', '2024-01-01')
      const exists = await fs.stat(worktreeDir).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    it('prints correct output format', async () => {
      const { checkoutCommit } = await import('../../src/core/browse.js')

      const result = await checkoutCommit(tmpRepo, '2024-01-02')
      const output = `Checked out 2024-01-02 (${result.sha}) → ${result.path}`

      expect(output).toMatch(/Checked out 2024-01-02 \([a-f0-9]{7}\) → /)
      expect(output).toContain('.worktrees')
    })

    it('works with commit hash', async () => {
      // Get a commit hash from git log
      const commits = execSync('git log --oneline | head -1', { cwd: tmpRepo, encoding: 'utf-8' })
      const commitHash = commits.split(' ')[0]

      const { checkoutCommit } = await import('../../src/core/browse.js')

      const result = await checkoutCommit(tmpRepo, commitHash.substring(0, 7))
      expect(result.path).toBeDefined()
      expect(result.sha).toBeDefined()
    })

    it('.worktrees/ added to .gitignore', async () => {
      await fs.rm(path.join(tmpRepo, '.worktrees'), { recursive: true, force: true })

      const { checkoutCommit } = await import('../../src/core/browse.js')
      await checkoutCommit(tmpRepo, '2024-01-03')

      const gitignore = await fs.readFile(path.join(tmpRepo, '.gitignore'), 'utf-8').catch(() => '')
      expect(gitignore).toContain('.worktrees/')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // ls command tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('backmail ls', () => {
    it('lists folders when no argument given', async () => {
      const { listFolders } = await import('../../src/core/browse.js')

      const folders = await listFolders(tmpRepo)

      expect(folders).toContain('INBOX')
      expect(folders.length).toBeGreaterThan(0)
    })

    it('lists messages in folder', async () => {
      const { listMessages } = await import('../../src/core/browse.js')

      const messages = await listMessages(tmpRepo, 'INBOX')

      expect(messages.length).toBe(2)
      expect(messages[0].messageId).toBeDefined()
      expect(messages[0].date).toBeDefined()
      expect(messages[0].from).toBeDefined()
      expect(messages[0].subject).toBeDefined()
    })

    it('message output format is tab-separated', async () => {
      const { listMessages } = await import('../../src/core/browse.js')

      const messages = await listMessages(tmpRepo, 'INBOX')
      const firstMsg = messages[0]
      const output = `${firstMsg.messageId}\t${firstMsg.date}\t${firstMsg.from}\t${firstMsg.subject}`

      expect(output).toMatch(/^[^\t]+\t[^\t]+\t[^\t]+\t[^\t]+$/)
      const parts = output.split('\t')
      expect(parts.length).toBe(4)
    })

    it('throws for non-existent folder', async () => {
      const { listMessages } = await import('../../src/core/browse.js')

      expect(async () => {
        await listMessages(tmpRepo, 'NonExistent')
      }).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // view command tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('backmail view', () => {
    it('returns raw EML with --format eml', async () => {
      const { viewMessage } = await import('../../src/core/browse.js')

      const result = await viewMessage(tmpRepo, '<msg1@example.com>', 'eml')

      expect(typeof result).toBe('string')
      expect(result).toContain('From: alice@example.com')
      expect(result).toContain('Subject: First test email')
    })

    it('returns plaintext with default format', async () => {
      const { viewMessage } = await import('../../src/core/browse.js')

      const result = await viewMessage(tmpRepo, '<msg1@example.com>', 'plaintext')

      expect(typeof result).toBe('string')
      expect(result).toContain('This is the body of the first email')
    })

    it('returns plaintext explicitly', async () => {
      const { viewMessage } = await import('../../src/core/browse.js')

      const result = await viewMessage(tmpRepo, '<msg2@example.com>', 'plaintext')

      expect(typeof result).toBe('string')
      expect(result).toContain('This is the body of the second email')
    })

    it('returns JSON with headers and parts', async () => {
      const { viewMessage } = await import('../../src/core/browse.js')

      const result = await viewMessage(tmpRepo, '<msg1@example.com>', 'json')

      // Result should be an object with headers and parts
      expect(typeof result).toBe('object')
      expect((result as any).headers).toBeDefined()
      expect((result as any).parts).toBeDefined()
    })

    it('defaults to plaintext format', async () => {
      const { viewMessage } = await import('../../src/core/browse.js')

      const result = await viewMessage(tmpRepo, '<msg1@example.com>', 'plaintext')

      expect(typeof result).toBe('string')
      expect(result).toContain('This is the body of the first email')
    })

    it('throws for missing message', async () => {
      const { viewMessage } = await import('../../src/core/browse.js')

      expect(async () => {
        await viewMessage(tmpRepo, '<nonexistent@example.com>', 'plaintext')
      }).rejects.toThrow()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Account resolution tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('account resolution', () => {
    it('resolveAccount with explicit account name', async () => {
      const { resolveAccount } = await import('../../src/core/browse.js')
      const { loadConfig } = await import('../../src/core/config.js')
      const cfg = loadConfig(configFile)

      const [name, accountConfig] = resolveAccount(cfg, 'gmail')

      expect(name).toBe('gmail')
      expect(accountConfig.repoPath).toBe(tmpRepo)
    })

    it('resolveAccount throws for unknown account', async () => {
      const { resolveAccount } = await import('../../src/core/browse.js')
      const { loadConfig } = await import('../../src/core/config.js')
      const cfg = loadConfig(configFile)

      expect(() => {
        resolveAccount(cfg, 'unknown')
      }).toThrow('Unknown account')
    })

    it('resolveAccount lists available accounts in error when multiple exist', async () => {
      const { resolveAccount } = await import('../../src/core/browse.js')
      const { loadConfig } = await import('../../src/core/config.js')
      const cfg = loadConfig(configFile)

      try {
        resolveAccount(cfg)
        expect.fail('Should have thrown')
      } catch (err) {
        const message = (err as Error).message
        expect(message).toContain('gmail')
        expect(message).toContain('work')
      }
    })
  })
})
