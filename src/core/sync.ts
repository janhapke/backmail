// src/core/sync.ts — no exit calls, no console, no CLI imports.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import { simpleGit } from 'simple-git'
import slugify from 'slugify'
import type { RepositoryConfig } from './config.js'
import { getPasswordByRef } from './config.js'

// ── Public Interfaces ────────────────────────────────────────────────────────

export interface SyncOptions {
  excludeFolders: string[]
  onlyFolders: string[]
  verbose: boolean
  onLog?: (msg: string) => void
}

export interface FolderSyncResult {
  path: string
  added: number
  removed: number
  error?: Error
}

export interface SyncResult {
  added: number
  removed: number
  partial: boolean
  repoInitialized: boolean
  folderResults: FolderSyncResult[]
}

// ── Internal Interfaces ──────────────────────────────────────────────────────

interface FolderMessage {
  uid: number
  'message-id': string
  filename: string
  flags: string[]
}

interface FolderState {
  folderPath: string
  uidvalidity: string
  uidnext: number
  messages: FolderMessage[]
}

// ── Helper Functions ─────────────────────────────────────────────────────────

// Windows reserved device names that cannot be used as filenames (even with an extension).
const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i

/**
 * Sanitize Message-ID to make it filesystem-safe.
 * - Strip angle brackets
 * - Replace null bytes (OS-level rejection risk)
 * - Replace unsafe characters with underscore
 * - Replace .. with __ (prevent relative path traversal)
 * - Prefix Windows reserved device names (CON, NUL, COM1…, LPT1…) with underscore
 * - Truncate to 200 chars
 */
export function sanitizeMessageId(messageId: string): string {
  if (!messageId) throw new Error('sanitizeMessageId: messageId must not be empty')
  let result = messageId
  // Strip angle brackets
  result = result.replace(/^<|>$/g, '')
  // Remove null bytes
  result = result.replace(/\0/g, '')
  // Replace filesystem-unsafe characters with underscore
  result = result.replace(/[/\\:*?"<>|]/g, '_')
  // Replace .. with __ to prevent relative path traversal
  result = result.replace(/\.\./g, '__')
  // Truncate to 200 chars before reserved-name check so the check sees the final stem
  result = result.substring(0, 200)
  // Prefix Windows reserved device names to prevent creation failures on Windows
  if (WINDOWS_RESERVED_NAMES.test(result)) result = `_${result}`
  return result
}

// Decode RFC 2047 encoded-words in email header values (=?charset?B/Q?...?=)
function decodeMimeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, _charset, encoding, encoded) => {
    try {
      if (encoding.toUpperCase() === 'B') return Buffer.from(encoded, 'base64').toString('utf-8')
      return encoded.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    } catch {
      return encoded
    }
  })
}

// Extract the first occurrence of a named header from the raw (unfolded) header block.
function extractRawHeader(unfolded: string, name: string): string {
  const re = new RegExp(`^${name}:[ \\t]*(.*)$`, 'im')
  return unfolded.match(re)?.[1]?.trim() ?? ''
}

// Unfold and extract just the header section from raw email bytes.
function parseHeaderBlock(rawSource: Buffer | string): string {
  const text = typeof rawSource === 'string'
    ? rawSource.slice(0, 8192)
    : rawSource.subarray(0, 8192).toString('utf-8')
  const headerSection = text.split(/\r?\n\r?\n/)[0] ?? text
  return headerSection.replace(/\r?\n([ \t])/g, ' ')
}

/**
 * Generate a human-readable, collision-resistant filename stem for a message.
 * Format: YYYY-MM-DD_<subject-slug-30chars>_<sha1-of-message-id-8chars>
 *
 * - Date: extracted from the topmost Received: header (most-recent delivery stamp).
 *   Falls back to the Date: header (sent mails, drafts), then to 0000-00-00.
 * - Subject: RFC 2047-decoded, slugified, truncated to 30 chars.
 *   Falls back to "no-subject" when empty.
 * - SHA1: first 8 hex chars of SHA1(rawMessageId) — ensures global uniqueness.
 */
export function messageFilename(rawMessageId: string, rawSource: Buffer | string): string {
  const sha1 = crypto.createHash('sha1').update(rawMessageId).digest('hex').slice(0, 8)

  const unfolded = parseHeaderBlock(rawSource)

  // Date from topmost Received: header (semicolon-delimited timestamp at end),
  // falling back to the Date: header for sent mail / drafts that lack Received:.
  let dateStr = '0000-00-00'
  const receivedLine = extractRawHeader(unfolded, 'received')
  if (receivedLine) {
    const semi = receivedLine.lastIndexOf(';')
    if (semi !== -1) {
      const parsed = new Date(receivedLine.slice(semi + 1).trim())
      if (!isNaN(parsed.getTime())) dateStr = parsed.toISOString().slice(0, 10)
    }
  }
  if (dateStr === '0000-00-00') {
    const dateLine = extractRawHeader(unfolded, 'date')
    if (dateLine) {
      const parsed = new Date(dateLine.trim())
      if (!isNaN(parsed.getTime())) dateStr = parsed.toISOString().slice(0, 10)
    }
  }

  // Subject: decode MIME words, slugify, truncate
  const rawSubject = decodeMimeWords(extractRawHeader(unfolded, 'subject'))
  const slug = rawSubject
    ? (slugify(rawSubject, { lower: true, strict: true }).slice(0, 30).replace(/-+$/, '') || 'no-subject')
    : 'no-subject'

  return `${dateStr}_${slug}_${sha1}`
}

/**
 * Sanitize IMAP folder path to make it filesystem-safe.
 * - Replace unsafe characters with underscore
 * - Replace .. with __ (prevent relative path traversal)
 */
export function folderPathToFilename(imapPath: string): string {
  let result = imapPath
  // Replace filesystem-unsafe characters with underscore
  result = result.replace(/[/\\:*?"<>|\s]/g, '_')
  // Replace .. with __ to prevent relative path traversal
  result = result.replace(/\.\./g, '__')
  return result
}

/**
 * Format the git commit message for a sync run.
 * Normal:  YYYY-MM-DD: +N added / -N removed
 * Partial: YYYY-MM-DD [partial]: +N added / -N removed
 */
export function formatCommitMessage(
  added: number,
  removed: number,
  partial: boolean,
  date?: Date,
): string {
  const d = date ?? new Date()
  const iso = d.toISOString().slice(0, 10)
  if (partial) {
    return `${iso} [partial]: +${added} added / -${removed} removed`
  }
  return `${iso}: +${added} added / -${removed} removed`
}

/**
 * Filter mailboxes by \Noselect flag and folder name filters.
 * Rules:
 * - Always drop folders with \Noselect flag
 * - If onlyFolders non-empty: keep folders matching by full path OR leaf name
 * - Else if excludeFolders non-empty: drop folders matching by full path OR leaf name
 * - Else: return all non-Noselect folders
 * - If both onlyFolders and excludeFolders non-empty: throw error
 */
export function filterFolders<T extends { path: string; delimiter: string; flags: Set<string> }>(
  folders: T[],
  onlyFolders: string[],
  excludeFolders: string[],
): T[] {
  // Check for mutual exclusion
  if (onlyFolders.length > 0 && excludeFolders.length > 0) {
    throw new Error('onlyFolders and excludeFolders are mutually exclusive')
  }

  // Helper to check if a folder matches a name (full path or leaf name)
  const folderMatches = (folderPath: string, delimiter: string, name: string): boolean => {
    // Exact full-path match
    if (folderPath === name) return true
    // Leaf-name match (only if delimiter is non-empty)
    if (delimiter && folderPath.endsWith(delimiter + name)) return true
    return false
  }

  // Filter out \Noselect folders first
  let result = folders.filter((f) => !f.flags.has('\\Noselect'))

  // Apply onlyFolders filter
  if (onlyFolders.length > 0) {
    result = result.filter((f) => onlyFolders.some((name) => folderMatches(f.path, f.delimiter, name)))
  }
  // Apply excludeFolders filter
  else if (excludeFolders.length > 0) {
    result = result.filter((f) => !excludeFolders.some((name) => folderMatches(f.path, f.delimiter, name)))
  }

  return result
}

/**
 * Ensure a directory is a git repository.
 * If not, initialize it. Returns true if repo was just initialized.
 */
export async function ensureRepo(repoPath: string): Promise<boolean> {
  await fs.mkdir(repoPath, { recursive: true })
  const git = simpleGit(repoPath)
  if (await git.checkIsRepo()) {
    return false
  }
  await git.init()
  return true
}

/**
 * Main sync function: fetch messages from IMAP, update local git repo
 */
export async function syncAccount(
  config: RepositoryConfig,
  repoPath: string,
  opts: SyncOptions,
): Promise<SyncResult> {
  // Mutual exclusion check
  if (opts.onlyFolders.length > 0 && opts.excludeFolders.length > 0) {
    throw new Error('--only-folder and --exclude-folder are mutually exclusive')
  }

  const password = await getPasswordByRef(config.passwordRef)

  // Ensure repository exists
  const repoInitialized = await ensureRepo(repoPath)

  // Create directories
  await fs.mkdir(path.join(repoPath, 'messages'), { recursive: true })
  await fs.mkdir(path.join(repoPath, 'folders'), { recursive: true })

  // Create IMAP client
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: { user: config.username, pass: password },
    logger: false,
  })

  let added = 0
  let removed = 0
  let partial = false
  const folderResults: FolderSyncResult[] = []

  const log = opts.verbose ? (opts.onLog ?? (() => {})) : () => {}

  try {
    log(`Connecting to ${config.host}:${config.port}...`)
    await client.connect()
    log(`Connected.`)

    // List folders
    log(`Listing folders...`)
    const rawFolders = await client.list()
    const folders = filterFolders(rawFolders, opts.onlyFolders, opts.excludeFolders)
    log(`Found ${folders.length} folder(s): ${folders.map((f) => f.path).join(', ')}`)

    // Sync each folder
    for (const folder of folders) {
      log(`Syncing folder: ${folder.path}`)
      try {
        const folderResult = await syncFolder(client, folder, repoPath, log)
        added += folderResult.added
        removed += folderResult.removed
        folderResults.push(folderResult)
      } catch (err) {
        // Per-folder error: accumulate and continue (unless connection error)
        folderResults.push({
          path: folder.path,
          added: 0,
          removed: 0,
          error: err as Error,
        })
      }
    }
  } catch (err) {
    // Connection-level error: mark partial only if we already wrote something
    if (added > 0 || removed > 0) {
      partial = true
    } else {
      throw err
    }
  } finally {
    await client.logout().catch(() => {})
  }

  // Commit changes to git
  const git = simpleGit(repoPath)
  const status = await git.status()
  if (!status.isClean()) {
    try {
      await git.add('.')
      await git.commit(formatCommitMessage(added, removed, partial))
    } catch {
      // Log commit failure but don't crash — caller gets partial result
      // The working directory still has the files; user can commit manually
      partial = true // Mark as partial sync to signal incomplete state
    }
  }

  return { added, removed, partial, repoInitialized, folderResults }
}

// ── Internal Helper: Sync a Single Folder ────────────────────────────────────

async function syncFolder(
  client: InstanceType<typeof ImapFlow>,
  folder: { path: string; delimiter: string; flags: Set<string> },
  repoPath: string,
  log: (msg: string) => void,
): Promise<FolderSyncResult> {
  const folderFilename = folderPathToFilename(folder.path)
  const folderJsonPath = path.join(repoPath, 'folders', `${folderFilename}.json`)

  // Read stored folder state
  let storedState: FolderState | null = null
  try {
    const jsonContent = await fs.readFile(folderJsonPath, 'utf-8')
    storedState = JSON.parse(jsonContent) as FolderState
  } catch {
    // File doesn't exist yet; start fresh
  }

  let added = 0
  let removed = 0

  // Get mailbox lock
  const lock = await client.getMailboxLock(folder.path)
  try {
    // Type guard: mailbox should exist after lock is acquired
    if (!client.mailbox || typeof client.mailbox === 'boolean') {
      throw new Error(`Failed to access mailbox: ${folder.path}`)
    }
    const serverValidity = client.mailbox.uidValidity ?? 0n // Fallback if undefined
    const serverUidNext = client.mailbox.uidNext ?? 0
    log(`  ${folder.path}: ${client.mailbox.exists ?? 0} message(s) on server`)

    // uidvalidity change triggers a full re-sync of the folder
    if (storedState) {
      // Compare as strings — BigInt doesn't round-trip through JSON
      const storedValidityStr = storedState.uidvalidity
      const serverValidityStr = serverValidity.toString()
      if (storedValidityStr !== serverValidityStr) {
        // uidvalidity changed: invalidate all local state.
        // Delete all stored messages and treat as a fresh sync.
        if (storedState.messages.length > 0) {
          for (const msg of storedState.messages) {
            const msgPath = path.join(repoPath, 'messages', `${msg.filename}.eml`)
            await fs.unlink(msgPath).catch(() => {})
          }
          removed += storedState.messages.length
        }
        // Reset state: existing messages become empty, forcing full re-fetch
        storedState = null
      }
    }

    // Fetch only new messages by starting from the highest known UID
    const lastUid = storedState && storedState.messages.length > 0
      ? Math.max(...storedState.messages.map((m) => m.uid ?? 0))
      : 0

    // When lastUid+1 >= uidNext there are no new messages. Without this guard,
    // IMAP resolves `lastUid+1:*` to the last existing message (RFC 3501: *
    // always anchors to the highest UID), causing the last mail to be re-added.
    const hasNewMessages = lastUid === 0 || lastUid + 1 < serverUidNext
    const range = lastUid === 0 ? '1:*' : `${lastUid + 1}:*`

    // Fetch new messages
    const newMessages: FolderMessage[] = []
    if (hasNewMessages) {
      log(`  ${folder.path}: downloading new messages (UID ${range})...`)
      for await (const msg of client.fetch(range, { uid: true, source: true, envelope: true, flags: true }, { uid: true })) {
        const rawId = msg.envelope?.messageId ?? `no-message-id_uid-${msg.uid}_${folderFilename}`
        const filename = messageFilename(rawId, msg.source as Buffer)
        const msgPath = path.join(repoPath, 'messages', `${filename}.eml`)

        await fs.writeFile(msgPath, msg.source as Buffer)

        const msgFlags = msg.flags ? Array.from(msg.flags) : []
        newMessages.push({
          uid: msg.uid,
          'message-id': rawId,
          filename,
          flags: msgFlags,
        })

        log(`  ↓ ${rawId}`)
        added++
      }
    } else {
      log(`  ${folder.path}: up to date`)
    }

    // Detect deletions by comparing current server UIDs against stored state
    const searchResult = await client.search({ all: true }, { uid: true })
    const currentUids = new Set(Array.isArray(searchResult) ? searchResult : [])
    const existingMessages = storedState?.messages ?? []
    const keptMessages = existingMessages.filter((m) => currentUids.has(m.uid))
    const removedMessages = existingMessages.filter((m) => !currentUids.has(m.uid))

    // Delete .eml files for removed messages
    for (const msg of removedMessages) {
      const msgPath = path.join(repoPath, 'messages', `${msg.filename}.eml`)
      await fs.unlink(msgPath).catch(() => {})
    }
    removed += removedMessages.length

    if (removedMessages.length > 0) {
      log(`  ${folder.path}: removed ${removedMessages.length} deleted message(s)`)
    }

    // Write updated folder state
    const updatedState: FolderState = {
      folderPath: folder.path,
      uidvalidity: serverValidity.toString(),
      uidnext: serverUidNext,
      messages: [...keptMessages, ...newMessages],
    }
    await fs.writeFile(folderJsonPath, JSON.stringify(updatedState, null, 2))
  } finally {
    lock.release()
  }

  return { path: folder.path, added, removed }
}
