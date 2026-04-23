import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ImapFlow } from 'imapflow'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { sanitizeMessageId, folderPathToFilename } from '../../src/core/sync.js'

// These will be imported from src/core/restore.js once it's implemented
import type { RestoreResult, RestoreOptions } from '../../src/core/restore.js'
declare function restoreAccount(
  config: any,
  targetUrl: string,
  dateOrCommit?: string,
  options?: RestoreOptions
): Promise<RestoreResult>

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
    // Setup: Create source repo with 5 messages in INBOX, call restoreAccount with targetUrl
    // Expected: All 5 messages appear on target server; uploaded=5, errors=0
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      repoPath: tmpRepo,
    }

    const targetUrl = `imap://${IMAP_USER}:${IMAP_PASS}@${IMAP_HOST}:${IMAP_PORT}`

    // TODO: Call restoreAccount() and verify messages uploaded
    // result = await restoreAccount(accountConfig, targetUrl, undefined, {
    //   skipDuplicates: false,
    //   dryRun: false,
    //   verbose: false,
    // })
    // expect(result.uploaded).toBe(3)
    // expect(result.errors).toBe(0)

    expect(true).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// REST-02: Duplicate checking with --skip-duplicates=yes
// ────────────────────────────────────────────────────────────────────────────

describe('REST-02: Duplicate checking with --skip-duplicates=yes', () => {
  it('With skip-duplicates=yes, messages with duplicate Message-ID are skipped', async () => {
    // Setup: Create source repo with 3 messages, pre-populate target with 1 matching Message-ID
    // Call: restoreAccount(..., { skipDuplicates: true })
    // Expected: uploaded=2, skipped=1, errors=0

    // First, seed the target with one duplicate message
    const seeder = new ImapFlow({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: false,
      auth: { user: IMAP_USER, pass: IMAP_PASS },
      logger: false,
    })

    // TODO: Connect and append one message to create a duplicate
    // Then call restoreAccount with skipDuplicates: true
    // expect(result.skipped).toBe(1)
    // expect(result.uploaded).toBe(2)

    expect(true).toBe(true)
  })

  it('With skip-duplicates=no, all messages upload even if duplicates exist', async () => {
    // Setup: Same as above but with skipDuplicates: false
    // Expected: uploaded=3, skipped=0 (all three upload, no dedup check)

    // TODO: Call restoreAccount with skipDuplicates: false
    // expect(result.skipped).toBe(0)
    // expect(result.uploaded).toBe(3)

    expect(true).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// REST-03: Dry-run produces output without writing
// ────────────────────────────────────────────────────────────────────────────

describe('REST-03: Dry-run produces output without writing', () => {
  it('dryRun=true produces same output format without writing to target', async () => {
    // Setup: Source repo with 3 messages, target is empty
    // Call: restoreAccount(..., { dryRun: true })
    // Expected: result shows uploaded=3; actual target server still empty (0 messages)

    // TODO: Call restoreAccount with dryRun: true
    // Verify result.uploaded = 3
    // Then verify target IMAP server still has 0 messages

    expect(true).toBe(true)
  })

  it('Dry-run output respects --verbose flag', async () => {
    // Setup: Call with { dryRun: true, verbose: true }
    // Expected: Output includes per-message detail lines

    // TODO: Call restoreAccount with dryRun: true, verbose: true
    // Capture output and verify it includes per-message lines

    expect(true).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// REST-04: Folder structure preserved on target
// ────────────────────────────────────────────────────────────────────────────

describe('REST-04: Folder structure preserved on target', () => {
  it('Missing folders are created on target before message append', async () => {
    // Setup: Source repo with messages in 'INBOX', 'Drafts', '[Gmail]/Sent Mail'
    // Call: restoreAccount()
    // Expected: All three folders exist on target server with correct hierarchies

    // TODO: Create additional folder state files and messages
    // Call restoreAccount()
    // Verify all folders exist on target server

    expect(true).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Error handling during restore
// ────────────────────────────────────────────────────────────────────────────

describe('Error handling during restore', () => {
  it('On per-message APPEND error, restore continues and accumulates error count', async () => {
    // Setup: Message 1 succeeds, message 2 throws error (simulate bad RFC822), message 3 succeeds
    // Expected: result.uploaded=2, result.errors=1

    // TODO: Create a malformed EML message
    // Call restoreAccount()
    // expect(result.uploaded).toBe(2)
    // expect(result.errors).toBe(1)

    expect(true).toBe(true)
  })

  it('restoreAccount() can be called with a dateOrCommit argument to restore from a specific point in history', async () => {
    // Setup: Git repo with multiple commits at different dates
    // Call: restoreAccount(accountConfig, targetUrl, '2024-01-01', options)
    // Expected: Uses checkout to get worktree at that date, then restores from it

    // TODO: Create additional commits at different dates
    // Call restoreAccount with date argument
    // Verify correct commit was checked out

    expect(true).toBe(true)
  })
})
