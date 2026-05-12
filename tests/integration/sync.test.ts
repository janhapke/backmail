import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ImapFlow } from 'imapflow'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'
import { syncAccount, messageFilename } from '../../src/core/sync.js'

// Allow override via env vars for CI environments that map ports differently
const IMAP_HOST = process.env.IMAP_HOST ?? 'localhost'
const IMAP_PORT = Number(process.env.IMAP_PORT ?? '143')
const IMAP_USER = process.env.IMAP_USER ?? 'testuser'
const IMAP_PASS = process.env.IMAP_PASS ?? 'testpass'

let tmpRepo: string

beforeAll(async () => {
  // Create tmp directory for sync test repo
  tmpRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'backmail-integration-'))

  // Set password in env so getPassword() can retrieve it without keyring
  process.env.BACKMAIL_TEST_PASSWORD = IMAP_PASS

  // Seed Dovecot with test fixtures via IMAP APPEND
  const seeder = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: false,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
  })

  try {
    await seeder.connect()
    const lock = await seeder.getMailboxLock('INBOX')
    try {
      // Append fixture-001.eml to INBOX
      const eml1 = await fs.readFile('./tests/fixtures/fixture-001.eml')
      await seeder.append('INBOX', eml1)
    } finally {
      lock.release()
    }
  } finally {
    await seeder.logout().catch(() => {})
  }
})

afterAll(async () => {
  // Clean up tmp directory
  await fs.rm(tmpRepo, { recursive: true, force: true })
  delete process.env.BACKMAIL_TEST_PASSWORD
})

// ---------------------------------------------------------------------------
// SYNC-01: End-to-end incremental fetch
// ---------------------------------------------------------------------------

describe('SYNC-01: end-to-end incremental fetch', () => {
  it('Test AA: fetches messages from IMAP, writes .eml files, and updates folder JSON', async () => {
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }

    const result = await syncAccount(accountConfig, tmpRepo, {
      excludeFolders: [],
      onlyFolders: [],
      verbose: false,
    })

    // Assert: at least one message was added
    expect(result.added).toBeGreaterThanOrEqual(1)

    // Assert: a message file exists in the INBOX directory
    const inboxDir = path.join(tmpRepo, 'INBOX')
    const inboxFiles = await fs.readdir(inboxDir)
    const messages = inboxFiles.filter(f => f.endsWith('.eml'))
    expect(messages.length).toBeGreaterThan(0)

    // Assert: folder state JSON exists and has expected schema
    const inboxState = JSON.parse(await fs.readFile(path.join(inboxDir, '.backmail_state.json'), 'utf-8'))
    expect(inboxState).toHaveProperty('uidvalidity')
    expect(inboxState).toHaveProperty('uidnext')
    expect(inboxState).toHaveProperty('messages')
    expect(Array.isArray(inboxState.messages)).toBe(true)
    expect(inboxState.messages[0]).toHaveProperty('uid')
    expect(inboxState.messages[0]).toHaveProperty('message-id')
    expect(inboxState.messages[0]).toHaveProperty('flags')
  })
})

// ---------------------------------------------------------------------------
// SYNC-03: Deletion mirroring
// ---------------------------------------------------------------------------

describe('SYNC-03: deletion mirroring', () => {
  it('Test BB: detects deleted messages on server and removes their .eml files', async () => {
    // This test requires seeding, deletion, and re-sync which is complex in integration
    // For now, we stub the test to establish the expected behavior
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }

    // First sync to establish baseline
    const firstSync = await syncAccount(accountConfig, tmpRepo, {
      excludeFolders: [],
      onlyFolders: [],
      verbose: false,
    })
    expect(firstSync).toHaveProperty('added')
    expect(firstSync).toHaveProperty('removed')

    // TODO: Delete a message from server, then run sync again
    // Assert that removed >= 1 and the corresponding .eml is gone
    // This requires imapflow message deletion API which will be in Plan 2
  })
})

// ---------------------------------------------------------------------------
// SYNC-05: uidvalidity change triggers full re-sync
// ---------------------------------------------------------------------------

describe('SYNC-05: uidvalidity change triggers full re-sync', () => {
  it('Test CC: re-fetches all messages when uidvalidity changes', async () => {
    // This test requires manipulation of the folder state file which is complex
    // For now, we stub the test to establish the expected behavior
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }

    // First sync to establish baseline
    const firstSync = await syncAccount(accountConfig, tmpRepo, {
      excludeFolders: [],
      onlyFolders: [],
      verbose: false,
    })
    expect(firstSync).toHaveProperty('added')

    // TODO: Manually rewrite folders/INBOX.json with garbage uidvalidity
    // Then run syncAccount again
    // Assert that result.added equals the current server message count (full re-sync occurred)
    // This requires file manipulation and comparison which will be in Plan 2
  })
})

// ---------------------------------------------------------------------------
// SYNC-FORCE: --force re-downloads all messages
// ---------------------------------------------------------------------------

describe('SYNC-FORCE: --force re-downloads all existing messages', () => {
  it('Test DD: force sync re-fetches every message (result.added >= message count)', async () => {
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }

    // Use a unique private mailbox so no other parallel test can touch our messages.
    const testFolder = `ForceTest-${Date.now()}`
    const seeder = new ImapFlow({
      host: IMAP_HOST, port: IMAP_PORT, secure: false,
      auth: { user: IMAP_USER, pass: IMAP_PASS }, logger: false,
    })
    await seeder.connect()
    await seeder.mailboxCreate(testFolder)
    const seedLock = await seeder.getMailboxLock(testFolder)
    try {
      const fixture = await fs.readFile('./tests/fixtures/fixture-001.eml')
      await seeder.append(testFolder, fixture)
    } finally {
      seedLock.release()
    }
    await seeder.logout().catch(() => {})

    const forceRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'backmail-force-'))
    try {
      // Initial sync: grabs exactly the 1 message we seeded
      const firstSync = await syncAccount(accountConfig, forceRepo, {
        excludeFolders: [],
        onlyFolders: [testFolder],
        verbose: false,
      })
      expect(firstSync.added).toBe(1)

      const folderDir = path.join(forceRepo, testFolder)
      const beforeFiles = (await fs.readdir(folderDir)).filter(f => f.endsWith('.eml'))
      expect(beforeFiles.length).toBe(1)

      // Force sync: clears state and re-downloads from 1:*
      const forceSync = await syncAccount(accountConfig, forceRepo, {
        excludeFolders: [],
        onlyFolders: [testFolder],
        verbose: false,
        force: true,
      })

      expect(forceSync.added).toBe(1)
      const afterFiles = (await fs.readdir(folderDir)).filter(f => f.endsWith('.eml'))
      expect(afterFiles.length).toBe(1)
    } finally {
      await fs.rm(forceRepo, { recursive: true, force: true })
      // Clean up the private mailbox
      const cleaner = new ImapFlow({
        host: IMAP_HOST, port: IMAP_PORT, secure: false,
        auth: { user: IMAP_USER, pass: IMAP_PASS }, logger: false,
      })
      await cleaner.connect()
      await cleaner.mailboxDelete(testFolder).catch(() => {})
      await cleaner.logout().catch(() => {})
    }
  })
})

// ---------------------------------------------------------------------------
// SYNC-PRUNE: deleted server folders are removed locally
// ---------------------------------------------------------------------------

describe('SYNC-PRUNE: local folder removed when absent from server', () => {
  it('Test EE: a locally present folder with no server counterpart is deleted', async () => {
    const accountConfig = {
      host: IMAP_HOST,
      port: IMAP_PORT,
      username: IMAP_USER,
      tls: false,
      passwordRef: 'env:BACKMAIL_TEST_PASSWORD',
    }
    const pruneRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'backmail-prune-'))
    try {
      // First sync to set up real folders
      await syncAccount(accountConfig, pruneRepo, {
        excludeFolders: [],
        onlyFolders: [],
        verbose: false,
      })

      // Inject a fake local folder that does not exist on the server
      const ghostDir = path.join(pruneRepo, 'GhostFolder')
      await fs.mkdir(ghostDir, { recursive: true })
      const ghostState = {
        folderPath: 'GhostFolder',
        delimiter: '/',
        uidvalidity: '1',
        uidnext: 2,
        messages: [{ uid: 1, 'message-id': '<ghost@example.com>', filename: 'ghost-mail', flags: [] }],
      }
      await fs.writeFile(path.join(ghostDir, '.backmail_state.json'), JSON.stringify(ghostState))
      await fs.writeFile(path.join(ghostDir, 'ghost-mail.eml'), 'ghost content')

      // Sync again — GhostFolder is not on the server, so it should be pruned
      const result = await syncAccount(accountConfig, pruneRepo, {
        excludeFolders: [],
        onlyFolders: [],
        verbose: false,
      })

      expect(result.removed).toBeGreaterThanOrEqual(1)
      const ghostExists = await fs.access(ghostDir).then(() => true).catch(() => false)
      expect(ghostExists).toBe(false)
    } finally {
      await fs.rm(pruneRepo, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// SYNC-REINDEX: --reindex renames .eml files without IMAP
// ---------------------------------------------------------------------------

describe('SYNC-REINDEX: --reindex renames stale local filenames', () => {
  it('Test FF: reindex renames a file whose stored name differs from current messageFilename output', async () => {
    // Reindex is purely local — no IMAP needed. Set up a real git repo with a
    // stale-named .eml and verify that syncAccount --reindex fixes it.
    const reindexRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'backmail-reindex-'))
    try {
      const inboxDir = path.join(reindexRepo, 'INBOX')
      await fs.mkdir(inboxDir)

      // Bootstrap a real git repo (simpleGit needs a committed history to status/commit)
      execSync('git init', { cwd: reindexRepo })
      execSync('git config user.email "test@example.com"', { cwd: reindexRepo })
      execSync('git config user.name "Test"', { cwd: reindexRepo })

      // Use fixture-001.eml as the message content so the filename is deterministic
      const emlContent = await fs.readFile('./tests/fixtures/fixture-001.eml')
      const msgId = '<fixture-001@example.com>'
      const correctName = messageFilename(msgId, emlContent)
      const staleName = 'stale-legacy-name'

      // Write the .eml under the stale name (simulating a file from old naming logic)
      await fs.writeFile(path.join(inboxDir, `${staleName}.eml`), emlContent)

      // Write a state file that records the stale filename
      const state = {
        folderPath: 'INBOX',
        delimiter: '/',
        uidvalidity: '1',
        uidnext: 2,
        messages: [{ uid: 1, 'message-id': msgId, filename: staleName, flags: [] }],
      }
      await fs.writeFile(path.join(inboxDir, '.backmail_state.json'), JSON.stringify(state))

      // Commit so git has a baseline (simpleGit status() needs HEAD)
      execSync('git add .', { cwd: reindexRepo })
      execSync('git commit -m "baseline with stale filename"', { cwd: reindexRepo })

      // Reindex: should rename stale-legacy-name.eml → correctName.eml
      // accountConfig is irrelevant — reindex never opens an IMAP connection
      const reindexResult = await syncAccount(
        { host: 'localhost', port: 143, username: 'u', tls: false, passwordRef: 'env:BACKMAIL_TEST_PASSWORD' },
        reindexRepo,
        { excludeFolders: [], onlyFolders: [], verbose: false, reindex: true },
      )

      expect(reindexResult.renamed).toBe(1)

      const correctExists = await fs.access(path.join(inboxDir, `${correctName}.eml`)).then(() => true).catch(() => false)
      expect(correctExists).toBe(true)

      const staleExists = await fs.access(path.join(inboxDir, `${staleName}.eml`)).then(() => true).catch(() => false)
      expect(staleExists).toBe(false)

      // Git should have committed the rename
      const log = execSync('git log --oneline', { cwd: reindexRepo }).toString()
      expect(log).toContain('[reindex]')
    } finally {
      await fs.rm(reindexRepo, { recursive: true, force: true })
    }
  })
})
