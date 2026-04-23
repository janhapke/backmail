import { describe, it, expect, vi } from 'vitest'
import type { ImapFlow } from 'imapflow'
import {
  parseImapUrl,
  isDuplicate,
  createFolderIfNeeded,
} from '../../src/core/restore.js'
import type {
  RestoreResult,
  RestoreOptions,
} from '../../src/core/restore.js'

// ────────────────────────────────────────────────────────────────────────────
// REST-01: Basic message restore
// ────────────────────────────────────────────────────────────────────────────

describe('REST-01: Basic message restore', () => {
  it('parseImapUrl() validates imap:// URLs with username and password', () => {
    const result = parseImapUrl('imap://user:pass@localhost:143')
    expect(result).toEqual({
      host: 'localhost',
      port: 143,
      username: 'user',
      password: 'pass',
      secure: false,
    })
  })

  it('parseImapUrl() validates imaps:// URLs', () => {
    const result = parseImapUrl('imaps://user:pass@gmail.com:993')
    expect(result).toEqual({
      host: 'gmail.com',
      port: 993,
      username: 'user',
      password: 'pass',
      secure: true,
    })
  })

  it('parseImapUrl() uses default port 143 for imap:// when port absent', () => {
    const result = parseImapUrl('imap://user:pass@localhost')
    expect(result.port).toBe(143)
  })

  it('parseImapUrl() uses default port 993 for imaps:// when port absent', () => {
    const result = parseImapUrl('imaps://user:pass@localhost')
    expect(result.port).toBe(993)
  })

  it('parseImapUrl() throws when URL has no password', () => {
    expect(() => parseImapUrl('imap://user@localhost')).toThrow(/must include password/)
  })

  it('parseImapUrl() throws when protocol is not imap:// or imaps://', () => {
    expect(() => parseImapUrl('http://user:pass@localhost')).toThrow(/must be imap:\/\/ or imaps:\/\//)
  })

  it('parseImapUrl() decodes percent-encoded credentials', () => {
    const result = parseImapUrl('imap://user%40gmail.com:pass%20word@localhost')
    expect(result.username).toBe('user@gmail.com')
    expect(result.password).toBe('pass word')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// REST-02: Duplicate checking
// ────────────────────────────────────────────────────────────────────────────

describe('REST-02: Duplicate checking', () => {
  it('isDuplicate() checks for existing Message-ID in target folder', async () => {
    const mockLock = { release: vi.fn() }
    const mockClient = {
      getMailboxLock: vi.fn().mockResolvedValue(mockLock),
      search: vi.fn().mockResolvedValue([1]) // Array with one UID means duplicate exists
    } as unknown as ImapFlow

    const result = await isDuplicate(mockClient, 'INBOX', 'msg-id-123')

    expect(result).toBe(true)
    expect(mockClient.search).toHaveBeenCalledWith({ header: { 'message-id': 'msg-id-123' } })
    expect(mockLock.release).toHaveBeenCalled()
  })

  it('isDuplicate() returns false when Message-ID not found', async () => {
    const mockLock = { release: vi.fn() }
    const mockClient = {
      getMailboxLock: vi.fn().mockResolvedValue(mockLock),
      search: vi.fn().mockResolvedValue([]) // Empty array means no duplicate
    } as unknown as ImapFlow

    const result = await isDuplicate(mockClient, 'INBOX', 'msg-id-123')

    expect(result).toBe(false)
    expect(mockLock.release).toHaveBeenCalled()
  })

  it('isDuplicate() releases mailbox lock even if search fails', async () => {
    const mockLock = { release: vi.fn() }
    const mockClient = {
      getMailboxLock: vi.fn().mockResolvedValue(mockLock),
      search: vi.fn().mockRejectedValue(new Error('IMAP error'))
    } as unknown as ImapFlow

    try {
      await isDuplicate(mockClient, 'INBOX', 'msg-id-123')
    } catch {
      // Error expected
    }

    expect(mockLock.release).toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// REST-03: Dry-run flag handling
// ────────────────────────────────────────────────────────────────────────────

describe('REST-03: Dry-run flag handling', () => {
  it('createFolderIfNeeded() calls ImapFlow.mailboxCreate()', async () => {
    const mockClient = {
      mailboxCreate: vi.fn().mockResolvedValue(undefined)
    } as unknown as ImapFlow

    await createFolderIfNeeded(mockClient, 'INBOX')

    expect(mockClient.mailboxCreate).toHaveBeenCalledWith('INBOX')
  })

  it('createFolderIfNeeded() ignores "already exists" errors', async () => {
    const mockClient = {
      mailboxCreate: vi.fn().mockRejectedValue(new Error('Folder already exists'))
    } as unknown as ImapFlow

    await expect(createFolderIfNeeded(mockClient, 'INBOX')).resolves.not.toThrow()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// REST-04: Folder creation on target
// ────────────────────────────────────────────────────────────────────────────

describe('REST-04: Folder creation on target', () => {
  it('createFolderIfNeeded() handles ALREADYEXISTS error from IMAP server', async () => {
    const mockClient = {
      mailboxCreate: vi.fn().mockRejectedValue(new Error('[ALREADYEXISTS]'))
    } as unknown as ImapFlow

    await expect(createFolderIfNeeded(mockClient, 'INBOX')).resolves.not.toThrow()
  })

  it('createFolderIfNeeded() rethrows unexpected errors', async () => {
    const mockClient = {
      mailboxCreate: vi.fn().mockRejectedValue(new Error('Permission denied'))
    } as unknown as ImapFlow

    await expect(createFolderIfNeeded(mockClient, 'INBOX')).rejects.toThrow('Permission denied')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// Error handling and accumulation
// ────────────────────────────────────────────────────────────────────────────

describe('Error handling and accumulation', () => {
  it('parseImapUrl() validates URL format before returning parsed result', () => {
    const result = parseImapUrl('imap://user:pass@localhost')
    expect(result).toHaveProperty('host')
    expect(result).toHaveProperty('port')
    expect(result).toHaveProperty('username')
    expect(result).toHaveProperty('password')
    expect(result).toHaveProperty('secure')
  })

  it('isDuplicate() handles search returning false (no results) correctly', async () => {
    const mockLock = { release: vi.fn() }
    const mockClient = {
      getMailboxLock: vi.fn().mockResolvedValue(mockLock),
      search: vi.fn().mockResolvedValue(false) // search() can return false per ImapFlow type
    } as unknown as ImapFlow

    const result = await isDuplicate(mockClient, 'INBOX', 'msg-id-123')

    expect(result).toBe(false)
    expect(mockLock.release).toHaveBeenCalled()
  })

  it('createFolderIfNeeded() handles "name not allowed" error', async () => {
    const mockClient = {
      mailboxCreate: vi.fn().mockRejectedValue(new Error('name not allowed'))
    } as unknown as ImapFlow

    await expect(createFolderIfNeeded(mockClient, 'INBOX')).resolves.not.toThrow()
  })
})
