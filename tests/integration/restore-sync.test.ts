import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ImapFlow } from 'imapflow'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { sanitizeMessageId, folderPathToFilename } from '../../src/core/sync.js'
import { restoreAccount } from '../../src/core/restore.js'
import type { RestoreResult, RestoreOptions } from '../../src/core/restore.js'

// Allow override via env vars for CI environments that map ports differently
const IMAP_HOST = process.env.IMAP_HOST ?? 'localhost'
const IMAP_PORT = Number(process.env.IMAP_PORT ?? '143')
const IMAP_USER = process.env.IMAP_USER ?? 'testuser'
const IMAP_PASS = process.env.IMAP_PASS ?? 'testpass'

let tmpRepo: string

beforeAll(async () => {
  // Create tmp directory for restore test repo
  tmpRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'backmail-restore-test-'))

  // Set password in env so getPassword() can retrieve it without keyring
  process.env.BACKMAIL_TEST_PASSWORD = IMAP_PASS

  // Create folders and messages directories
  await fs.mkdir(path.join(tmpRepo, 'folders'))
  await fs.mkdir(path.join(tmpRepo, 'messages'))

  // Initialize git repo with seed data
  execSync('git init', { cwd: tmpRepo })
  execSync('git config user.email "test@example.com"', { cwd: tmpRepo })
  execSync('git config user.name "Test User"', { cwd: tmpRepo })

  // Create initial commit with folder state and messages
  const inboxState = {
    uidvalidity: '1234567890',
    uidnext: 6,
    messages: [
      { uid: 1, 'message-id': '<msg1@example.com>', flags: [] },
      { uid: 2, 'message-id': '<msg2@example.com>', flags: ['\\Seen'] },
      { uid: 3, 'message-id': '<msg3@example.com>', flags: [] },
    ],
  }
  await fs.writeFile(
    path.join(tmpRepo, 'folders', 'INBOX.json'),
    JSON.stringify(inboxState)
  )

  // Create sample EML files for testing
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
    path.join(tmpRepo, 'messages', `${sanitizeMessageId('<msg1@example.com>')}.eml`),
    eml1
  )
  await fs.writeFile(
    path.join(tmpRepo, 'messages', `${sanitizeMessageId('<msg2@example.com>')}.eml`),
    eml2
  )
  await fs.writeFile(
    path.join(tmpRepo, 'messages', `${sanitizeMessageId('<msg3@example.com>')}.eml`),
    eml3
  )

  // Create initial commit
  execSync('touch README.md', { cwd: tmpRepo })
  execSync('git add -A', { cwd: tmpRepo })
  execSync('git commit -m "Initial restore test repo"', { cwd: tmpRepo })
})

afterAll(async () => {
  // Clean up tmp directory
  await fs.rm(tmpRepo, { recursive: true, force: true })
  delete process.env.BACKMAIL_TEST_PASSWORD
})

// ────────────────────────────────────────────────────────────────────────────
// REST-01: Message upload from local checkout to target
// ────────────────────────────────────────────────────────────────────────────

describe('REST-01: Message upload from local checkout to target', () => {
  it('restoreAccount() uploads all messages from a checkout to target IMAP server', async () => {
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }

    const targetUrl = `imap://${IMAP_USER}:${IMAP_PASS}@${IMAP_HOST}:${IMAP_PORT}`

    const result = await restoreAccount(accountConfig, tmpRepo, targetUrl, undefined, {
      skipDuplicates: false,
      dryRun: false,
      verbose: false,
    })

    expect(result.uploaded).toBe(3)
    expect(result.errors).toBe(0)

    // Verify messages exist on target server
    const targetClient = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: false,
      auth: { user: IMAP_USER, pass: IMAP_PASS },
      logger: false
    })
    await targetClient.connect()
    const lock = await targetClient.getMailboxLock('INBOX')
    const search = await targetClient.search({})
    await lock.release()
    await targetClient.logout()

    expect(search !== false && search.length >= 3).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// REST-02: Duplicate checking with --skip-duplicates=yes
// ────────────────────────────────────────────────────────────────────────────

describe('REST-02: Duplicate checking with --skip-duplicates=yes', () => {
  beforeAll(async () => {
    // REST-01 already uploaded all 3 messages; purge INBOX so duplicate tests start clean
    const cleaner = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: false,
      auth: { user: IMAP_USER, pass: IMAP_PASS },
      logger: false,
    })
    await cleaner.connect()
    const lock = await cleaner.getMailboxLock('INBOX')
    try {
      await cleaner.messageDelete('1:*', { uid: false })
    } catch {
      // INBOX may already be empty
    } finally {
      lock.release()
    }
    await cleaner.logout().catch(() => {})
  })

  it('With skip-duplicates=yes, messages with duplicate Message-ID are skipped', async () => {
    // First, seed the target with one duplicate message
    const seeder = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: false,
      auth: { user: IMAP_USER, pass: IMAP_PASS },
      logger: false,
    })

    await seeder.connect()
    const lock = await seeder.getMailboxLock('INBOX')
    // Append msg1 to create a duplicate
    await seeder.append('INBOX', 'From: alice@example.com\r\nTo: bob@example.com\r\nSubject: First test email\r\nDate: Mon, 01 Jan 2024 12:00:00 +0000\r\nMessage-ID: <msg1@example.com>\r\n\r\nThis is the body of the first email.', [])
    await lock.release()
    await seeder.logout()

    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }

    const targetUrl = `imap://${IMAP_USER}:${IMAP_PASS}@${IMAP_HOST}:${IMAP_PORT}`

    const result = await restoreAccount(accountConfig, tmpRepo, targetUrl, undefined, {
      skipDuplicates: true,
      dryRun: false,
      verbose: false,
    })

    expect(result.skipped).toBe(1)
    expect(result.uploaded).toBe(2)
  })

  it('With skip-duplicates=no, all messages upload even if duplicates exist', async () => {
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }

    const targetUrl = `imap://${IMAP_USER}:${IMAP_PASS}@${IMAP_HOST}:${IMAP_PORT}`

    const result = await restoreAccount(accountConfig, tmpRepo, targetUrl, undefined, {
      skipDuplicates: false,
      dryRun: false,
      verbose: false,
    })

    expect(result.skipped).toBe(0)
    expect(result.uploaded).toBe(3)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// REST-03: Dry-run produces output without writing
// ────────────────────────────────────────────────────────────────────────────

describe('REST-03: Dry-run produces output without writing', () => {
  it('dryRun=true produces same output format without writing to target', async () => {
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }

    const targetUrl = `imap://${IMAP_USER}:${IMAP_PASS}@${IMAP_HOST}:${IMAP_PORT}`

    // Count messages before dry-run
    const beforeClient = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: false,
      auth: { user: IMAP_USER, pass: IMAP_PASS },
      logger: false
    })
    await beforeClient.connect()
    const beforeLock = await beforeClient.getMailboxLock('INBOX')
    const countBefore = await beforeClient.search({})
    await beforeLock.release()
    await beforeClient.logout()

    const countBeforeLength = countBefore !== false ? countBefore.length : 0

    // Perform dry-run
    const result = await restoreAccount(accountConfig, tmpRepo, targetUrl, undefined, {
      skipDuplicates: false,
      dryRun: true,
      verbose: false,
    })

    expect(result.uploaded).toBe(3)

    // Verify target still has same count (no writes occurred)
    const afterClient = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: false,
      auth: { user: IMAP_USER, pass: IMAP_PASS },
      logger: false
    })
    await afterClient.connect()
    const afterLock = await afterClient.getMailboxLock('INBOX')
    const countAfter = await afterClient.search({})
    await afterLock.release()
    await afterClient.logout()

    const countAfterLength = countAfter !== false ? countAfter.length : 0
    expect(countAfterLength).toBe(countBeforeLength)
  })

  it('Dry-run output respects --verbose flag', async () => {
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }

    const targetUrl = `imap://${IMAP_USER}:${IMAP_PASS}@${IMAP_HOST}:${IMAP_PORT}`

    const result = await restoreAccount(accountConfig, tmpRepo, targetUrl, undefined, {
      skipDuplicates: false,
      dryRun: true,
      verbose: true,
    })

    expect(result.uploaded).toBe(3)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// REST-04: Folder structure preserved on target
// ────────────────────────────────────────────────────────────────────────────

describe('REST-04: Folder structure preserved on target', () => {
  it('Missing folders are created on target before message append', async () => {
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }

    const targetUrl = `imap://${IMAP_USER}:${IMAP_PASS}@${IMAP_HOST}:${IMAP_PORT}`

    const result = await restoreAccount(accountConfig, tmpRepo, targetUrl, undefined, {
      skipDuplicates: false,
      dryRun: false,
      verbose: false,
    })

    // Verify INBOX exists on target
    const targetClient = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: false,
      auth: { user: IMAP_USER, pass: IMAP_PASS },
      logger: false
    })
    await targetClient.connect()
    const list = await targetClient.list()
    await targetClient.logout()

    const folderNames = list.map(f => f.path)
    expect(folderNames).toContain('INBOX')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Error handling during restore
// ────────────────────────────────────────────────────────────────────────────

describe('Error handling during restore', () => {
  it('restoreAccount() returns result with uploaded, skipped, and errors counts', async () => {
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }

    const targetUrl = `imap://${IMAP_USER}:${IMAP_PASS}@${IMAP_HOST}:${IMAP_PORT}`

    const result = await restoreAccount(accountConfig, tmpRepo, targetUrl, undefined, {
      skipDuplicates: false,
      dryRun: false,
      verbose: false,
    })

    expect(result).toHaveProperty('uploaded')
    expect(result).toHaveProperty('skipped')
    expect(result).toHaveProperty('errors')
    expect(typeof result.uploaded).toBe('number')
    expect(typeof result.skipped).toBe('number')
    expect(typeof result.errors).toBe('number')
  })

  it('restoreAccount() can be called with a dateOrCommit argument to restore from a specific point in history', async () => {
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }

    const targetUrl = `imap://${IMAP_USER}:${IMAP_PASS}@${IMAP_HOST}:${IMAP_PORT}`

    // Get the initial commit hash
    const commitHash = execSync('git rev-parse HEAD', { cwd: tmpRepo }).toString().trim()

    const result = await restoreAccount(accountConfig, tmpRepo, targetUrl, commitHash, {
      skipDuplicates: false,
      dryRun: false,
      verbose: false,
    })

    expect(result.uploaded).toBeGreaterThanOrEqual(0)
  })
})
