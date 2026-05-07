import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { MessageSummary } from '../../src/core/index.js'
import {
  getLog,
  checkoutCommit,
  listFolders,
  listMessages,
  viewMessage,
} from '../../src/core/browse.js'
import { sanitizeMessageId } from '../../src/core/sync.js'

// ── getLog Tests ──────────────────────────────────────────────────────────────

describe('getLog', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browse-test-'))
  })

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true })
    } catch {
      // ignore cleanup errors
    }
  })

  it('returns empty array when repo has no sync commits', async () => {
    // Create a git repo with a non-sync commit
    const { execSync } = await import('node:child_process')
    execSync('git init', { cwd: tempDir })
    execSync('git config user.email "test@example.com"', { cwd: tempDir })
    execSync('git config user.name "Test"', { cwd: tempDir })
    execSync('touch README.md && git add README.md', { cwd: tempDir })
    execSync('git commit -m "Initial commit"', { cwd: tempDir })

    const result = await getLog(tempDir, 20)
    expect(result).toEqual([])
  })

  it('filters to sync format only', async () => {
    const { execSync } = await import('node:child_process')
    execSync('git init', { cwd: tempDir })
    execSync('git config user.email "test@example.com"', { cwd: tempDir })
    execSync('git config user.name "Test"', { cwd: tempDir })

    // Create non-sync commit
    execSync('touch file1.txt && git add file1.txt', { cwd: tempDir })
    execSync('git commit -m "Random commit"', { cwd: tempDir })

    // Create sync commit
    execSync('touch file2.txt && git add file2.txt', { cwd: tempDir })
    execSync('git commit -m "2026-04-22: +5 added / -2 removed"', { cwd: tempDir })

    const result = await getLog(tempDir, 20)
    expect(result.length).toBe(1)
    expect(result[0]).toContain('2026-04-22')
    expect(result[0]).toContain('+5 added')
  })

  it('respects maxCount limit', async () => {
    const { execSync } = await import('node:child_process')
    execSync('git init', { cwd: tempDir })
    execSync('git config user.email "test@example.com"', { cwd: tempDir })
    execSync('git config user.name "Test"', { cwd: tempDir })

    // Create 5 sync commits
    for (let i = 0; i < 5; i++) {
      execSync(`touch file${i}.txt && git add file${i}.txt`, { cwd: tempDir })
      execSync(
        `git commit -m "2026-04-${String(20 + i).padStart(2, '0')}: +1 added / -0 removed"`,
        { cwd: tempDir }
      )
    }

    const result = await getLog(tempDir, 2)
    expect(result.length).toBe(2)
  })

  it('accepts unlimited as limit', async () => {
    const { execSync } = await import('node:child_process')
    execSync('git init', { cwd: tempDir })
    execSync('git config user.email "test@example.com"', { cwd: tempDir })
    execSync('git config user.name "Test"', { cwd: tempDir })

    // Create 3 sync commits
    for (let i = 0; i < 3; i++) {
      execSync(`touch file${i}.txt && git add file${i}.txt`, { cwd: tempDir })
      execSync(
        `git commit -m "2026-04-${String(20 + i).padStart(2, '0')}: +1 added / -0 removed"`,
        { cwd: tempDir }
      )
    }

    const result = await getLog(tempDir, 'unlimited')
    expect(result.length).toBe(3)
  })

  it('handles partial sync commits', async () => {
    const { execSync } = await import('node:child_process')
    execSync('git init', { cwd: tempDir })
    execSync('git config user.email "test@example.com"', { cwd: tempDir })
    execSync('git config user.name "Test"', { cwd: tempDir })

    execSync('touch file1.txt && git add file1.txt', { cwd: tempDir })
    execSync(
      'git commit -m "2026-04-22 [partial]: +10 added / -0 removed"',
      { cwd: tempDir }
    )

    const result = await getLog(tempDir, 20)
    expect(result.length).toBe(1)
    expect(result[0]).toContain('[partial]')
  })
})

// ── listFolders Tests ─────────────────────────────────────────────────────────

describe('listFolders', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browse-test-'))
  })

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true })
    } catch {
      // ignore
    }
  })

  it('lists all folders from folders/*.json filenames', async () => {
    const foldersPath = path.join(tempDir, 'folders')
    await fs.mkdir(foldersPath, { recursive: true })

    // Create folder state files
    await fs.writeFile(path.join(foldersPath, 'INBOX.json'), '{"uidvalidity":"1","uidnext":1,"messages":[]}')
    await fs.writeFile(path.join(foldersPath, 'Sent.json'), '{"uidvalidity":"1","uidnext":1,"messages":[]}')
    await fs.writeFile(path.join(foldersPath, 'Archive.json'), '{"uidvalidity":"1","uidnext":1,"messages":[]}')

    const result = await listFolders(tempDir)
    expect(result).toEqual(['Archive', 'INBOX', 'Sent']) // sorted
  })

  it('returns empty array when folders dir missing', async () => {
    const result = await listFolders(tempDir)
    expect(result).toEqual([])
  })

  it('strips .json extension', async () => {
    const foldersPath = path.join(tempDir, 'folders')
    await fs.mkdir(foldersPath)
    await fs.writeFile(path.join(foldersPath, 'Gmail_INBOX.json'), '{}')

    const result = await listFolders(tempDir)
    expect(result).toEqual(['Gmail_INBOX'])
  })
})

// ── listMessages Tests ────────────────────────────────────────────────────────

describe('listMessages', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browse-test-'))
  })

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true })
    } catch {
      // ignore
    }
  })

  it('parses headers and returns MessageSummary array', async () => {
    const foldersPath = path.join(tempDir, 'folders')
    const messagesPath = path.join(tempDir, 'messages')
    await fs.mkdir(foldersPath)
    await fs.mkdir(messagesPath)

    const msgId1 = '<msg1@example.com>'
    const msgId2 = '<msg2@example.com>'

    // Create folder state
    await fs.writeFile(
      path.join(foldersPath, 'INBOX.json'),
      JSON.stringify({
        uidvalidity: '1',
        uidnext: 3,
        messages: [
          { uid: 1, 'message-id': msgId1, flags: [] },
          { uid: 2, 'message-id': msgId2, flags: [] },
        ],
      })
    )

    // Create EML files with headers
    const eml1 = `From: sender@example.com
To: recipient@example.com
Subject: Test 1
Date: Mon, 01 Jan 2024 12:00:00 +0000

Body 1`

    const eml2 = `From: another@example.com
Subject: Test 2
Date: Tue, 02 Jan 2024 13:00:00 +0000

Body 2`

    // Use sanitized filenames
    await fs.writeFile(path.join(messagesPath, `${sanitizeMessageId(msgId1)}.eml`), eml1)
    await fs.writeFile(path.join(messagesPath, `${sanitizeMessageId(msgId2)}.eml`), eml2)

    const result = await listMessages(tempDir, 'INBOX')
    expect(result).toHaveLength(2)
    expect(result[0].messageId).toBe(msgId1)
    expect(result[0].from).toBe('sender@example.com')
    expect(result[0].subject).toBe('Test 1')
    expect(result[1].from).toBe('another@example.com')
  })

  it('throws for non-existent folder', async () => {
    const foldersPath = path.join(tempDir, 'folders')
    await fs.mkdir(foldersPath)

    await expect(listMessages(tempDir, 'NonExistent')).rejects.toThrow(
      /Folder not found/
    )
  })

  it('handles missing EML files defensively', async () => {
    const foldersPath = path.join(tempDir, 'folders')
    const messagesPath = path.join(tempDir, 'messages')
    await fs.mkdir(foldersPath)
    await fs.mkdir(messagesPath)

    // Create folder state with message but no EML file
    await fs.writeFile(
      path.join(foldersPath, 'INBOX.json'),
      JSON.stringify({
        uidvalidity: '1',
        uidnext: 2,
        messages: [{ uid: 1, 'message-id': '<missing@example.com>', flags: [] }],
      })
    )

    const result = await listMessages(tempDir, 'INBOX')
    expect(result).toHaveLength(1)
    expect(result[0].messageId).toBe('<missing@example.com>')
    expect(result[0].date).toBe('') // Use defaults
    expect(result[0].from).toBe('')
  })
})

// ── viewMessage Tests ─────────────────────────────────────────────────────────

describe('viewMessage', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browse-test-'))
  })

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true })
    } catch {
      // ignore
    }
  })

  it('returns raw EML for eml format', async () => {
    const messagesPath = path.join(tempDir, 'messages')
    await fs.mkdir(messagesPath)

    const msgId = '<test@example.com>'
    const rawEml = `From: test@example.com
Subject: Test
Date: Mon, 01 Jan 2024 12:00:00 +0000

This is the body`

    await fs.writeFile(path.join(messagesPath, `${sanitizeMessageId(msgId)}.eml`), rawEml)

    const result = await viewMessage(tempDir, msgId, 'eml')
    expect(result).toContain('From: test@example.com')
    expect(result).toContain('This is the body')
  })

  it('extracts text/plain for plaintext format', async () => {
    const messagesPath = path.join(tempDir, 'messages')
    await fs.mkdir(messagesPath)

    const msgId = '<test@example.com>'
    const eml = `From: test@example.com
Subject: Test
Date: Mon, 01 Jan 2024 12:00:00 +0000
Content-Type: text/plain

This is plaintext`

    await fs.writeFile(path.join(messagesPath, `${sanitizeMessageId(msgId)}.eml`), eml)

    const result = await viewMessage(tempDir, msgId, 'plaintext')
    expect(result).toContain('This is plaintext')
  })

  it('uses plaintext as default format', async () => {
    const messagesPath = path.join(tempDir, 'messages')
    await fs.mkdir(messagesPath)

    const msgId = '<test@example.com>'
    const eml = `From: test@example.com
Subject: Test
Content-Type: text/plain

Default format text`

    await fs.writeFile(path.join(messagesPath, `${sanitizeMessageId(msgId)}.eml`), eml)

    // Call without format parameter (should default to plaintext)
    const result = await viewMessage(tempDir, msgId)
    expect(result).toContain('Default format text')
  })

  it('returns JSON headers+parts for json format', async () => {
    const messagesPath = path.join(tempDir, 'messages')
    await fs.mkdir(messagesPath)

    const msgId = '<test@example.com>'
    const eml = `From: test@example.com
Subject: Test Subject
To: recipient@example.com
Date: Mon, 01 Jan 2024 12:00:00 +0000
Content-Type: text/plain

This is plaintext`

    await fs.writeFile(path.join(messagesPath, `${sanitizeMessageId(msgId)}.eml`), eml)

    const result = (await viewMessage(tempDir, msgId, 'json')) as Record<string, unknown>
    expect(result.headers).toBeDefined()
    expect(result.parts).toBeDefined()
    // from header might be an object or string depending on parsing
    const fromHeader = (result.headers as Record<string, string>)['from']
    expect(typeof fromHeader).toBe('string')
    expect(fromHeader).toContain('test@example.com')
    expect((result.parts as Array<{ type: string }>).length).toBeGreaterThan(0)
  })

  it('throws for plaintext when no text/plain part', async () => {
    const messagesPath = path.join(tempDir, 'messages')
    await fs.mkdir(messagesPath)

    const msgId = '<test@example.com>'
    // Multipart message with only HTML and an attachment, no text/plain
    const eml = `From: test@example.com
Subject: Test
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="boundary123"

--boundary123
Content-Type: text/html

<html><body>HTML only</body></html>
--boundary123
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="file.bin"
Content-Transfer-Encoding: base64

YmluYXJ5IGNvbnRlbnQ=
--boundary123--`

    await fs.writeFile(path.join(messagesPath, `${sanitizeMessageId(msgId)}.eml`), eml)

    await expect(
      viewMessage(tempDir, msgId, 'plaintext')
    ).rejects.toThrow(/No text\/plain part found/)
  })

  it('sanitizes message-id before path lookup', async () => {
    const messagesPath = path.join(tempDir, 'messages')
    await fs.mkdir(messagesPath)

    const msgId = '<sanitized_id@test.com>'
    const eml = `From: test@example.com
Subject: Test

Body`

    // Create file with sanitized name
    await fs.writeFile(path.join(messagesPath, `${sanitizeMessageId(msgId)}.eml`), eml)

    // Call with message-id that needs sanitization (angle brackets)
    const result = await viewMessage(tempDir, msgId, 'eml')
    expect(result).toContain('From: test@example.com')
  })

  it('throws for missing message file', async () => {
    const messagesPath = path.join(tempDir, 'messages')
    await fs.mkdir(messagesPath)

    await expect(
      viewMessage(tempDir, '<nonexistent@example.com>', 'plaintext')
    ).rejects.toThrow(/Message not found/)
  })

  it('includes html part in json output when email has text/html content', async () => {
    const messagesPath = path.join(tempDir, 'messages')
    await fs.mkdir(messagesPath)

    const msgId = '<html@example.com>'
    const eml = [
      'From: test@example.com',
      'Subject: HTML Email',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain',
      '',
      'Plain text version',
      '--b',
      'Content-Type: text/html',
      '',
      '<html><body>HTML content</body></html>',
      '--b--',
    ].join('\r\n')

    await fs.writeFile(path.join(messagesPath, `${sanitizeMessageId(msgId)}.eml`), eml)

    const result = await viewMessage(tempDir, msgId, 'json') as Record<string, unknown>
    const parts = result.parts as Array<{ type: string; content: string }>
    const htmlPart = parts.find(p => p.type === 'text/html')
    expect(htmlPart).toBeDefined()
    expect(htmlPart?.content).toContain('HTML content')
  })

  it('includes base64-encoded attachments in json output', async () => {
    const messagesPath = path.join(tempDir, 'messages')
    await fs.mkdir(messagesPath)

    const msgId = '<attachment@example.com>'
    const eml = [
      'From: test@example.com',
      'Subject: Attachment',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain',
      '',
      'Email with attachment',
      '--b',
      'Content-Type: application/octet-stream',
      'Content-Disposition: attachment; filename="file.bin"',
      'Content-Transfer-Encoding: base64',
      '',
      'YmluYXJ5IGNvbnRlbnQ=',
      '--b--',
    ].join('\r\n')

    await fs.writeFile(path.join(messagesPath, `${sanitizeMessageId(msgId)}.eml`), eml)

    const result = await viewMessage(tempDir, msgId, 'json') as Record<string, unknown>
    const parts = result.parts as Array<{ type: string; content: string }>
    const attPart = parts.find(p => p.type === 'application/octet-stream')
    expect(attPart).toBeDefined()
    expect(typeof attPart?.content).toBe('string')
    expect(attPart?.content.length).toBeGreaterThan(0)
  })
})

// ── checkoutCommit Tests ──────────────────────────────────────────────────────

describe('checkoutCommit', () => {
  let repoDir: string
  let worktreesDir: string

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browse-repo-'))
    worktreesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browse-worktrees-'))

    const { execSync } = await import('node:child_process')
    execSync('git init', { cwd: repoDir })
    execSync('git config user.email "test@example.com"', { cwd: repoDir })
    execSync('git config user.name "Test"', { cwd: repoDir })
    await fs.writeFile(path.join(repoDir, 'file.txt'), 'hello')
    execSync('git add file.txt', { cwd: repoDir })
    execSync('git commit -m "initial"', { cwd: repoDir })
  })

  afterEach(async () => {
    try { await fs.rm(repoDir, { recursive: true, force: true }) } catch {}
    try { await fs.rm(worktreesDir, { recursive: true, force: true }) } catch {}
  })

  it('checks out a commit by hash and returns the worktree path and short sha', async () => {
    const { execSync } = await import('node:child_process')
    const hash = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim()

    const result = await checkoutCommit(repoDir, hash, worktreesDir)

    expect(result.sha).toBe(hash.slice(0, 7))
    expect(result.path).toContain(hash.slice(0, 7))
    const exists = await fs.access(result.path).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  it('re-creates the worktree cleanly when called twice with the same hash', async () => {
    const { execSync } = await import('node:child_process')
    const hash = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim()

    const first = await checkoutCommit(repoDir, hash, worktreesDir)
    const second = await checkoutCommit(repoDir, hash, worktreesDir)

    expect(second.path).toBe(first.path)
    expect(second.sha).toBe(first.sha)
    const exists = await fs.access(second.path).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  it('checks out by date string (YYYY-MM-DD) and resolves to the matching commit', async () => {
    const { execSync } = await import('node:child_process')
    const fixedDate = '2026-01-15'

    // Make a second commit pinned to that date
    await fs.writeFile(path.join(repoDir, 'dated.txt'), 'dated')
    execSync('git add dated.txt', { cwd: repoDir })
    execSync('git commit -m "dated commit"', {
      cwd: repoDir,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: `${fixedDate}T12:00:00`,
        GIT_COMMITTER_DATE: `${fixedDate}T12:00:00`,
      },
    })
    const hash = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim()

    const result = await checkoutCommit(repoDir, fixedDate, worktreesDir)

    expect(result.sha).toBe(hash.slice(0, 7))
    expect(result.path).toContain(fixedDate)
  })

  it('throws when no commit exists for the given date', async () => {
    await expect(
      checkoutCommit(repoDir, '1999-01-01', worktreesDir)
    ).rejects.toThrow(/No sync commit found for date 1999-01-01/)
  })
})
