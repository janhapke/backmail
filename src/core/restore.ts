// src/core/restore.ts — no exit calls, no CLI imports.
// console.* is used for verbose per-message output.
import fs from 'node:fs/promises'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import { folderPathToFilename } from './sync.js'
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

    // List all folders from folders/*.json and create them on target
    const folderFiles = await fs.readdir(path.join(sourcePath, 'folders'))

    // Read folderPath from each JSON file
    const folderPaths: string[] = []
    for (const folderFilename of folderFiles.filter(f => f.endsWith('.json'))) {
      try {
        const folderJsonPath = path.join(sourcePath, 'folders', folderFilename)
        const folderStateData: { folderPath?: string } = JSON.parse(await fs.readFile(folderJsonPath, 'utf-8'))
        if (folderStateData.folderPath && typeof folderStateData.folderPath === 'string') {
          folderPaths.push(folderStateData.folderPath)
        }
      } catch {
        // Skip malformed JSON; caught again during message restoration
        continue
      }
    }

    // Create all folders on target before uploading messages
    if (targetClient) {
      for (const folderPath of folderPaths) {
        try {
          await createFolderIfNeeded(targetClient, folderPath)
        } catch (err) {
          // Folder creation error is fatal for that folder; continue with others
          result.errors++
        }
      }
    }

    // Restore messages from each folder
    for (const folderPath of folderPaths) {
      const folderFilename = folderPathToFilename(folderPath)
      const folderJsonPath = path.join(sourcePath, 'folders', `${folderFilename}.json`)

      let folderState: { folderPath?: string; messages: Array<{ 'message-id': string; filename: string }> }
      try {
        folderState = JSON.parse(await fs.readFile(folderJsonPath, 'utf-8'))
      } catch {
        result.errors++
        continue
      }

      for (const msg of folderState.messages) {
        const messageId = msg['message-id']

        try {
          const searchClient = targetClient ?? dryRunClient
          if (options.skipDuplicates && searchClient) {
            if (await isDuplicate(searchClient, folderPath, messageId)) {
              result.skipped++
              if (options.verbose) {
                console.log(`Skipped: ${messageId}`)
              }
              continue
            }
          }

          const emlPath = path.join(sourcePath, 'messages', `${msg.filename}.eml`)
          const content = await fs.readFile(emlPath)

          if (targetClient) {
            const lock = await targetClient.getMailboxLock(folderPath)
            try {
              await targetClient.append(folderPath, content, [])
              result.uploaded++
              if (options.verbose) {
                console.log(`Uploaded: ${messageId}`)
              }
            } finally {
              try {
                await lock.release()
              } catch (_releaseErr) {
                // Swallow cleanup errors to prevent masking append errors
              }
            }
          } else {
            // Dry-run: count without appending
            result.uploaded++
            if (options.verbose) {
              console.log(`Uploaded: ${messageId}`)
            }
          }
        } catch (err) {
          result.errors++
          if (options.verbose) {
            console.log(`Error: ${messageId}`)
          }
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
