// src/core/sync.ts — SYNC-01 through SYNC-05
// ARCH-01: no exit calls, no console.*, no CLI imports
// Threat mitigations: T-3-01 (Message-ID sanitization),
//                     T-3-02 (folder-path sanitization),
//                     T-3-03 (logger: false in ImapFlow constructor)
import fs from 'node:fs/promises'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import { simpleGit } from 'simple-git'
import type { AccountConfig } from './index.js'
import { getPassword } from './config.js'

// ── Public Interfaces ────────────────────────────────────────────────────────

export interface SyncOptions {
  excludeFolders: string[]
  onlyFolders: string[]
  verbose: boolean
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
  flags: string[]
}

interface FolderState {
  uidvalidity: string
  uidnext: number
  messages: FolderMessage[]
}

// ── Helper Functions ─────────────────────────────────────────────────────────

/**
 * T-3-01: Sanitize Message-ID to make it filesystem-safe
 * - Strip angle brackets
 * - Replace unsafe characters with underscore
 * - Replace .. with __ (prevent relative path traversal)
 * - Truncate to 200 chars
 */
export function sanitizeMessageId(messageId: string): string {
  let result = messageId
  // Strip angle brackets
  result = result.replace(/^<|>$/g, '')
  // Replace filesystem-unsafe characters with underscore
  result = result.replace(/[/\\:*?"<>|]/g, '_')
  // Replace .. with __ to prevent relative path traversal
  result = result.replace(/\.\./g, '__')
  // Truncate to 200 chars
  result = result.substring(0, 200)
  return result
}

/**
 * T-3-02: Sanitize IMAP folder path to make it filesystem-safe
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
 * SYNC-02, D-07, D-08: Format commit message for sync
 * Normal: YYYY-MM-DD: +N added / -N removed
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
 * D-02, D-03: Filter mailboxes by \Noselect flag and folder name filters
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
 * D-04: Ensure a directory is a git repository.
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
  accountName: string,
  config: AccountConfig,
  opts: SyncOptions,
): Promise<SyncResult> {
  // Mutual exclusion check
  if (opts.onlyFolders.length > 0 && opts.excludeFolders.length > 0) {
    throw new Error('--only-folder and --exclude-folder are mutually exclusive')
  }

  // Get password for account
  const password = await getPassword(accountName)

  // Ensure repository exists
  const repoInitialized = await ensureRepo(config.repoPath)

  // Create directories
  await fs.mkdir(path.join(config.repoPath, 'messages'), { recursive: true })
  await fs.mkdir(path.join(config.repoPath, 'folders'), { recursive: true })

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

  try {
    await client.connect()

    // List folders
    const rawFolders = await client.list()
    const folders = filterFolders(rawFolders, opts.onlyFolders, opts.excludeFolders)

    // Sync each folder
    for (const folder of folders) {
      try {
        const folderResult = await syncFolder(client, folder, config.repoPath, opts.verbose)
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
  const git = simpleGit(config.repoPath)
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
  verbose: boolean,
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

    // Check for uidvalidity change (SYNC-05): triggers full re-sync
    if (storedState) {
      let storedValidity: bigint | null = null
      try {
        storedValidity = BigInt(storedState.uidvalidity)
      } catch {
        // Corrupted state file — treat as uidvalidity change (full re-sync)
        if (storedState.messages.length > 0) {
          for (const msg of storedState.messages) {
            const safeId = sanitizeMessageId(msg['message-id'])
            const msgPath = path.join(repoPath, 'messages', `${safeId}.eml`)
            await fs.unlink(msgPath).catch(() => {})
          }
          removed += storedState.messages.length
        }
        storedState = null
      }
      if (storedState && storedValidity !== null && storedValidity !== serverValidity) {
        // uidvalidity changed: invalidate all local state.
        // Delete all stored messages and treat as a fresh sync.
        if (storedState.messages.length > 0) {
          for (const msg of storedState.messages) {
            const safeId = sanitizeMessageId(msg['message-id'])
            const msgPath = path.join(repoPath, 'messages', `${safeId}.eml`)
            await fs.unlink(msgPath).catch(() => {})
          }
          removed += storedState.messages.length
        }
        // Reset state: existing messages become empty, forcing full re-fetch
        storedState = null
      }
    }

    // Calculate fetch range (SYNC-01): fetch only new messages
    const lastUid = storedState && storedState.messages.length > 0 ? Math.max(...storedState.messages.map((m) => m.uid)) : 0
    const range = lastUid === 0 ? '1:*' : `${lastUid + 1}:*`

    // Fetch new messages
    const newMessages: FolderMessage[] = []
    for await (const msg of client.fetch(range, { uid: true, source: true, envelope: true, flags: true }, { uid: true })) {
      const rawId = msg.envelope?.messageId ?? `no-message-id_uid-${msg.uid}_${folderFilename}`
      const safeId = sanitizeMessageId(rawId)
      const msgPath = path.join(repoPath, 'messages', `${safeId}.eml`)

      // Write .eml file
      await fs.writeFile(msgPath, msg.source as Buffer)

      // Record message metadata
      const msgFlags = msg.flags ? Array.from(msg.flags) : []
      newMessages.push({
        uid: msg.uid,
        'message-id': rawId,
        flags: msgFlags,
      })

      added++
    }

    // Detect deletions (SYNC-03): compare current UIDs against stored
    const searchResult = await client.search({ all: true }, { uid: true })
    const currentUids = new Set(Array.isArray(searchResult) ? searchResult : [])
    const existingMessages = storedState?.messages ?? []
    const keptMessages = existingMessages.filter((m) => currentUids.has(m.uid))
    const removedMessages = existingMessages.filter((m) => !currentUids.has(m.uid))

    // Delete .eml files for removed messages
    for (const msg of removedMessages) {
      const safeId = sanitizeMessageId(msg['message-id'])
      const msgPath = path.join(repoPath, 'messages', `${safeId}.eml`)
      await fs.unlink(msgPath).catch(() => {})
    }
    removed += removedMessages.length

    // Write updated folder state
    const updatedState: FolderState = {
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
