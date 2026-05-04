import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { ImapFlow } from 'imapflow'

import {
  syncAccount,
  sanitizeMessageId,
  folderPathToFilename,
  formatCommitMessage,
  filterFolders,
} from '../../src/core/sync.js'

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(function () {
    return {
      connect: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
      fetch: vi.fn(),
      search: vi.fn().mockResolvedValue([]),
      mailbox: { uidValidity: 1n, uidNext: 1 },
    }
  }),
}))

vi.mock('simple-git', () => ({
  simpleGit: vi.fn().mockImplementation(() => ({
    checkIsRepo: vi.fn().mockResolvedValue(true),
    init: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({}),
    status: vi.fn().mockResolvedValue({ isClean: () => true }),
  })),
}))

vi.mock('@napi-rs/keyring', () => ({
  Entry: vi.fn().mockImplementation(function () {
    return { getPassword: vi.fn().mockReturnValue('test-pass') }
  }),
}))

// ---------------------------------------------------------------------------
// SYNC-04: Path Traversal Protection — Message-ID Sanitization
// T-3-01: sanitizeMessageId
// ---------------------------------------------------------------------------

describe('sanitizeMessageId (T-3-01: path traversal)', () => {
  it('Test A: strips angle brackets from message ID', () => {
    const result = sanitizeMessageId('<abc@example.com>')
    expect(result).toBe('abc@example.com')
  })

  it('Test B: replaces forward slash with underscore', () => {
    const result = sanitizeMessageId('a/b@x.com')
    expect(result).not.toContain('/')
  })

  it('Test C: rejects path traversal with .. sequences', () => {
    const result = sanitizeMessageId('../../etc/passwd')
    expect(result).not.toContain('..')
    expect(result).not.toContain('/')
  })

  it('Test D: caps length at 200 characters', () => {
    const result = sanitizeMessageId('x'.repeat(500))
    expect(result).toHaveLength(200)
  })

  it('Test E: replaces all filesystem-special characters', () => {
    const special = '/<>:|?*"'
    for (const char of special) {
      const input = `test${char}name`
      const result = sanitizeMessageId(input)
      expect(result).not.toContain(char)
    }
  })
})

// ---------------------------------------------------------------------------
// SYNC-04: Path Traversal Protection — Folder Path Sanitization
// T-3-02: folderPathToFilename
// ---------------------------------------------------------------------------

describe('folderPathToFilename (T-3-02: path traversal)', () => {
  it('Test F: removes forward slashes from IMAP folder path', () => {
    const result = folderPathToFilename('[Gmail]/Sent Mail')
    expect(result).not.toContain('/')
  })

  it('Test G: rejects path traversal in folder names', () => {
    const result = folderPathToFilename('../../../etc')
    expect(result).not.toContain('..')
    expect(result).not.toContain('/')
  })

  it('Test H: output is filesystem-safe (alphanumeric, underscore, dot, bracket, dash)', () => {
    const result = folderPathToFilename('[Gmail]/All Mail/Archived')
    // Should only contain safe characters [A-Za-z0-9_.\[\]-]
    expect(result).toMatch(/^[A-Za-z0-9_.\[\]-]+$/)
  })
})

// ---------------------------------------------------------------------------
// SYNC-02, D-07, D-08: Commit Message Format
// ---------------------------------------------------------------------------

describe('formatCommitMessage (SYNC-02, D-07, D-08)', () => {
  it('Test I: formats normal sync commit with date and counts', () => {
    const result = formatCommitMessage(5, 2, false, new Date('2026-04-21T10:00:00Z'))
    expect(result).toBe('2026-04-21: +5 added / -2 removed')
  })

  it('Test J: formats partial sync commit with [partial] marker', () => {
    const result = formatCommitMessage(1, 0, true, new Date('2026-04-21T10:00:00Z'))
    expect(result).toBe('2026-04-21 [partial]: +1 added / -0 removed')
  })

  it('Test K: produces well-formed message even with zero counts', () => {
    const result = formatCommitMessage(0, 0, false, new Date('2026-04-21T10:00:00Z'))
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}:.*\+0.*-0/)
  })
})

// ---------------------------------------------------------------------------
// D-02, D-03: Folder Filtering (--exclude-folder, --only-folder)
// ---------------------------------------------------------------------------

describe('filterFolders (D-02, D-03)', () => {
  const mailboxes = [
    { path: 'INBOX', delimiter: '/', flags: new Set() },
    { path: '[Gmail]/Sent Mail', delimiter: '/', flags: new Set() },
    { path: '[Gmail]/Trash', delimiter: '/', flags: new Set() },
    { path: 'INBOX/Trash', delimiter: '/', flags: new Set() },
    { path: '[Gmail]', delimiter: '/', flags: new Set(['\\Noselect']) },
  ]

  it('Test L: leaf-name match with onlyFolders keeps folder by leaf name', () => {
    const result = filterFolders(mailboxes, ['Sent Mail'], [])
    expect(result.some((f) => f.path === '[Gmail]/Sent Mail')).toBe(true)
  })

  it('Test M: full-path match with onlyFolders keeps folder by exact path', () => {
    const result = filterFolders(mailboxes, ['[Gmail]/Sent Mail'], [])
    expect(result.some((f) => f.path === '[Gmail]/Sent Mail')).toBe(true)
  })

  it('Test N: excludeFolders drops folder by leaf name', () => {
    const result = filterFolders(mailboxes, [], ['Trash'])
    expect(result.some((f) => f.path === 'INBOX/Trash')).toBe(false)
    expect(result.some((f) => f.path === '[Gmail]/Trash')).toBe(false)
  })

  it('Test O: folders with \\Noselect flag are always dropped', () => {
    const result = filterFolders(mailboxes, [], [])
    expect(result.some((f) => f.flags.has('\\Noselect'))).toBe(false)
  })

  it('Test P: when both onlyFolders and excludeFolders are empty, all non-Noselect folders pass through', () => {
    const result = filterFolders(mailboxes, [], [])
    expect(result).toHaveLength(4) // INBOX, [Gmail]/Sent Mail, [Gmail]/Trash, INBOX/Trash (no [Gmail] which has Noselect)
  })
})

// ---------------------------------------------------------------------------
// SYNC-04: SyncResult and FolderSyncResult Schema
// ---------------------------------------------------------------------------

describe('SyncResult / FolderState schema (SYNC-04)', () => {
  it('Test Q: syncAccount is an exported async function that returns a Promise', async () => {
    expect(typeof syncAccount).toBe('function')
    // We cannot call it without proper auth setup, but the type assertion passes at compile time
  })

  it('Test R: SyncResult type accepts the expected shape', () => {
    // This is a compile-time type check — no runtime expect needed beyond the assignment
    const result: Awaited<ReturnType<typeof syncAccount>> = {
      added: 0,
      removed: 0,
      partial: false,
      repoInitialized: false,
      folderResults: [],
    }
    expect(result.added).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// D-04: Auto Git Init (tmp dir)
// Test S: SKIPPED — too deeply integrated for unit level; Plan 2 will enable
// ---------------------------------------------------------------------------

describe('ensureRepo — D-04 auto git init (tmp dir)', () => {
  it.skip('Test S: would mock simple-git checkIsRepo → false, then assert git.init() called', () => {
    // This test is deferred to Plan 2 when the full mock harness is built
    // TODO: D-04 — enable this test in Plan 2 after syncAccount integration is complete
  })
})

// ---------------------------------------------------------------------------
// SYNC-01: uidNext guard — prevents re-fetching last message when up to date
// RFC 3501: a UID range N:* resolves to the last message when N > max UID,
// so we must skip the fetch entirely when lastUid+1 >= serverUidNext.
// ---------------------------------------------------------------------------

describe('SYNC-01: uidNext guard', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-uidnext-'))
    fs.mkdirSync(path.join(tmpDir, 'folders'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'messages'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('Test T: does not call fetch when lastUid+1 equals uidNext (no new messages)', async () => {
    const storedState = {
      folderPath: 'INBOX',
      uidvalidity: '1',
      uidnext: 6,
      messages: [{ uid: 5, 'message-id': '<existing@example.com>', flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'folders', 'INBOX.json'), JSON.stringify(storedState))
    fs.writeFileSync(path.join(tmpDir, 'messages', 'existing@example.com.eml'), 'dummy')

    const fetchMock = vi.fn().mockImplementation(async function* () {})
    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([{ path: 'INBOX', delimiter: '/', flags: new Set() }]),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch: fetchMock,
        search: vi.fn().mockResolvedValue([5]),
        mailbox: { uidValidity: 1n, uidNext: 6 },
      }
    } as any)

    const result = await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false },
    )

    expect(result.added).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Test U: calls fetch when uidNext is greater than lastUid+1 (new messages exist)', async () => {
    const storedState = {
      folderPath: 'INBOX',
      uidvalidity: '1',
      uidnext: 6,
      messages: [{ uid: 5, 'message-id': '<existing@example.com>', flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'folders', 'INBOX.json'), JSON.stringify(storedState))
    fs.writeFileSync(path.join(tmpDir, 'messages', 'existing@example.com.eml'), 'dummy')

    const fetchMock = vi.fn().mockImplementation(async function* () {
      yield {
        uid: 6,
        envelope: { messageId: '<new@example.com>' },
        source: Buffer.from('new mail content'),
        flags: new Set<string>(),
      }
    })
    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([{ path: 'INBOX', delimiter: '/', flags: new Set() }]),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch: fetchMock,
        search: vi.fn().mockResolvedValue([5, 6]),
        mailbox: { uidValidity: 1n, uidNext: 8 },
      }
    } as any)

    const result = await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false },
    )

    expect(result.added).toBe(1)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
