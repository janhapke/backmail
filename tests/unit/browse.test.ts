import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BackmailConfig, AccountConfig, MessageSummary } from '../../src/core/index.js'
import {
  resolveAccount,
  getLog,
  checkoutCommit,
  listFolders,
  listMessages,
  viewMessage,
} from '../../src/core/browse.js'

// ── resolveAccount Tests ──────────────────────────────────────────────────────

describe('resolveAccount', () => {
  const mockConfig: BackmailConfig = {
    accounts: {
      gmail: {
        host: 'imap.gmail.com',
        port: 993,
        username: 'user@gmail.com',
        tls: true,
        repoPath: '/tmp/gmail',
      },
      work: {
        host: 'mail.example.com',
        port: 993,
        username: 'user@example.com',
        tls: true,
        repoPath: '/tmp/work',
      },
    },
  }

  const singleAccountConfig: BackmailConfig = {
    accounts: {
      gmail: {
        host: 'imap.gmail.com',
        port: 993,
        username: 'user@gmail.com',
        tls: true,
        repoPath: '/tmp/gmail',
      },
    },
  }

  it('resolves explicitly named account', () => {
    const [name, config] = resolveAccount(mockConfig, 'gmail')
    expect(name).toBe('gmail')
    expect(config.host).toBe('imap.gmail.com')
  })

  it('auto-selects single account', () => {
    const [name, config] = resolveAccount(singleAccountConfig)
    expect(name).toBe('gmail')
    expect(config.host).toBe('imap.gmail.com')
  })

  it('throws when multiple accounts and no --account flag', () => {
    expect(() => resolveAccount(mockConfig)).toThrow(
      /Multiple accounts configured/
    )
  })

  it('throws for unknown account name', () => {
    expect(() => resolveAccount(mockConfig, 'unknown')).toThrow(
      /Unknown account: unknown/
    )
  })

  it('lists available accounts in error message', () => {
    expect(() => resolveAccount(mockConfig)).toThrow(/gmail|work/)
  })
})

// ── getLog Tests ──────────────────────────────────────────────────────────────

describe('getLog', () => {
  it('returns empty array when repo has no commits', async () => {
    // TODO: stub or skip for now
    await expect(getLog('/tmp/test', 20)).rejects.toThrow(/not yet implemented/i)
  })

  it('returns commit messages filtered to sync format only', async () => {
    // TODO: stub or skip for now
    await expect(getLog('/tmp/test', 20)).rejects.toThrow(/not yet implemented/i)
  })

  it('respects --limit flag', async () => {
    // TODO: stub or skip for now
    await expect(getLog('/tmp/test', 5)).rejects.toThrow(/not yet implemented/i)
  })

  it('accepts unlimited as limit', async () => {
    // TODO: stub or skip for now
    await expect(getLog('/tmp/test', 'unlimited')).rejects.toThrow(/not yet implemented/i)
  })
})

// ── checkoutCommit Tests ──────────────────────────────────────────────────────

describe('checkoutCommit', () => {
  it('creates a worktree at .worktrees/<date>', async () => {
    // TODO: stub or skip for now
    await expect(checkoutCommit('/tmp/test', '2026-04-22')).rejects.toThrow(/not yet implemented/i)
  })

  it('resolves date string to last commit on that day', async () => {
    // TODO: stub or skip for now
    await expect(checkoutCommit('/tmp/test', '2026-04-22')).rejects.toThrow(/not yet implemented/i)
  })

  it('treats non-date string as commit hash', async () => {
    // TODO: stub or skip for now
    await expect(checkoutCommit('/tmp/test', 'abc1234')).rejects.toThrow(/not yet implemented/i)
  })

  it('removes existing worktree before creating new one', async () => {
    // TODO: stub or skip for now
    await expect(checkoutCommit('/tmp/test', '2026-04-22')).rejects.toThrow(/not yet implemented/i)
  })

  it('returns worktree path and short SHA', async () => {
    // TODO: stub or skip for now
    await expect(checkoutCommit('/tmp/test', '2026-04-22')).rejects.toThrow(/not yet implemented/i)
  })
})

// ── listFolders Tests ─────────────────────────────────────────────────────────

describe('listFolders', () => {
  it('lists all folders from folders/*.json filenames', async () => {
    // TODO: stub or skip for now
    await expect(listFolders('/tmp/test')).rejects.toThrow(/not yet implemented/i)
  })

  it('returns empty array when no folders present', async () => {
    // TODO: stub or skip for now
    await expect(listFolders('/tmp/test')).rejects.toThrow(/not yet implemented/i)
  })
})

// ── listMessages Tests ────────────────────────────────────────────────────────

describe('listMessages', () => {
  it('returns messages for a folder with date/from/subject parsed from headers', async () => {
    // TODO: stub or skip for now
    await expect(listMessages('/tmp/test', 'INBOX')).rejects.toThrow(/not yet implemented/i)
  })

  it('throws for non-existent folder', async () => {
    // TODO: stub or skip for now
    await expect(listMessages('/tmp/test', 'NonExistent')).rejects.toThrow(/not yet implemented/i)
  })
})

// ── viewMessage Tests ─────────────────────────────────────────────────────────

describe('viewMessage', () => {
  it('returns raw EML for --format eml', async () => {
    // TODO: stub or skip for now
    await expect(viewMessage('/tmp/test', 'msg-id@example.com', 'eml')).rejects.toThrow(/not yet implemented/i)
  })

  it('extracts text/plain for --format plaintext', async () => {
    // TODO: stub or skip for now
    await expect(viewMessage('/tmp/test', 'msg-id@example.com', 'plaintext')).rejects.toThrow(/not yet implemented/i)
  })

  it('returns JSON headers+parts for --format json', async () => {
    // TODO: stub or skip for now
    await expect(viewMessage('/tmp/test', 'msg-id@example.com', 'json')).rejects.toThrow(/not yet implemented/i)
  })

  it('applies sanitizeMessageId before file lookup', async () => {
    // TODO: stub or skip for now
    await expect(viewMessage('/tmp/test', '<msg-id@example.com>', 'plaintext')).rejects.toThrow(/not yet implemented/i)
  })
})
