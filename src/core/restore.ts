// src/core/restore.ts — no exit calls, no CLI imports.
// console.* is used for verbose per-message output.
import fs from 'node:fs/promises'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import { checkoutCommit } from './browse.js'

// ── Public Interfaces ────────────────────────────────────────────────────────

export interface RestoreOptions {
  skipDuplicates: boolean  // true = SEARCH before APPEND, false = upload all
  dryRun: boolean          // true = no writes, output only
  verbose: boolean         // true = per-message lines
}

export interface RestoreResult {
  uploaded: number  // count of successfully appended messages
  skipped: number   // count of messages skipped due to duplicate Message-ID
  errors: number    // count of per-message errors
}

// ── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Parse an IMAP URL into connection parameters.
 * Format: imap://user:pass@host[:port] or imaps://user:pass@host[:port]
 * Default ports: 143 for imap://, 993 for imaps://
 */
export function parseImapUrl(urlStr: string): {
  host: string
  port: number
  username: string
  password: string
  secure: boolean
} {
  let url: URL
  try {
    url = new URL(urlStr)
  } catch {
    throw new Error(`Invalid URL: ${urlStr}`)
  }

  if (url.protocol !== 'imap:' && url.protocol !== 'imaps:') {
    throw new Error(`URL protocol must be imap:// or imaps://, got: ${url.protocol}`)
  }

  if (!url.username) {
    throw new Error('URL must include username (format: imap://user:pass@host)')
  }
  if (!url.password) {
    throw new Error('URL must include password (format: imap://user:pass@host)')
  }

  const secure = url.protocol === 'imaps:'
  const defaultPort = secure ? 993 : 143
  const port = url.port ? parseInt(url.port, 10) : defaultPort

  return {
    host: url.hostname ?? 'localhost',
    port,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    secure,
  }
}

/**
 * Check if a message with the given Message-ID already exists in the target folder.
 * Uses IMAP SEARCH so no download is needed.
 */
export async function isDuplicate(
  client: ImapFlow,
  folderPath: string,
  messageId: string
): Promise<boolean> {
  const lock = await client.getMailboxLock(folderPath)
  try {
    const results = await client.search({
      header: { 'message-id': messageId }
    })
    return results !== false && results.length > 0
  } finally {
    await lock.release()
  }
}

/**
 * Create a folder on the target IMAP server if it doesn't exist.
 * Swallows "already exists" errors; re-throws others.
 */
export async function createFolderIfNeeded(
  client: ImapFlow,
  folderPath: string
): Promise<void> {
  try {
    await client.mailboxCreate(folderPath)
  } catch (err) {
    const errMsg = (err as Error).message
    if (
      errMsg.includes('already exists') ||
      errMsg.includes('name not allowed') ||
      errMsg.includes('ALREADYEXISTS')
    ) {
      // Folder exists; safe to proceed
      return
    }
    // Different error (permissions, etc.) — re-throw
    throw err
  }
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Walk the source directory tree and collect all folders that contain a
 * .backmail_state.json file. Returns filesystem dir path + IMAP folder path.
 */
async function findFolderStates(
  sourcePath: string,
): Promise<Array<{ fsDirPath: string; imapPath: string }>> {
  const results: Array<{ fsDirPath: string; imapPath: string }> = []

  async function walk(dirPath: string): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    let stateFilePath: string | null = null
    for (const entry of entries) {
      if (entry.name === '.backmail_state.json' && !entry.isDirectory()) {
        stateFilePath = path.join(dirPath, entry.name)
      } else if (!entry.name.startsWith('.') && entry.isDirectory()) {
        await walk(path.join(dirPath, entry.name))
      }
    }
    if (stateFilePath) {
      try {
        const data: { folderPath?: string } = JSON.parse(await fs.readFile(stateFilePath, 'utf-8'))
        if (data.folderPath) {
          results.push({ fsDirPath: dirPath, imapPath: data.folderPath })
        }
      } catch {
        // Skip malformed state files
      }
    }
  }

  await walk(sourcePath)
  return results
}

// ── Main Function ────────────────────────────────────────────────────────────

/**
 * Restore messages from a local git archive to a target IMAP server.
 * Optionally restores from a point-in-time snapshot (date or commit hash).
 */
export async function restoreAccount(
  archivePath: string,
  targetUrl: string,
  dateOrCommit: string | undefined,
  options: RestoreOptions
): Promise<RestoreResult> {
  let sourcePath = archivePath
  if (dateOrCommit) {
    const worktreesDir = path.join(path.dirname(archivePath), 'worktrees')
    const checkout = await checkoutCommit(archivePath, dateOrCommit, worktreesDir)
    sourcePath = checkout.path
  }

  const target = parseImapUrl(targetUrl)

  // In dry-run mode skip the write connection; a read-only connection is opened
  // below only when duplicate checking is also requested.
  const targetClient = options.dryRun ? null : new ImapFlow({
    host: target.host,
    port: target.port,
    secure: target.secure,
    auth: { user: target.username, pass: target.password },
    logger: false,  // suppress imapflow's built-in logging
  })

  const dryRunClient = (options.dryRun && options.skipDuplicates)
    ? new ImapFlow({
        host: target.host,
        port: target.port,
        secure: target.secure,
        auth: { user: target.username, pass: target.password },
        logger: false,
      })
    : null

  let result: RestoreResult = { uploaded: 0, skipped: 0, errors: 0 }

  try {
    // Connect to target if not in dry-run mode
    if (targetClient) {
      await targetClient.connect()
    }
    if (dryRunClient) {
      await dryRunClient.connect()
    }

    // Walk the source directory tree to find all .backmail_state.json files
    const folderEntries = await findFolderStates(sourcePath)

    // Create all folders on target before uploading messages
    if (targetClient) {
      for (const { imapPath } of folderEntries) {
        try {
          await createFolderIfNeeded(targetClient, imapPath)
        } catch {
          result.errors++
        }
      }
    }

    // Restore messages from each folder
    for (const { fsDirPath, imapPath } of folderEntries) {
      const stateFilePath = path.join(fsDirPath, '.backmail_state.json')

      let folderState: { messages: Array<{ 'message-id': string; filename: string }> }
      try {
        folderState = JSON.parse(await fs.readFile(stateFilePath, 'utf-8'))
      } catch {
        result.errors++
        continue
      }

      for (const msg of folderState.messages) {
        const messageId = msg['message-id']

        try {
          const searchClient = targetClient ?? dryRunClient
          if (options.skipDuplicates && searchClient) {
            if (await isDuplicate(searchClient, imapPath, messageId)) {
              result.skipped++
              if (options.verbose) console.log(`Skipped: ${messageId}`)
              continue
            }
          }

          const emlPath = path.join(fsDirPath, `${msg.filename}.eml`)
          const content = await fs.readFile(emlPath)

          if (targetClient) {
            const lock = await targetClient.getMailboxLock(imapPath)
            try {
              await targetClient.append(imapPath, content, [])
              result.uploaded++
              if (options.verbose) console.log(`Uploaded: ${messageId}`)
            } finally {
              try { await lock.release() } catch { /* swallow */ }
            }
          } else {
            result.uploaded++
            if (options.verbose) console.log(`Uploaded: ${messageId}`)
          }
        } catch {
          result.errors++
          if (options.verbose) console.log(`Error: ${messageId}`)
        }
      }
    }

    return result
  } finally {
    // Always logout and cleanup (from sync.ts pattern)
    if (targetClient) {
      await targetClient.logout().catch(() => {})
    }
    if (dryRunClient) {
      await dryRunClient.logout().catch(() => {})
    }
  }
}
