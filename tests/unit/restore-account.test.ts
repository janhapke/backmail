import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'
import { restoreAccount } from '../../src/core/restore.js'

// ── Hoisted mock refs ────────────────────────────────────────────────────────

const mockFsReaddir = vi.hoisted(() => vi.fn())
const mockFsReadFile = vi.hoisted(() => vi.fn())

const mockImapClient = vi.hoisted(() => ({
  connect:         vi.fn().mockResolvedValue(undefined),
  logout:          vi.fn().mockResolvedValue(undefined),
  getMailboxLock:  vi.fn(),
  append:          vi.fn().mockResolvedValue(undefined),
  mailboxCreate:   vi.fn().mockResolvedValue(undefined),
  search:          vi.fn().mockResolvedValue([]),
}))

const mockCheckoutCommit = vi.hoisted(() => vi.fn())

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  default: { readdir: mockFsReaddir, readFile: mockFsReadFile },
}))

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(function () { return mockImapClient }),
}))

vi.mock('../../src/core/browse.js', () => ({
  checkoutCommit: mockCheckoutCommit,
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

type FolderMessage = { 'message-id': string; filename?: string }
type FolderDef = { path: string; messages: FolderMessage[] }

function mockDirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir }
}

/**
 * Wire up fs mocks to simulate the new folder-based repo layout.
 * Each folder becomes a directory containing .backmail_state.json.
 * Only single-level folder paths are supported here.
 */
function setupFs(folders: FolderDef[]) {
  mockFsReaddir.mockImplementation(async (dirPath: unknown) => {
    const p = dirPath as string
    if (p === ARCHIVE) {
      return folders.map(f => mockDirent(f.path, true))
    }
    const folder = folders.find(f => p === path.join(ARCHIVE, f.path))
    if (folder) return [mockDirent('.backmail_state.json', false)]
    return []
  })

  mockFsReadFile.mockImplementation(async (filePath: unknown, encoding?: unknown) => {
    const p = filePath as string
    if (encoding === 'utf-8') {
      const folder = folders.find(f => p === path.join(ARCHIVE, f.path, '.backmail_state.json'))
      if (folder) {
        const msgs = folder.messages.map(m => ({ filename: 'fixture', ...m }))
        return JSON.stringify({ folderPath: folder.path, messages: msgs })
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }
    return Buffer.from('From: test@example.com\r\n\r\nTest email body')
  })
}

const TARGET_URL = 'imap://user:pass@localhost:143'
const ARCHIVE = '/fake/archive'

const OPTS_PLAIN     = { skipDuplicates: false, dryRun: false, verbose: false }
const OPTS_DRY       = { skipDuplicates: false, dryRun: true,  verbose: false }
const OPTS_SKIP      = { skipDuplicates: true,  dryRun: false, verbose: false }
const OPTS_DRY_SKIP  = { skipDuplicates: true,  dryRun: true,  verbose: false }
const OPTS_VERBOSE   = { skipDuplicates: false, dryRun: false, verbose: true  }

// ── Tests ────────────────────────────────────────────────────────────────────

describe('restoreAccount() – dry-run mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockImapClient.connect.mockResolvedValue(undefined)
    mockImapClient.logout.mockResolvedValue(undefined)
    mockImapClient.getMailboxLock.mockResolvedValue({ release: vi.fn() })
    mockImapClient.append.mockResolvedValue(undefined)
    mockImapClient.mailboxCreate.mockResolvedValue(undefined)
    mockImapClient.search.mockResolvedValue([])
  })

  it('counts messages without connecting to IMAP (skipDuplicates=false)', async () => {
    setupFs([{
      path: 'INBOX',
      messages: [
        { 'message-id': '<msg1@example.com>' },
        { 'message-id': '<msg2@example.com>' },
      ],
    }])

    const result = await restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_DRY)

    expect(result.uploaded).toBe(2)
    expect(result.errors).toBe(0)
    expect(result.skipped).toBe(0)
    expect(mockImapClient.connect).not.toHaveBeenCalled()
    expect(mockImapClient.append).not.toHaveBeenCalled()
  })

  it('uses a read-only IMAP connection for duplicate checks when skipDuplicates=true', async () => {
    setupFs([{
      path: 'INBOX',
      messages: [
        { 'message-id': '<dup@example.com>' },
        { 'message-id': '<new@example.com>' },
      ],
    }])
    mockImapClient.search
      .mockResolvedValueOnce([1])  // dup@  → duplicate
      .mockResolvedValueOnce([])   // new@  → not duplicate

    const result = await restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_DRY_SKIP)

    expect(result.skipped).toBe(1)
    expect(result.uploaded).toBe(1)
    expect(mockImapClient.connect).toHaveBeenCalledTimes(1)
    expect(mockImapClient.append).not.toHaveBeenCalled()
  })
})

describe('restoreAccount() – normal mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockImapClient.connect.mockResolvedValue(undefined)
    mockImapClient.logout.mockResolvedValue(undefined)
    mockImapClient.getMailboxLock.mockResolvedValue({ release: vi.fn() })
    mockImapClient.append.mockResolvedValue(undefined)
    mockImapClient.mailboxCreate.mockResolvedValue(undefined)
    mockImapClient.search.mockResolvedValue([])
  })

  it('connects, creates folders, appends all messages, then logs out', async () => {
    setupFs([{
      path: 'INBOX',
      messages: [
        { 'message-id': '<a@example.com>' },
        { 'message-id': '<b@example.com>' },
      ],
    }])

    const result = await restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_PLAIN)

    expect(result.uploaded).toBe(2)
    expect(result.errors).toBe(0)
    expect(mockImapClient.connect).toHaveBeenCalledTimes(1)
    expect(mockImapClient.mailboxCreate).toHaveBeenCalledWith('INBOX')
    expect(mockImapClient.append).toHaveBeenCalledTimes(2)
    expect(mockImapClient.logout).toHaveBeenCalled()
  })

  it('skips duplicate messages and uploads the rest (skipDuplicates=true)', async () => {
    setupFs([{
      path: 'INBOX',
      messages: [
        { 'message-id': '<dup@example.com>' },
        { 'message-id': '<new@example.com>' },
      ],
    }])
    mockImapClient.search
      .mockResolvedValueOnce([1])
      .mockResolvedValueOnce([])

    const result = await restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_SKIP)

    expect(result.skipped).toBe(1)
    expect(result.uploaded).toBe(1)
    expect(mockImapClient.append).toHaveBeenCalledTimes(1)
  })

  it('increments errors when .eml file cannot be read', async () => {
    setupFs([{
      path: 'INBOX',
      messages: [{ 'message-id': '<missing@example.com>' }],
    }])
    mockFsReadFile.mockImplementation(async (_path: unknown, encoding?: unknown) => {
      if (encoding === 'utf-8')
        return JSON.stringify({ folderPath: 'INBOX', messages: [{ filename: 'fixture', 'message-id': '<missing@example.com>' }] })
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const result = await restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_PLAIN)

    expect(result.errors).toBe(1)
    expect(result.uploaded).toBe(0)
  })

  it('increments errors when folder creation fails with a non-ALREADYEXISTS error', async () => {
    setupFs([{ path: 'NewFolder', messages: [] }])
    mockImapClient.mailboxCreate.mockRejectedValue(new Error('Permission denied'))

    const result = await restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_PLAIN)

    expect(result.errors).toBe(1)
  })

  it('silently skips folders with malformed .backmail_state.json without incrementing errors', async () => {
    mockFsReaddir.mockImplementation(async (dirPath: unknown) => {
      const p = dirPath as string
      if (p === ARCHIVE) return [mockDirent('INBOX', true), mockDirent('BrokenFolder', true)]
      if (p === path.join(ARCHIVE, 'INBOX')) return [mockDirent('.backmail_state.json', false)]
      if (p === path.join(ARCHIVE, 'BrokenFolder')) return [mockDirent('.backmail_state.json', false)]
      return []
    })
    mockFsReadFile.mockImplementation(async (filePath: unknown, encoding?: unknown) => {
      const p = filePath as string
      if (p.includes('BrokenFolder') && encoding === 'utf-8') return '{ invalid json'
      if (p.includes('INBOX') && encoding === 'utf-8')
        return JSON.stringify({ folderPath: 'INBOX', messages: [{ filename: 'fixture', 'message-id': '<ok@example.com>' }] })
      return Buffer.from('email')
    })

    const result = await restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_PLAIN)

    // BrokenFolder silently skipped; INBOX still processed
    expect(result.uploaded).toBe(1)
    expect(result.errors).toBe(0)
  })

  it('increments errors when a folder state file is unreadable during message processing', async () => {
    let readCount = 0
    mockFsReaddir.mockImplementation(async (dirPath: unknown) => {
      const p = dirPath as string
      if (p === ARCHIVE) return [mockDirent('INBOX', true)]
      if (p === path.join(ARCHIVE, 'INBOX')) return [mockDirent('.backmail_state.json', false)]
      return []
    })
    mockFsReadFile.mockImplementation(async (_path: unknown, encoding?: unknown) => {
      if (encoding === 'utf-8') {
        readCount++
        if (readCount === 1)
          return JSON.stringify({ folderPath: 'INBOX', messages: [{ filename: 'fixture', 'message-id': '<m@x.com>' }] })
        throw new Error('ENOENT')
      }
      return Buffer.from('email')
    })

    const result = await restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_PLAIN)

    expect(result.errors).toBe(1)
    expect(result.uploaded).toBe(0)
  })

  it('handles multiple folders correctly', async () => {
    setupFs([
      { path: 'INBOX', messages: [{ 'message-id': '<i1@x.com>' }] },
      { path: 'Sent',  messages: [{ 'message-id': '<s1@x.com>' }, { 'message-id': '<s2@x.com>' }] },
    ])

    const result = await restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_PLAIN)

    expect(result.uploaded).toBe(3)
    expect(mockImapClient.mailboxCreate).toHaveBeenCalledTimes(2)
  })

  it('returns zero counts when archive has no folders', async () => {
    mockFsReaddir.mockResolvedValue([])

    const result = await restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_PLAIN)

    expect(result.uploaded).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors).toBe(0)
  })

  it('logs Uploaded/Skipped/Error lines when verbose=true', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setupFs([{
      path: 'INBOX',
      messages: [{ 'message-id': '<v@example.com>' }],
    }])

    await restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_VERBOSE)

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Uploaded'))
    spy.mockRestore()
  })

  it('logs Skipped when verbose=true and message is a duplicate', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setupFs([{ path: 'INBOX', messages: [{ 'message-id': '<d@example.com>' }] }])
    mockImapClient.search.mockResolvedValue([1])

    await restoreAccount(ARCHIVE, TARGET_URL, undefined, { ...OPTS_VERBOSE, skipDuplicates: true })

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Skipped'))
    spy.mockRestore()
  })

  it('logs Error when verbose=true and message upload fails', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    setupFs([{ path: 'INBOX', messages: [{ 'message-id': '<e@example.com>' }] }])
    mockFsReadFile.mockImplementation(async (_path: unknown, encoding?: unknown) => {
      if (encoding === 'utf-8')
        return JSON.stringify({ folderPath: 'INBOX', messages: [{ filename: 'fixture', 'message-id': '<e@example.com>' }] })
      throw new Error('read failed')
    })

    await restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_VERBOSE)

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Error'))
    spy.mockRestore()
  })

  it('calls checkoutCommit and uses the returned path when dateOrCommit is provided', async () => {
    mockCheckoutCommit.mockResolvedValue({ path: '/fake/checkout' })
    mockFsReaddir.mockResolvedValue([])

    await restoreAccount(ARCHIVE, TARGET_URL, 'abc1234', OPTS_PLAIN)

    expect(mockCheckoutCommit).toHaveBeenCalledWith(ARCHIVE, 'abc1234', expect.stringContaining('worktrees'))
  })

  it('always calls logout even if an error occurs during processing', async () => {
    mockFsReaddir.mockRejectedValue(new Error('readdir failed'))

    await expect(
      restoreAccount(ARCHIVE, TARGET_URL, undefined, OPTS_PLAIN)
    ).rejects.toThrow('readdir failed')

    expect(mockImapClient.logout).toHaveBeenCalled()
  })
})

describe('parseImapUrl() – missing coverage', () => {
  it('throws when URL string is completely invalid', async () => {
    const { parseImapUrl } = await import('../../src/core/restore.js')
    expect(() => parseImapUrl('not a url')).toThrow(/Invalid URL/)
  })

  it('throws when URL has no username', async () => {
    const { parseImapUrl } = await import('../../src/core/restore.js')
    expect(() => parseImapUrl('imap://:pass@localhost')).toThrow(/must include username/)
  })
})
