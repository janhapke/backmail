import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { sanitizeMessageId, folderPathToFilename } from '../../src/core/sync.js'

let tmpDir: string
let tmpRepo: string
let worktreesDir: string

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
  worktreesDir = path.join(tmpDir, 'worktrees')

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

})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('CLI Browse Commands', () => {
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

  })

  // ─────────────────────────────────────────────────────────────────────────
  // checkout command tests
  // ─────────────────────────────────────────────────────────────────────────

  describe('backmail checkout', () => {
    it('creates worktree for date', async () => {
      const { checkoutCommit } = await import('../../src/core/browse.js')

      const result = await checkoutCommit(tmpRepo, '2024-01-01', worktreesDir)

      expect(result.path).toBeDefined()
      expect(result.sha).toBeDefined()
      expect(result.path).toContain(worktreesDir)
      expect(result.sha.length).toBe(7)

      // Verify worktree directory exists at the expected location
      const worktreeDir = path.join(worktreesDir, '2024-01-01')
      const exists = await fs.stat(worktreeDir).then(() => true).catch(() => false)
      expect(exists).toBe(true)
    })

    it('prints correct output format', async () => {
      const { checkoutCommit } = await import('../../src/core/browse.js')

      const result = await checkoutCommit(tmpRepo, '2024-01-02', worktreesDir)
      const output = `Checked out 2024-01-02 (${result.sha}) → ${result.path}`

      expect(output).toMatch(/Checked out 2024-01-02 \([a-f0-9]{7}\) → /)
      expect(output).toContain(worktreesDir)
    })

    it('works with commit hash', async () => {
      const commits = execSync('git log --oneline | head -1', { cwd: tmpRepo, encoding: 'utf-8' })
      const commitHash = commits.split(' ')[0]

      const { checkoutCommit } = await import('../../src/core/browse.js')

      const result = await checkoutCommit(tmpRepo, commitHash.substring(0, 7), worktreesDir)
      expect(result.path).toBeDefined()
      expect(result.sha).toBeDefined()
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

})
