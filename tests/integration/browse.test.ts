import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import {
  getLog,
  checkoutCommit,
  listFolders,
  listMessages,
  viewMessage,
} from '../../src/core/browse.js'

let tmpRepo: string

beforeAll(async () => {
  // Create tmp directory for browse test repo
  tmpRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'backmail-browse-test-'))

  // Initialize git repo
  execSync('git init', { cwd: tmpRepo })
  execSync('git config user.email "test@example.com"', { cwd: tmpRepo })
  execSync('git config user.name "Test User"', { cwd: tmpRepo })

  // Create folders and messages directories
  await fs.mkdir(path.join(tmpRepo, 'folders'))
  await fs.mkdir(path.join(tmpRepo, 'messages'))

  // Create sample folder state file
  const inboxState = {
    uidvalidity: '1234567890',
    uidnext: 3,
    messages: [
      { uid: 1, 'message-id': '<msg1@example.com>', filename: 'fixture-msg1', flags: [] },
      { uid: 2, 'message-id': '<msg2@example.com>', filename: 'fixture-msg2', flags: ['\\Seen'] },
    ],
  }
  await fs.writeFile(
    path.join(tmpRepo, 'folders', 'INBOX.json'),
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

  await fs.writeFile(path.join(tmpRepo, 'messages', 'fixture-msg1.eml'), eml1)
  await fs.writeFile(path.join(tmpRepo, 'messages', 'fixture-msg2.eml'), eml2)

  // Create initial commit
  execSync('touch README.md', { cwd: tmpRepo })
  execSync('git add -A', { cwd: tmpRepo })
  execSync('git commit -m "Initial setup"', { cwd: tmpRepo })

  // Create sync commits on different dates
  for (let i = 0; i < 3; i++) {
    // Use GIT_COMMITTER_DATE to set commit date
    const date = new Date(2024, 0, 1 + i) // Jan 1, 2, 3
    const dateStr = date.toISOString().split('T')[0]
    const dateTime = `${dateStr} 12:00:00`
    const timestamp = date.getTime() / 1000

    execSync(`touch file${i}.txt`, { cwd: tmpRepo })
    execSync('git add -A', { cwd: tmpRepo })
    const commitMsg = i === 1 ? `${dateStr} [partial]: +5 added / -1 removed` : `${dateStr}: +${5 + i} added / -${i} removed`
    execSync(
      `git commit -m "${commitMsg}"`,
      {
        cwd: tmpRepo,
        env: {
          ...process.env,
          GIT_COMMITTER_DATE: `${timestamp} +0000`,
          GIT_AUTHOR_DATE: `${timestamp} +0000`,
        },
      }
    )
  }
})

afterAll(async () => {
  // Clean up tmp directory
  try {
    await fs.rm(tmpRepo, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

// ────────────────────────────────────────────────────────────────────────────
// Browse Integration Tests
// ────────────────────────────────────────────────────────────────────────────

describe('getLog integration', () => {
  it('retrieves actual git commits from test repo', async () => {
    const result = await getLog(tmpRepo, 20)
    expect(result.length).toBeGreaterThan(0)
    expect(result[0]).toMatch(/^\d{4}-\d{2}-\d{2}/)
    expect(result[0]).toContain('added')
    expect(result[0]).toContain('removed')
  })

  it('limits to N commits', async () => {
    const result = await getLog(tmpRepo, 1)
    expect(result.length).toBeLessThanOrEqual(1)
  })

  it('filters to sync format only', async () => {
    const result = await getLog(tmpRepo, 20)
    // All should match sync format
    const syncPattern = /^\d{4}-\d{2}-\d{2}(\s\[partial\])?:\s+\+\d+\s+added\s+\/\s+-\d+\s+removed$/
    for (const msg of result) {
      expect(msg).toMatch(syncPattern)
    }
  })

  it('handles unlimited correctly', async () => {
    const resultLimited = await getLog(tmpRepo, 1)
    const resultUnlimited = await getLog(tmpRepo, 'unlimited')
    expect(resultUnlimited.length).toBeGreaterThanOrEqual(resultLimited.length)
  })

  it('includes partial commits', async () => {
    const result = await getLog(tmpRepo, 20)
    const hasPartial = result.some((msg) => msg.includes('[partial]'))
    expect(hasPartial).toBe(true)
  })
})

describe('listFolders integration', () => {
  it('lists folders from folders/*.json files', async () => {
    const result = await listFolders(tmpRepo)
    expect(result).toContain('INBOX')
  })

  it('strips .json extension correctly', async () => {
    const result = await listFolders(tmpRepo)
    expect(result[0]).not.toMatch(/\.json$/)
  })
})

describe('listMessages integration', () => {
  it('lists messages with parsed headers', async () => {
    const result = await listMessages(tmpRepo, 'INBOX')
    expect(result).toHaveLength(2)
    expect(result[0].messageId).toBe('<msg1@example.com>')
    expect(result[0].from).toBe('alice@example.com')
    expect(result[0].subject).toBe('First test email')
    expect(result[1].from).toBe('charlie@example.com')
  })

  it('throws for non-existent folder', async () => {
    await expect(listMessages(tmpRepo, 'NonExistent')).rejects.toThrow(
      /Folder not found/
    )
  })
})

describe('viewMessage integration', () => {
  it('retrieves raw EML', async () => {
    const result = await viewMessage(tmpRepo, 'fixture-msg1', 'eml')
    expect(result).toContain('From: alice@example.com')
    expect(result).toContain('First test email')
    expect(result).toContain('This is the body of the first email')
  })

  it('extracts plaintext (default format)', async () => {
    const result = await viewMessage(tmpRepo, 'fixture-msg1')
    expect(result).toContain('This is the body of the first email')
  })

  it('extracts plaintext explicitly', async () => {
    const result = await viewMessage(tmpRepo, 'fixture-msg2', 'plaintext')
    expect(result).toContain('This is the body of the second email')
  })

  it('returns JSON with headers and parts', async () => {
    const result = (await viewMessage(tmpRepo, 'fixture-msg1', 'json')) as Record<
      string,
      unknown
    >
    expect(result.headers).toBeDefined()
    expect(result.parts).toBeDefined()
    const headers = result.headers as Record<string, string>
    expect(headers['from']).toContain('alice@example.com')
    expect(headers['subject']).toBe('First test email')
  })
})

describe('checkoutCommit integration', () => {
  let worktreesDir: string

  beforeAll(async () => {
    worktreesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backmail-worktrees-'))
  })

  afterAll(async () => {
    await fs.rm(worktreesDir, { recursive: true, force: true })
  })

  it('creates worktree in the given worktreesDir', async () => {
    const log = await getLog(tmpRepo, 1)
    expect(log.length).toBeGreaterThan(0)
    const dateMatch = log[0]?.match(/^(\d{4}-\d{2}-\d{2})/)
    expect(dateMatch).toBeTruthy()
    const date = dateMatch![1]

    const result = await checkoutCommit(tmpRepo, date, worktreesDir)
    expect(result.path).toContain(worktreesDir)
    expect(result.sha).toHaveLength(7)
  })
})
