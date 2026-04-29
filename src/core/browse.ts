// src/core/browse.ts — Phase 4: Browse Commands
// ARCH-01: public API boundary — no exit calls, no console.*, no CLI imports
// T-4-02: Path traversal protection via sanitizeMessageId before filesystem lookup
// This module implements read-only browse commands for synced mail archives

import fs from 'node:fs/promises'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { simpleParser } from 'mailparser'
import { sanitizeMessageId, folderPathToFilename } from './sync.js'

// ── Type Definitions ──────────────────────────────────────────────────────────

/**
 * Summary of a single email message for list operations
 */
export interface MessageSummary {
  messageId: string
  date: string
  from: string
  subject: string
}

// ── Legacy types (kept for Phase 8 removal) ──────────────────────────────────

/** @deprecated Replaced by per-repo RepositoryConfig in v1.1 */
export interface LegacyAccountConfig {
  host: string
  port: number
  username: string
  tls: boolean
  repoPath: string
}

/** @deprecated Replaced by per-repo RepositoryConfig in v1.1 */
export interface LegacyBackmailConfig {
  accounts: Record<string, LegacyAccountConfig>
}

// ── Account Resolution (D-01, D-02) ───────────────────────────────────────────

/**
 * @deprecated Resolve account name to AccountConfig (legacy multi-account model).
 * Kept for Phase 8 removal. CLI command actions no longer call this.
 */
export function resolveAccount(
  config: LegacyBackmailConfig,
  accountName?: string
): [string, LegacyAccountConfig] {
  if (accountName) {
    const acc = config.accounts[accountName]
    if (!acc) {
      throw new Error(`Unknown account: ${accountName}`)
    }
    return [accountName, acc]
  }

  const names = Object.keys(config.accounts)
  if (names.length === 1) {
    return [names[0], config.accounts[names[0]]]
  }

  if (names.length === 0) {
    throw new Error('No accounts configured')
  }

  throw new Error(
    `Multiple accounts configured. Specify one with --account:\n  ${names.join('\n  ')}`
  )
}

// ── Helper Functions (Task 1) ───────────────────────────────────────────────

/**
 * Check if a string matches date format YYYY-MM-DD
 */
function isDateString(arg: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(arg)
}

/**
 * Resolve a date string to the last git commit on that date.
 * Queries git log with --after and --before to find commits within the day.
 */
async function resolveDate(repoPath: string, dateStr: string): Promise<string> {
  const git = simpleGit(repoPath)
  const log = await git.log({
    '--after': `${dateStr} 00:00:00`,
    '--before': `${dateStr} 23:59:59`,
    '--max-count': '1',
  })
  if (log.total === 0) {
    throw new Error(`No sync commit found for date ${dateStr}`)
  }
  return log.latest!.hash
}

/**
 * Ensure .worktrees/ is in .gitignore so worktrees are never tracked by git
 */
async function ensureWorktreesIgnored(repoPath: string): Promise<void> {
  const gitignorePath = path.join(repoPath, '.gitignore')
  let content = ''
  try {
    content = await fs.readFile(gitignorePath, 'utf-8')
  } catch {
    // File doesn't exist, start with empty
  }
  if (!content.includes('.worktrees/')) {
    const toAppend = content.endsWith('\n') ? '.worktrees/\n' : '\n.worktrees/\n'
    await fs.appendFile(gitignorePath, toAppend)
  }
}

// ── Browse Functions (Implementation for Phase 04-02) ──────────────────────

/**
 * Get sync commit log for the mailbox.
 * Returns commit messages in the format: YYYY-MM-DD [partial]: +N added / -N removed
 * Filters to sync commits only (matches the sync commit message pattern).
 *
 * @param repoPath - Path to the mail repository
 * @param limit - Maximum commits to return, or 'unlimited' for all
 * @returns Array of commit message strings (newest first)
 */
export async function getLog(repoPath: string, limit: number | 'unlimited'): Promise<string[]> {
  const git = simpleGit(repoPath)
  const opts = limit === 'unlimited' ? {} : { maxCount: limit }
  const log = await git.log(opts)

  // Filter to sync commits only (pattern: YYYY-MM-DD [partial]: +N added / -N removed)
  const syncPattern = /^\d{4}-\d{2}-\d{2}(\s\[partial\])?:\s+\+\d+\s+added\s+\/\s+-\d+\s+removed$/
  return log.all.filter((c) => syncPattern.test(c.message)).map((c) => c.message)
}

/**
 * Create a git worktree at a specific commit.
 * If worktree already exists, remove it first.
 * Supports both date strings (YYYY-MM-DD) and commit hashes.
 *
 * @param repoPath - Path to the mail repository
 * @param dateOrHash - Date (YYYY-MM-DD) or commit hash to check out
 * @returns Object with path to worktree and short SHA
 */
export async function checkoutCommit(
  repoPath: string,
  dateOrHash: string
): Promise<{ path: string; sha: string }> {
  const git = simpleGit(repoPath)

  // Resolve date to commit hash if needed
  let commitHash: string
  let worktreeName: string

  if (isDateString(dateOrHash)) {
    // Date input: resolve to commit hash
    commitHash = await resolveDate(repoPath, dateOrHash)
    worktreeName = dateOrHash // use date as worktree name
  } else {
    // Commit hash input: use as-is
    commitHash = dateOrHash
    worktreeName = dateOrHash.slice(0, 7) // use first 7 chars as worktree name
  }

  const worktreePath = path.join(repoPath, '.worktrees', worktreeName)

  // Remove existing worktree if present
  try {
    await git.raw(['worktree', 'remove', '--force', worktreePath])
  } catch {
    // Worktree didn't exist, ignore
  }

  // Force-remove directory if it still exists
  try {
    await fs.rm(worktreePath, { recursive: true, force: true })
  } catch {
    // Directory didn't exist, ignore
  }

  // Create new worktree
  await git.raw(['worktree', 'add', worktreePath, commitHash])

  // Ensure .worktrees/ is in .gitignore
  await ensureWorktreesIgnored(repoPath)

  return {
    path: path.resolve(worktreePath),
    sha: commitHash.slice(0, 7),
  }
}

/**
 * Fast RFC822 header extraction without full MIME parsing.
 * Reads first 4KB of EML file to extract headers efficiently.
 */
async function readEmlHeaders(emlPath: string): Promise<Record<string, string>> {
  const fd = await fs.open(emlPath, 'r')
  const buf = Buffer.alloc(4096)
  const { bytesRead } = await fd.read(buf, 0, 4096, 0)
  await fd.close()

  const raw = buf.subarray(0, bytesRead).toString('utf-8')

  // Split at first blank line
  const headerSection = raw.split(/\r?\n\r?\n/)[0] ?? raw

  // Parse folded headers (RFC 2822 — continuation lines start with whitespace)
  const headers: Record<string, string> = {}
  const unfolded = headerSection.replace(/\r?\n([ \t])/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0) {
      const key = line.slice(0, colon).toLowerCase().trim()
      const val = line.slice(colon + 1).trim()
      if (!(key in headers)) headers[key] = val // keep first occurrence
    }
  }
  return headers
}

/**
 * List all folders in the repository.
 * Reads folder names from folders/*.json filenames.
 *
 * @param repoPath - Path to the mail repository
 * @returns Array of folder names
 */
export async function listFolders(repoPath: string): Promise<string[]> {
  const foldersPath = path.join(repoPath, 'folders')
  try {
    const files = await fs.readdir(foldersPath)
    // Strip .json extension from each filename to get folder name
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5)) // remove .json
      .sort()
  } catch {
    // folders directory doesn't exist, return empty array
    return []
  }
}

/**
 * FolderMessage interface (internal)
 */
interface FolderMessage {
  uid: number
  'message-id': string
  flags: string[]
}

/**
 * FolderState interface (internal)
 */
interface FolderState {
  uidvalidity: string
  uidnext: number
  messages: FolderMessage[]
}

/**
 * List all messages in a folder.
 * Each message includes parsed headers (date, from, subject).
 *
 * @param repoPath - Path to the mail repository
 * @param folderName - Folder name (full IMAP path or leaf name)
 * @returns Array of message summaries
 */
export async function listMessages(
  repoPath: string,
  folderName: string
): Promise<MessageSummary[]> {
  // Convert folder name to filename using folderPathToFilename
  const filename = folderPathToFilename(folderName)
  const folderPath = path.join(repoPath, 'folders', `${filename}.json`)

  // Read folder state file
  let state: FolderState
  try {
    const content = await fs.readFile(folderPath, 'utf-8')
    state = JSON.parse(content) as FolderState
  } catch {
    throw new Error(`Folder not found: ${folderName}`)
  }

  // For each message, read headers and create summary
  const summaries: MessageSummary[] = []
  for (const msg of state.messages) {
    const sanitized = sanitizeMessageId(msg['message-id'])
    const emlPath = path.join(repoPath, 'messages', `${sanitized}.eml`)

    try {
      const headers = await readEmlHeaders(emlPath)
      summaries.push({
        messageId: msg['message-id'],
        date: headers['date'] ?? '',
        from: headers['from'] ?? '',
        subject: headers['subject'] ?? '',
      })
    } catch {
      // EML file missing — skip this message or use defaults
      summaries.push({
        messageId: msg['message-id'],
        date: '',
        from: '',
        subject: '',
      })
    }
  }

  return summaries
}

/**
 * View a message in the specified format.
 * Supports three formats:
 * - 'eml': raw RFC822 file content
 * - 'plaintext': text/plain MIME part (default)
 * - 'json': headers and MIME parts as structured data
 *
 * @param repoPath - Path to the mail repository
 * @param messageId - Message-ID of the message to view
 * @param format - Output format: 'eml' (raw), 'plaintext' (text/plain), or 'json' (headers + parts)
 * @returns Raw message content (eml), plaintext body, or JSON structure
 */
export async function viewMessage(
  repoPath: string,
  messageId: string,
  format: 'eml' | 'plaintext' | 'json' = 'plaintext'
): Promise<string | Record<string, unknown>> {
  // Sanitize messageId before constructing path (T-4-02 threat mitigation)
  const sanitized = sanitizeMessageId(messageId)
  const emlPath = path.join(repoPath, 'messages', `${sanitized}.eml`)

  // Read the EML file
  let emlBuffer: Buffer
  try {
    emlBuffer = await fs.readFile(emlPath)
  } catch {
    throw new Error(`Message not found: ${messageId}`)
  }

  // Handle different formats
  if (format === 'eml') {
    // Return raw file contents as string
    return emlBuffer.toString('utf-8')
  }

  // For plaintext and json formats, parse the EML using mailparser
  const parsed = await simpleParser(emlBuffer)

  if (format === 'plaintext') {
    // Extract text/plain part
    if (parsed.text !== undefined) {
      return parsed.text
    }
    throw new Error('No text/plain part found. Use --format eml or --format json to inspect.')
  }

  if (format === 'json') {
    // Build headers object from parsed.headers Map
    const headers: Record<string, string> = {}
    for (const [key, val] of parsed.headers) {
      headers[key] = typeof val === 'string' ? val : JSON.stringify(val)
    }

    // Build parts array from parsed MIME structure
    const parts: Array<{ type: string; content: string }> = []
    if (parsed.text !== undefined) {
      parts.push({ type: 'text/plain', content: parsed.text })
    }
    if (parsed.html && typeof parsed.html === 'string') {
      parts.push({ type: 'text/html', content: parsed.html })
    }
    for (const att of parsed.attachments ?? []) {
      parts.push({
        type: att.contentType,
        content: att.content.toString('base64'),
      })
    }

    return { headers, parts }
  }

  // Should not reach here due to TypeScript, but safety check
  throw new Error(`Unknown format: ${format}`)
}
