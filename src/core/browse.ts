// src/core/browse.ts — no exit calls, no console, no CLI imports.
// Read-only browse commands for synced mail archives.

import fs from 'node:fs/promises'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { simpleParser } from 'mailparser'

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

// ── Browse Functions ────────────────────────────────────────────────────────

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
 * @param repoPath - Path to the git archive directory
 * @param dateOrHash - Date (YYYY-MM-DD) or commit hash to check out
 * @param worktreesDir - Directory where worktrees are placed (outside the git repo)
 * @returns Object with path to worktree and short SHA
 */
export async function checkoutCommit(
  repoPath: string,
  dateOrHash: string,
  worktreesDir: string,
): Promise<{ path: string; sha: string }> {
  const git = simpleGit(repoPath)

  let commitHash: string
  let worktreeName: string

  if (isDateString(dateOrHash)) {
    commitHash = await resolveDate(repoPath, dateOrHash)
    worktreeName = dateOrHash
  } else {
    commitHash = dateOrHash
    worktreeName = dateOrHash.slice(0, 7)
  }

  await fs.mkdir(worktreesDir, { recursive: true })
  const worktreePath = path.join(worktreesDir, worktreeName)

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

  await git.raw(['worktree', 'add', worktreePath, commitHash])

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
 * Walks the directory tree looking for .backmail_state.json files and returns
 * their parent directory paths (relative to repoPath, using '/' as separator).
 *
 * @param repoPath - Path to the mail repository
 * @returns Array of folder paths (e.g. ['INBOX', 'Archive/2024'])
 */
export async function listFolders(repoPath: string): Promise<string[]> {
  const results: string[] = []

  async function walk(dirPath: string, relativePath: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
      return
    }
    let hasState = false
    for (const entry of entries) {
      if (entry.name === '.backmail_state.json' && !entry.isDirectory()) {
        hasState = true
      } else if (!entry.name.startsWith('.') && entry.isDirectory()) {
        const child = relativePath ? `${relativePath}/${entry.name}` : entry.name
        await walk(path.join(dirPath, entry.name), child)
      }
    }
    if (hasState && relativePath) results.push(relativePath)
  }

  await walk(repoPath, '')
  return results.sort()
}

/**
 * FolderMessage interface (internal)
 */
interface FolderMessage {
  uid: number
  'message-id': string
  filename: string
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
  const stateFilePath = path.join(repoPath, folderName, '.backmail_state.json')

  let state: FolderState
  try {
    const content = await fs.readFile(stateFilePath, 'utf-8')
    state = JSON.parse(content) as FolderState
  } catch {
    throw new Error(`Folder not found: ${folderName}`)
  }

  const summaries: MessageSummary[] = []
  for (const msg of state.messages) {
    const emlPath = path.join(repoPath, folderName, `${msg.filename}.eml`)
    try {
      const headers = await readEmlHeaders(emlPath)
      summaries.push({
        messageId: msg['message-id'],
        date: headers['date'] ?? '',
        from: headers['from'] ?? '',
        subject: headers['subject'] ?? '',
      })
    } catch {
      summaries.push({ messageId: msg['message-id'], date: '', from: '', subject: '' })
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
  filepath: string,
  format: 'eml' | 'plaintext' | 'json' = 'plaintext'
): Promise<string | Record<string, unknown>> {
  // Strip .eml extension if the caller passed the full filename
  const stem = filepath.endsWith('.eml') ? filepath.slice(0, -4) : filepath
  // Prevent path traversal: reject '..' components and absolute paths
  const components = stem.split('/')
  if (stem.startsWith('/') || components.some(c => c === '..' || c === '.')) {
    throw new Error(`Invalid filepath: ${filepath}`)
  }
  const emlPath = path.join(repoPath, `${stem}.eml`)

  // Read the EML file
  let emlBuffer: Buffer
  try {
    emlBuffer = await fs.readFile(emlPath)
  } catch {
    throw new Error(`Message not found: ${filepath}`)
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
