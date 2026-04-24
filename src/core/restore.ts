// src/core/restore.ts — REST-01 through REST-04
// ARCH-01: no exit calls, no console.*, no CLI imports
// Threat mitigations: T-5-01 (URL parsing validation),
//                     T-5-02 (error message sanitization in CLI layer)
import fs from 'node:fs/promises'
import path from 'node:path'
import { ImapFlow } from 'imapflow'
import type { AccountConfig } from './index.js'
import { sanitizeMessageId, folderPathToFilename } from './sync.js'
import { checkoutCommit } from './browse.js'

// ── Public Interfaces ────────────────────────────────────────────────────────

export interface RestoreOptions {
  skipDuplicates: boolean  // D-10, D-11: true = SEARCH first, false = upload all
  dryRun: boolean          // D-12, D-13: true = no writes, output only
  verbose: boolean         // D-15: true = per-message lines
}

export interface RestoreResult {
  uploaded: number  // D-14: count of successfully appended messages
  skipped: number   // D-10: count of messages skipped due to duplicate Message-ID
  errors: number    // D-17, D-18: count of per-message errors
}

// ── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Parse IMAP URL into connection parameters.
 * Format: imap://user:pass@host:port or imaps://user:pass@host:port
 *
 * Implements:
 * - D-06, D-07: URL format parsing with TLS selection
 * - D-08: Credentials extraction and validation
 * - T-5-01: Safe URL parsing using Node.js URL constructor
 * - Pitfall 1: Default port selection (143 for imap://, 993 for imaps://)
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

  // Validate protocol (D-07)
  if (url.protocol !== 'imap:' && url.protocol !== 'imaps:') {
    throw new Error(`URL protocol must be imap:// or imaps://, got: ${url.protocol}`)
  }

  // Extract and validate credentials (D-06, D-08)
  if (!url.username) {
    throw new Error('URL must include username (format: imap://user:pass@host)')
  }
  if (!url.password) {
    throw new Error('URL must include password (format: imap://user:pass@host)')
  }

  // Determine TLS and default port (D-07, Pitfall 1)
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
 * Check if a message with the given Message-ID already exists in target folder.
 *
 * Implements:
 * - D-10, D-11: Duplicate checking via SEARCH command
 * - REST-02: Skip messages with duplicate Message-ID
 * - Pitfall 2: Always release mailbox lock in finally block
 */
export async function isDuplicate(
  client: ImapFlow,
  folderPath: string,
  messageId: string
): Promise<boolean> {
  const lock = await client.getMailboxLock(folderPath)
  try {
    // SEARCH for message with exact same Message-ID (D-10)
    const results = await client.search({
      header: { 'message-id': messageId }
    })
    return results !== false && results.length > 0
  } finally {
    // ALWAYS release lock (Pitfall 2)
    await lock.release()
  }
}

/**
 * Create a folder on the target IMAP server if it doesn't exist.
 *
 * Implements:
 * - REST-04, D-09: Create missing folders before message upload
 * - Pitfall 5: Handle "already exists" errors gracefully
 */
export async function createFolderIfNeeded(
  client: ImapFlow,
  folderPath: string
): Promise<void> {
  try {
    // Try to create the folder (D-09)
    await client.mailboxCreate(folderPath)
  } catch (err) {
    // Folder might already exist — check error message (Pitfall 5)
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
 * Restore messages from a local git checkout to a target IMAP server.
 *
 * Implements all REST-01 through REST-04 requirements:
 * - REST-01: Upload messages from checkout to target IMAP server
 * - REST-02: Skip duplicates when skipDuplicates=true (via SEARCH)
 * - REST-03: Dry-run mode (suppress all writes)
 * - REST-04: Create missing folders on target before upload
 *
 * D-01 through D-19: All implementation decisions from 05-CONTEXT.md
 */
export async function restoreAccount(
  config: AccountConfig,
  targetUrl: string,
  dateOrCommit: string | undefined,
  options: RestoreOptions
): Promise<RestoreResult> {
  // D-02, D-03: Resolve source path (from main repo or worktree)
  let sourcePath = config.repoPath
  if (dateOrCommit) {
    const checkout = await checkoutCommit(config.repoPath, dateOrCommit)
    sourcePath = checkout.path
  }

  // D-06, D-07: Parse target URL
  const target = parseImapUrl(targetUrl)

  // D-12, D-13: If dry-run, skip connection for writes (but may still connect for duplicate checks per D-12)
  const targetClient = options.dryRun ? null : new ImapFlow({
    host: target.host,
    port: target.port,
    secure: target.secure,
    auth: { user: target.username, pass: target.password },
    logger: false,  // T-3-03: MANDATORY per Phase 3
  })

  let result: RestoreResult = { uploaded: 0, skipped: 0, errors: 0 }

  try {
    // Connect to target if not in dry-run mode
    if (targetClient) {
      await targetClient.connect()
    }

    // REST-04, D-09: List all folders from folders/*.json and create them on target
    const folderFiles = await fs.readdir(path.join(sourcePath, 'folders'))

    // Read folderPath from each JSON file; fall back to filename reversal for legacy state files
    const folderPaths: string[] = []
    for (const folderFilename of folderFiles.filter(f => f.endsWith('.json'))) {
      try {
        const folderJsonPath = path.join(sourcePath, 'folders', folderFilename)
        const folderStateData: { folderPath?: string } = JSON.parse(await fs.readFile(folderJsonPath, 'utf-8'))
        if (folderStateData.folderPath && typeof folderStateData.folderPath === 'string') {
          folderPaths.push(folderStateData.folderPath)
        } else {
          // Legacy fallback: reconstruct from filename (less reliable, no folderPath stored)
          const sanitizedName = folderFilename.replace(/\.json$/, '')
          folderPaths.push(sanitizedName.replace(/_/g, '/'))
        }
      } catch {
        // Skip malformed JSON; caught again during message restoration
        continue
      }
    }

    // Create all folders on target first (D-09)
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

    // REST-01: Restore messages from each folder
    for (const folderPath of folderPaths) {
      const folderFilename = folderPathToFilename(folderPath)
      const folderJsonPath = path.join(sourcePath, 'folders', `${folderFilename}.json`)

      let folderState: { folderPath?: string; messages: Array<{ 'message-id': string }> }
      try {
        folderState = JSON.parse(await fs.readFile(folderJsonPath, 'utf-8'))
      } catch {
        result.errors++
        continue
      }

      // D-15: Per-folder summary (will be formatted by CLI)
      let folderUploaded = 0
      let folderSkipped = 0

      // Restore each message in the folder
      for (const msg of folderState.messages) {
        const messageId = msg['message-id']

        try {
          // REST-02, D-10, D-11: Check for duplicate if skip-duplicates=yes
          if (options.skipDuplicates && targetClient) {
            if (await isDuplicate(targetClient, folderPath, messageId)) {
              folderSkipped++
              result.skipped++
              continue
            }
          }

          // Read message content from disk (Pitfall 6: use sanitizeMessageId)
          const sanitized = sanitizeMessageId(messageId)
          const emlPath = path.join(sourcePath, 'messages', `${sanitized}.eml`)
          const content = await fs.readFile(emlPath)

          // REST-01: APPEND to target folder (no-op in dry-run)
          if (targetClient) {
            const lock = await targetClient.getMailboxLock(folderPath)
            try {
              await targetClient.append(folderPath, content, [])
              folderUploaded++
              result.uploaded++
            } finally {
              try {
                await lock.release()  // Pitfall 2: always release
              } catch (_releaseErr) {
                // Swallow cleanup errors to prevent masking append errors
                // Lock will eventually timeout on server
              }
            }
          } else {
            // Dry-run: count as uploaded without actually appending (D-12)
            folderUploaded++
            result.uploaded++
          }

          // D-15: Per-message verbose output (handled by CLI layer, not core)
        } catch (err) {
          // D-17: Per-message error: continue (do not abort)
          result.errors++
        }
      }

      // D-15: Per-folder summary line output (handled by CLI layer)
    }

    return result
  } finally {
    // Always logout and cleanup (from sync.ts pattern)
    if (targetClient) {
      await targetClient.logout().catch(() => {})
    }
  }
}
