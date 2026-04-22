// src/core/browse.ts — Phase 4: Browse Commands
// ARCH-01: public API boundary — no exit calls, no console.*, no CLI imports
// T-4-02: Path traversal protection via sanitizeMessageId before filesystem lookup
// This module implements read-only browse commands for synced mail archives

import fs from 'node:fs/promises'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import { simpleParser } from 'mailparser'
import type { BackmailConfig } from './config.js'
import type { AccountConfig } from './index.js'
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

// ── Account Resolution (D-01, D-02) ───────────────────────────────────────────

/**
 * Resolve account name to AccountConfig.
 * If accountName provided, resolve that account or throw.
 * If not provided, auto-select if exactly one account exists.
 * If multiple accounts exist and none specified, throw with available names.
 */
export function resolveAccount(
  config: BackmailConfig,
  accountName?: string
): [string, AccountConfig] {
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

// ── Browse Functions (Stubs for Phase 04-02) ─────────────────────────────────

/**
 * Get sync commit log for the mailbox.
 * Returns commit messages in the format: YYYY-MM-DD [partial]: +N added / -N removed
 *
 * @param repoPath - Path to the mail repository
 * @param limit - Maximum commits to return, or 'unlimited' for all
 * @returns Array of commit message strings (newest first)
 */
export async function getLog(repoPath: string, limit: number | 'unlimited'): Promise<string[]> {
  throw new Error('getLog not yet implemented')
}

/**
 * Create a git worktree at a specific commit.
 * If worktree already exists, remove it first.
 *
 * @param repoPath - Path to the mail repository
 * @param dateOrHash - Date (YYYY-MM-DD) or commit hash to check out
 * @returns Object with path to worktree and short SHA
 */
export async function checkoutCommit(
  repoPath: string,
  dateOrHash: string
): Promise<{ path: string; sha: string }> {
  throw new Error('checkoutCommit not yet implemented')
}

/**
 * List all folders in the repository.
 * Reads folder names from folders/*.json filenames.
 *
 * @param repoPath - Path to the mail repository
 * @returns Array of folder names
 */
export async function listFolders(repoPath: string): Promise<string[]> {
  throw new Error('listFolders not yet implemented')
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
  throw new Error('listMessages not yet implemented')
}

/**
 * View a message in the specified format.
 *
 * @param repoPath - Path to the mail repository
 * @param messageId - Message-ID of the message to view
 * @param format - Output format: 'eml' (raw), 'plaintext' (text/plain), or 'json' (headers + parts)
 * @returns Raw message content (eml), plaintext body, or JSON structure
 */
export async function viewMessage(
  repoPath: string,
  messageId: string,
  format: 'eml' | 'plaintext' | 'json'
): Promise<string | Record<string, unknown>> {
  throw new Error('viewMessage not yet implemented')
}
