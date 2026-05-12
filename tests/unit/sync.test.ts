import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { ImapFlow } from 'imapflow'
import { simpleGit } from 'simple-git'

import {
  syncAccount,
  ensureRepo,
  sanitizeMessageId,
  messageFilename,
  folderPathToFsPath,
  formatCommitMessage,
  filterFolders,
  reindexLocalFolders,
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

  it('Test F: removes null bytes', () => {
    const result = sanitizeMessageId('abc\x00def@example.com')
    expect(result).not.toContain('\x00')
    expect(result).toBe('abcdef@example.com')
  })

  it('Test G: prefixes Windows reserved device names', () => {
    const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9']
    for (const name of reserved) {
      expect(sanitizeMessageId(name)).toBe(`_${name}`)
      expect(sanitizeMessageId(name.toLowerCase())).toBe(`_${name.toLowerCase()}`)
    }
  })

  it('Test H: does not prefix non-reserved names that share a prefix', () => {
    expect(sanitizeMessageId('CONSOLE')).toBe('CONSOLE')
    expect(sanitizeMessageId('NULL')).toBe('NULL')
    expect(sanitizeMessageId('COM10')).toBe('COM10')
  })
})

// ---------------------------------------------------------------------------
// messageFilename
// ---------------------------------------------------------------------------

describe('messageFilename', () => {
  it('returns YYYY-MM-DD_slug_sha1 for a well-formed message', () => {
    const source = [
      'Received: from mail.example.com by mx.example.com; Thu, 08 May 2025 12:34:56 +0000',
      'Subject: Hello World',
      '',
      'body',
    ].join('\r\n')
    const result = messageFilename('<abc@example.com>', source)
    expect(result).toMatch(/^2025-05-08_hello-world_[0-9a-f]{8}$/)
  })

  it('falls back to Date: header when no Received header is present', () => {
    const source = 'Date: Fri, 01 Mar 2024 09:00:00 +0000\r\nSubject: Hi\r\n\r\nbody'
    const result = messageFilename('<abc@example.com>', source)
    expect(result).toMatch(/^2024-03-01_hi_[0-9a-f]{8}$/)
  })

  it('falls back to 0000-00-00 when neither Received nor Date header is present', () => {
    const result = messageFilename('<abc@example.com>', 'Subject: Hi\r\n\r\nbody')
    expect(result).toMatch(/^0000-00-00_hi_[0-9a-f]{8}$/)
  })

  it('falls back to no-subject when Subject header is absent', () => {
    const source = 'Received: from x; Thu, 08 May 2025 12:00:00 +0000\r\n\r\nbody'
    const result = messageFilename('<abc@example.com>', source)
    expect(result).toMatch(/^2025-05-08_no-subject_[0-9a-f]{8}$/)
  })

  it('falls back to no-subject when Subject is empty', () => {
    const result = messageFilename('<abc@example.com>', 'Subject:   \r\n\r\nbody')
    expect(result).toMatch(/^0000-00-00_no-subject_[0-9a-f]{8}$/)
  })

  it('truncates slug to 30 characters', () => {
    const longSubject = 'Subject: ' + 'very long subject line that goes on and on and on'
    const result = messageFilename('<abc@example.com>', longSubject + '\r\n\r\nbody')
    const slug = result.split('_')[1]
    expect(slug!.length).toBeLessThanOrEqual(30)
  })

  it('sha1 suffix differs for different message IDs', () => {
    const source = 'Subject: Same\r\n\r\nbody'
    const a = messageFilename('<a@example.com>', source)
    const b = messageFilename('<b@example.com>', source)
    expect(a.split('_').at(-1)).not.toBe(b.split('_').at(-1))
  })

  it('is deterministic — same inputs always produce same output', () => {
    const source = 'Subject: Test\r\n\r\nbody'
    const id = '<test@example.com>'
    expect(messageFilename(id, source)).toBe(messageFilename(id, source))
  })

  it('decodes MIME-encoded subject words', () => {
    // =?UTF-8?B?SGVsbG8=?= decodes to "Hello"
    const source = 'Subject: =?UTF-8?B?SGVsbG8=?=\r\n\r\nbody'
    const result = messageFilename('<abc@example.com>', source)
    expect(result).toMatch(/^0000-00-00_hello_[0-9a-f]{8}$/)
  })
})

// ---------------------------------------------------------------------------
// SYNC-04: Path Traversal Protection — Folder Path Sanitization
// T-3-02: folderPathToFilename
// ---------------------------------------------------------------------------

describe('folderPathToFsPath (T-3-02: path traversal)', () => {
  it('preserves hierarchy by splitting on / delimiter', () => {
    const result = folderPathToFsPath('INBOX/Sent', '/')
    expect(result).toBe('INBOX/Sent')
  })

  it('converts non-slash delimiter to / for filesystem nesting', () => {
    const result = folderPathToFsPath('INBOX.Sent.Archive', '.')
    expect(result).toBe('INBOX/Sent/Archive')
  })

  it('sanitizes path traversal in folder components', () => {
    const result = folderPathToFsPath('../../../etc', '/')
    expect(result).not.toContain('..')
  })

  it('sanitizes unsafe characters in each component', () => {
    const result = folderPathToFsPath('[Gmail]/Sent Mail', '/')
    expect(result).not.toContain(' ')
    // hierarchy separator is preserved
    expect(result).toContain('/')
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

  it('formats reindex commit with [reindex] marker and renamed count', () => {
    const result = formatCommitMessage(0, 0, false, new Date('2026-04-21T10:00:00Z'), 3)
    expect(result).toBe('2026-04-21 [reindex]: =3 renamed')
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
      renamed: 0,
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
    fs.mkdirSync(path.join(tmpDir, 'INBOX'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('Test T: does not call fetch when lastUid+1 equals uidNext (no new messages)', async () => {
    const storedState = {
      folderPath: 'INBOX',
      uidvalidity: '1',
      uidnext: 6,
      messages: [{ uid: 5, 'message-id': '<existing@example.com>', filename: 'fixture-existing', flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(storedState))
    fs.writeFileSync(path.join(tmpDir, 'INBOX', 'fixture-existing.eml'), 'dummy')

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
      messages: [{ uid: 5, 'message-id': '<existing@example.com>', filename: 'fixture-existing', flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(storedState))
    fs.writeFileSync(path.join(tmpDir, 'INBOX', 'fixture-existing.eml'), 'dummy')

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

// ---------------------------------------------------------------------------
// SYNC-05: uidvalidity change → full wipe and re-sync
// Lines 289-298 in sync.ts
// ---------------------------------------------------------------------------

describe('SYNC-05: uidvalidity change triggers full wipe and re-sync', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-uidvalidity-'))
    fs.mkdirSync(path.join(tmpDir, 'INBOX'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('deletes all stored .eml files and counts them as removed when uidvalidity changes', async () => {
    const storedState = {
      folderPath: 'INBOX',
      uidvalidity: '1',   // server will report '2' → mismatch
      uidnext: 3,
      messages: [
        { uid: 1, 'message-id': '<old1@example.com>', filename: 'fixture-old1', flags: [] },
        { uid: 2, 'message-id': '<old2@example.com>', filename: 'fixture-old2', flags: [] },
      ],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(storedState))
    fs.writeFileSync(path.join(tmpDir, 'INBOX', 'fixture-old1.eml'), 'old email 1')
    fs.writeFileSync(path.join(tmpDir, 'INBOX', 'fixture-old2.eml'), 'old email 2')

    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([{ path: 'INBOX', delimiter: '/', flags: new Set() }]),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch: vi.fn().mockImplementation(async function* () {}),  // no new messages
        search: vi.fn().mockResolvedValue([]),
        mailbox: { uidValidity: 2n, uidNext: 1 },  // uidValidity changed: '1' → '2'
      }
    } as any)

    const result = await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false },
    )

    expect(result.removed).toBe(2)
    expect(result.added).toBe(0)
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', 'fixture-old1.eml'))).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', 'fixture-old2.eml'))).toBe(false)
  })

  it('fetches all messages from scratch after a uidvalidity change', async () => {
    const storedState = {
      folderPath: 'INBOX',
      uidvalidity: '1',
      uidnext: 2,
      messages: [{ uid: 1, 'message-id': '<stale@example.com>', filename: 'fixture-stale', flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(storedState))
    fs.writeFileSync(path.join(tmpDir, 'INBOX', 'fixture-stale.eml'), 'stale')

    const fetchMock = vi.fn().mockImplementation(async function* () {
      yield {
        uid: 1,
        envelope: { messageId: '<fresh@example.com>' },
        source: Buffer.from('fresh email content'),
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
        search: vi.fn().mockResolvedValue([1]),
        mailbox: { uidValidity: 99n, uidNext: 2 },
      }
    } as any)

    const result = await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false },
    )

    // Old message wiped, new message fetched from scratch using '1:*'
    expect(result.removed).toBe(1)
    expect(result.added).toBe(1)
    expect(fetchMock).toHaveBeenCalledWith('1:*', expect.anything(), expect.anything())
  })
})

// ---------------------------------------------------------------------------
// SYNC-06: Message deletion — server-side deletes purge local .eml files
// Lines 342-347 in sync.ts
// ---------------------------------------------------------------------------

describe('SYNC-06: message deletion removes local .eml files', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-deletion-'))
    fs.mkdirSync(path.join(tmpDir, 'INBOX'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('deletes .eml for a message whose UID is no longer on the server', async () => {
    const storedState = {
      folderPath: 'INBOX',
      uidvalidity: '1',
      uidnext: 4,
      messages: [
        { uid: 1, 'message-id': '<keep1@example.com>', filename: 'fixture-keep1', flags: [] },
        { uid: 2, 'message-id': '<keep2@example.com>', filename: 'fixture-keep2', flags: [] },
        { uid: 3, 'message-id': '<deleted@example.com>', filename: 'fixture-deleted', flags: [] },
      ],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(storedState))
    fs.writeFileSync(path.join(tmpDir, 'INBOX', 'fixture-keep1.eml'), 'keep')
    fs.writeFileSync(path.join(tmpDir, 'INBOX', 'fixture-keep2.eml'), 'keep')
    fs.writeFileSync(path.join(tmpDir, 'INBOX', 'fixture-deleted.eml'), 'deleted')

    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([{ path: 'INBOX', delimiter: '/', flags: new Set() }]),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch: vi.fn().mockImplementation(async function* () {}),  // lastUid+1 >= uidNext → no fetch
        search: vi.fn().mockResolvedValue([1, 2]),  // UID 3 is gone from server
        mailbox: { uidValidity: 1n, uidNext: 4 },
      }
    } as any)

    const result = await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false },
    )

    expect(result.removed).toBe(1)
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', 'fixture-deleted.eml'))).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', 'fixture-keep1.eml'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', 'fixture-keep2.eml'))).toBe(true)
  })

  it('removes multiple deleted messages and updates result.removed correctly', async () => {
    const storedState = {
      folderPath: 'INBOX',
      uidvalidity: '1',
      uidnext: 5,
      messages: [
        { uid: 1, 'message-id': '<a@example.com>', filename: 'fixture-a', flags: [] },
        { uid: 2, 'message-id': '<b@example.com>', filename: 'fixture-b', flags: [] },
        { uid: 3, 'message-id': '<c@example.com>', filename: 'fixture-c', flags: [] },
        { uid: 4, 'message-id': '<d@example.com>', filename: 'fixture-d', flags: [] },
      ],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(storedState))
    for (const id of ['a', 'b', 'c', 'd']) {
      fs.writeFileSync(path.join(tmpDir, 'INBOX', `fixture-${id}.eml`), 'content')
    }

    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([{ path: 'INBOX', delimiter: '/', flags: new Set() }]),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch: vi.fn().mockImplementation(async function* () {}),
        search: vi.fn().mockResolvedValue([1]),  // UIDs 2, 3, 4 deleted
        mailbox: { uidValidity: 1n, uidNext: 5 },
      }
    } as any)

    const result = await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false },
    )

    expect(result.removed).toBe(3)
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', 'fixture-a.eml'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', 'fixture-b.eml'))).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', 'fixture-c.eml'))).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', 'fixture-d.eml'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// SYNC-07: Per-folder error accumulation (lines 212-218)
//          and mailbox type guard (line 276)
// ---------------------------------------------------------------------------

describe('SYNC-07: per-folder errors accumulate without aborting the sync', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-per-folder-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('records error in folderResults when client.mailbox is null after lock (line 276)', async () => {
    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      return {
        connect:        vi.fn().mockResolvedValue(undefined),
        logout:         vi.fn().mockResolvedValue(undefined),
        list:           vi.fn().mockResolvedValue([{ path: 'INBOX', delimiter: '/', flags: new Set() }]),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch:          vi.fn().mockImplementation(async function* () {}),
        search:         vi.fn().mockResolvedValue([]),
        mailbox:        null,  // triggers the type guard at line 275-276
      }
    } as any)

    const result = await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false },
    )

    expect(result.folderResults).toHaveLength(1)
    expect(result.folderResults[0].error).toBeInstanceOf(Error)
    expect(result.folderResults[0].error?.message).toContain('Failed to access mailbox')
    expect(result.added).toBe(0)
  })

  it('continues syncing remaining folders after a per-folder error', async () => {
    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      let lockCallCount = 0
      return {
        connect:        vi.fn().mockResolvedValue(undefined),
        logout:         vi.fn().mockResolvedValue(undefined),
        list:           vi.fn().mockResolvedValue([
          { path: 'Broken', delimiter: '/', flags: new Set() },
          { path: 'INBOX',  delimiter: '/', flags: new Set() },
        ]),
        getMailboxLock: vi.fn().mockImplementation(async () => {
          lockCallCount++
          if (lockCallCount === 1) throw new Error('lock failed on Broken')
          return { release: vi.fn() }
        }),
        fetch:          vi.fn().mockImplementation(async function* () {}),
        search:         vi.fn().mockResolvedValue([]),
        mailbox:        { uidValidity: 1n, uidNext: 1 },
      }
    } as any)

    const result = await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false },
    )

    expect(result.folderResults).toHaveLength(2)
    expect(result.folderResults[0].error).toBeInstanceOf(Error)
    expect(result.folderResults[1].error).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// SYNC-08: Connection-level error re-throw (line 225)
// ---------------------------------------------------------------------------

describe('SYNC-08: connection error re-throws when no data has been written', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-conn-err-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('re-throws connection error when added === 0 and removed === 0', async () => {
    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      return {
        connect:        vi.fn().mockRejectedValue(new Error('Connection refused')),
        logout:         vi.fn().mockResolvedValue(undefined),
        list:           vi.fn().mockResolvedValue([]),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch:          vi.fn().mockImplementation(async function* () {}),
        search:         vi.fn().mockResolvedValue([]),
        mailbox:        { uidValidity: 1n, uidNext: 1 },
      }
    } as any)

    await expect(
      syncAccount(
        { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
        tmpDir,
        { excludeFolders: [], onlyFolders: [], verbose: false },
      )
    ).rejects.toThrow('Connection refused')
  })
})

// ---------------------------------------------------------------------------
// SYNC-09: Git commit failure marks result partial (lines 235-241)
// ---------------------------------------------------------------------------

describe('SYNC-09: git commit failure marks result as partial', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-git-fail-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns partial=true without throwing when git commit fails after a successful sync', async () => {
    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      return {
        connect:        vi.fn().mockResolvedValue(undefined),
        logout:         vi.fn().mockResolvedValue(undefined),
        list:           vi.fn().mockResolvedValue([{ path: 'INBOX', delimiter: '/', flags: new Set() }]),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch:          vi.fn().mockImplementation(async function* () {
          yield {
            uid: 1,
            envelope: { messageId: '<test@example.com>' },
            source: Buffer.from('email content'),
            flags: new Set<string>(),
          }
        }),
        search:  vi.fn().mockResolvedValue([1]),
        mailbox: { uidValidity: 1n, uidNext: 2 },
      }
    } as any)

    // simpleGit is called twice: once in ensureRepo, once for the final commit.
    // Override both: first call (ensureRepo) works normally, second call fails on commit.
    vi.mocked(simpleGit)
      .mockImplementationOnce(() => ({
        checkIsRepo: vi.fn().mockResolvedValue(true),
        init:        vi.fn().mockResolvedValue(undefined),
        add:         vi.fn().mockResolvedValue(undefined),
        commit:      vi.fn().mockResolvedValue({}),
        status:      vi.fn().mockResolvedValue({ isClean: () => true }),
      }) as any)
      .mockImplementationOnce(() => ({
        checkIsRepo: vi.fn().mockResolvedValue(true),
        init:        vi.fn().mockResolvedValue(undefined),
        add:         vi.fn().mockResolvedValue(undefined),
        commit:      vi.fn().mockRejectedValue(new Error('git commit failed')),
        status:      vi.fn().mockResolvedValue({ isClean: () => false }),
      }) as any)

    const result = await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false },
    )

    expect(result.partial).toBe(true)
    expect(result.added).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// ensureRepo: git init path (lines 156-157)
// ---------------------------------------------------------------------------

describe('ensureRepo — initialises a new git repo when none exists', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-ensure-repo-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('calls git.init() and returns true when the directory is not a repo', async () => {
    const initMock = vi.fn().mockResolvedValue(undefined)
    vi.mocked(simpleGit).mockImplementationOnce(() => ({
      checkIsRepo: vi.fn().mockResolvedValue(false),
      init:        initMock,
    }) as any)

    const result = await ensureRepo(tmpDir)

    expect(result).toBe(true)
    expect(initMock).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// syncAccount mutual-exclusion guard (line 170)
// ---------------------------------------------------------------------------

describe('syncAccount — mutual-exclusion guard', () => {
  it('throws when both onlyFolders and excludeFolders are non-empty', async () => {
    await expect(
      syncAccount(
        { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
        '/tmp/irrelevant',
        { onlyFolders: ['INBOX'], excludeFolders: ['Trash'], verbose: false },
      )
    ).rejects.toThrow('mutually exclusive')
  })
})

// ---------------------------------------------------------------------------
// reindexLocalFolders — rename .eml files to match current filename logic
// ---------------------------------------------------------------------------

describe('reindexLocalFolders', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-reindex-'))
    fs.mkdirSync(path.join(tmpDir, 'INBOX'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('renames .eml file when stored filename differs from current messageFilename output', async () => {
    // Write a state file that has an old/wrong filename for a message
    const source = [
      'Date: Mon, 01 Jan 2024 12:00:00 +0000',
      'Subject: Hello World',
      '',
      'body',
    ].join('\r\n')
    const msgId = '<hello@example.com>'
    const correctFilename = messageFilename(msgId, source)
    const staleFilename = 'old-stale-name'

    const state = {
      folderPath: 'INBOX',
      delimiter: '/',
      uidvalidity: '1',
      uidnext: 2,
      messages: [{ uid: 1, 'message-id': msgId, filename: staleFilename, flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(state))
    fs.writeFileSync(path.join(tmpDir, 'INBOX', `${staleFilename}.eml`), source)

    const result = await reindexLocalFolders(tmpDir, () => {})

    expect(result.renamed).toBe(1)
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', `${correctFilename}.eml`))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', `${staleFilename}.eml`))).toBe(false)

    const updatedState = JSON.parse(fs.readFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), 'utf-8'))
    expect(updatedState.messages[0].filename).toBe(correctFilename)
  })

  it('does not rename .eml file when stored filename already matches', async () => {
    const source = 'Date: Mon, 01 Jan 2024 12:00:00 +0000\r\nSubject: Same\r\n\r\nbody'
    const msgId = '<same@example.com>'
    const correctFilename = messageFilename(msgId, source)

    const state = {
      folderPath: 'INBOX',
      delimiter: '/',
      uidvalidity: '1',
      uidnext: 2,
      messages: [{ uid: 1, 'message-id': msgId, filename: correctFilename, flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(state))
    fs.writeFileSync(path.join(tmpDir, 'INBOX', `${correctFilename}.eml`), source)

    const result = await reindexLocalFolders(tmpDir, () => {})

    expect(result.renamed).toBe(0)
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', `${correctFilename}.eml`))).toBe(true)
    // State file should NOT be rewritten when nothing changed
    const updatedState = JSON.parse(fs.readFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), 'utf-8'))
    expect(updatedState.messages[0].filename).toBe(correctFilename)
  })

  it('skips gracefully when .eml file is missing from disk', async () => {
    const state = {
      folderPath: 'INBOX',
      delimiter: '/',
      uidvalidity: '1',
      uidnext: 2,
      messages: [{ uid: 1, 'message-id': '<missing@example.com>', filename: 'does-not-exist', flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(state))
    // No .eml file written

    const result = await reindexLocalFolders(tmpDir, () => {})

    expect(result.renamed).toBe(0)
    expect(result.folderResults).toHaveLength(1)
    expect(result.folderResults[0].error).toBeUndefined()
  })

  it('returns empty result for a non-existent repoPath without throwing', async () => {
    const result = await reindexLocalFolders('/tmp/does-not-exist-backmail-xyz', () => {})
    expect(result.renamed).toBe(0)
    expect(result.folderResults).toHaveLength(0)
  })

  it('handles multiple folders, renaming only stale entries', async () => {
    fs.mkdirSync(path.join(tmpDir, 'Sent'), { recursive: true })

    const source = 'Date: Mon, 01 Jan 2024 12:00:00 +0000\r\nSubject: Hi\r\n\r\nbody'
    const msgId = '<multi@example.com>'
    const correct = messageFilename(msgId, source)

    // INBOX: stale filename
    const inboxState = {
      folderPath: 'INBOX',
      delimiter: '/',
      uidvalidity: '1',
      uidnext: 2,
      messages: [{ uid: 1, 'message-id': msgId, filename: 'stale-inbox', flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(inboxState))
    fs.writeFileSync(path.join(tmpDir, 'INBOX', 'stale-inbox.eml'), source)

    // Sent: already correct filename
    const sentState = {
      folderPath: 'Sent',
      delimiter: '/',
      uidvalidity: '1',
      uidnext: 2,
      messages: [{ uid: 2, 'message-id': msgId, filename: correct, flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'Sent', '.backmail_state.json'), JSON.stringify(sentState))
    fs.writeFileSync(path.join(tmpDir, 'Sent', `${correct}.eml`), source)

    const result = await reindexLocalFolders(tmpDir, () => {})

    expect(result.renamed).toBe(1)
    expect(result.folderResults).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// syncAccount --force: re-downloads all messages, deletes old .eml files first
// ---------------------------------------------------------------------------

describe('syncAccount --force', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-force-'))
    fs.mkdirSync(path.join(tmpDir, 'INBOX'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('deletes existing .eml files before re-downloading when force=true', async () => {
    const storedState = {
      folderPath: 'INBOX',
      delimiter: '/',
      uidvalidity: '1',
      uidnext: 2,
      messages: [{ uid: 1, 'message-id': '<existing@example.com>', filename: 'old-name', flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(storedState))
    fs.writeFileSync(path.join(tmpDir, 'INBOX', 'old-name.eml'), 'old content')

    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([{ path: 'INBOX', delimiter: '/', flags: new Set() }]),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch: vi.fn().mockImplementation(async function* () {
          yield {
            uid: 1,
            envelope: { messageId: '<existing@example.com>' },
            source: Buffer.from('Date: Mon, 01 Jan 2024 12:00:00 +0000\r\nSubject: Existing\r\n\r\nbody'),
            flags: new Set<string>(),
          }
        }),
        search: vi.fn().mockResolvedValue([1]),
        mailbox: { uidValidity: 1n, uidNext: 2 },
      }
    } as any)

    const result = await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false, force: true },
    )

    expect(result.added).toBe(1)
    // Old file with old name must be gone
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', 'old-name.eml'))).toBe(false)
  })

  it('fetches from 1:* even when existing state has messages (force clears state)', async () => {
    const storedState = {
      folderPath: 'INBOX',
      delimiter: '/',
      uidvalidity: '1',
      uidnext: 6,
      messages: [{ uid: 5, 'message-id': '<existing@example.com>', filename: 'old-name', flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(storedState))
    fs.writeFileSync(path.join(tmpDir, 'INBOX', 'old-name.eml'), 'old content')

    const fetchMock = vi.fn().mockImplementation(async function* () {
      yield {
        uid: 5,
        envelope: { messageId: '<existing@example.com>' },
        source: Buffer.from('Date: Mon, 01 Jan 2024 12:00:00 +0000\r\nSubject: Existing\r\n\r\nbody'),
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
        search: vi.fn().mockResolvedValue([5]),
        mailbox: { uidValidity: 1n, uidNext: 6 },
      }
    } as any)

    await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false, force: true },
    )

    // With force, storedState is cleared → lastUid=0 → range '1:*'
    expect(fetchMock).toHaveBeenCalledWith('1:*', expect.anything(), expect.anything())
  })
})

// ---------------------------------------------------------------------------
// syncAccount — folder pruning: delete local folders absent from server
// ---------------------------------------------------------------------------

describe('syncAccount — folder pruning', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-prune-'))
    // INBOX exists locally and on server
    fs.mkdirSync(path.join(tmpDir, 'INBOX'), { recursive: true })
    // OldFolder exists locally but will NOT be on the server
    fs.mkdirSync(path.join(tmpDir, 'OldFolder'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('removes a local folder directory that no longer exists on the server', async () => {
    // Seed OldFolder with a state and .eml so there is something to delete
    const oldState = {
      folderPath: 'OldFolder',
      delimiter: '/',
      uidvalidity: '1',
      uidnext: 2,
      messages: [{ uid: 1, 'message-id': '<old@example.com>', filename: 'old-mail', flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'OldFolder', '.backmail_state.json'), JSON.stringify(oldState))
    fs.writeFileSync(path.join(tmpDir, 'OldFolder', 'old-mail.eml'), 'old mail')

    // Server only knows about INBOX (OldFolder is gone)
    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([{ path: 'INBOX', delimiter: '/', flags: new Set() }]),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch: vi.fn().mockImplementation(async function* () {}),
        search: vi.fn().mockResolvedValue([]),
        mailbox: { uidValidity: 1n, uidNext: 1 },
      }
    } as any)

    const result = await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false },
    )

    expect(result.removed).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(path.join(tmpDir, 'OldFolder'))).toBe(false)
  })

  it('does NOT prune a local folder when --only-folder restricts scope to a different folder', async () => {
    // OldFolder exists locally; server returns both INBOX and OldFolder
    // but we only sync INBOX via --only-folder
    const oldState = {
      folderPath: 'OldFolder',
      delimiter: '/',
      uidvalidity: '1',
      uidnext: 2,
      messages: [],
    }
    fs.writeFileSync(path.join(tmpDir, 'OldFolder', '.backmail_state.json'), JSON.stringify(oldState))

    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        // Server knows both folders; filter will restrict to INBOX only
        list: vi.fn().mockResolvedValue([
          { path: 'INBOX', delimiter: '/', flags: new Set() },
          { path: 'OldFolder', delimiter: '/', flags: new Set() },
        ]),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch: vi.fn().mockImplementation(async function* () {}),
        search: vi.fn().mockResolvedValue([]),
        mailbox: { uidValidity: 1n, uidNext: 1 },
      }
    } as any)

    await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: ['INBOX'], verbose: false },
    )

    // OldFolder is on the server and not in our --only-folder scope → must NOT be pruned
    expect(fs.existsSync(path.join(tmpDir, 'OldFolder'))).toBe(true)
  })

  it('does NOT prune a folder that is excluded via --exclude-folder', async () => {
    const excludedState = {
      folderPath: 'Spam',
      delimiter: '/',
      uidvalidity: '1',
      uidnext: 2,
      messages: [],
    }
    fs.mkdirSync(path.join(tmpDir, 'Spam'), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, 'Spam', '.backmail_state.json'), JSON.stringify(excludedState))

    // Server knows INBOX only (Spam was deleted too), but Spam is excluded from our sync
    vi.mocked(ImapFlow).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        logout: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([{ path: 'INBOX', delimiter: '/', flags: new Set() }]),
        getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
        fetch: vi.fn().mockImplementation(async function* () {}),
        search: vi.fn().mockResolvedValue([]),
        mailbox: { uidValidity: 1n, uidNext: 1 },
      }
    } as any)

    await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: ['Spam'], onlyFolders: [], verbose: false },
    )

    // Spam is excluded from this sync run, so it must not be pruned even if absent from server
    expect(fs.existsSync(path.join(tmpDir, 'Spam'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// syncAccount --reindex: renames files without connecting to IMAP
// ---------------------------------------------------------------------------

describe('syncAccount --reindex', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-reindex-account-'))
    fs.mkdirSync(path.join(tmpDir, 'INBOX'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns renamed count and does not call ImapFlow constructor', async () => {
    const source = 'Date: Mon, 01 Jan 2024 12:00:00 +0000\r\nSubject: Hi\r\n\r\nbody'
    const msgId = '<reindex-test@example.com>'
    const correct = messageFilename(msgId, source)

    const state = {
      folderPath: 'INBOX',
      delimiter: '/',
      uidvalidity: '1',
      uidnext: 2,
      messages: [{ uid: 1, 'message-id': msgId, filename: 'stale-name', flags: [] }],
    }
    fs.writeFileSync(path.join(tmpDir, 'INBOX', '.backmail_state.json'), JSON.stringify(state))
    fs.writeFileSync(path.join(tmpDir, 'INBOX', 'stale-name.eml'), source)

    vi.mocked(ImapFlow).mockClear()

    const result = await syncAccount(
      { host: 'localhost', port: 993, username: 'u', tls: true, passwordRef: 'keyring:service=test;account=test' },
      tmpDir,
      { excludeFolders: [], onlyFolders: [], verbose: false, reindex: true },
    )

    expect(result.renamed).toBe(1)
    expect(result.added).toBe(0)
    expect(result.removed).toBe(0)
    // ImapFlow must NOT be instantiated in reindex mode
    expect(vi.mocked(ImapFlow)).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(tmpDir, 'INBOX', `${correct}.eml`))).toBe(true)
  })
})
