#!/usr/bin/env node
// src/cli/index.ts — ARCH-02: thin CLI wrapper over core
// RULES:
//   - Import only from src/core/, node: built-ins, and npm packages
//   - No business logic here — all logic lives in src/core/
//   - process.exit() and console are acceptable here (this IS the CLI layer)

import { Command } from 'commander'
import { createRequire } from 'node:module'
import path from 'node:path'

const { version } = (createRequire(import.meta.url))('../../package.json') as { version: string }
import { loadRepositoryConfig, findRepository } from '../core/index.js'
import type { RepositoryConfig } from '../core/index.js'
import { input, confirm, password as promptPassword } from '@inquirer/prompts'
import { Entry } from '@napi-rs/keyring'
import { initRepository } from '../core/index.js'
import fs from 'node:fs'

const program = new Command()

program
  .name('backmail')
  .description('Backup Mail to git')
  .version(version)
  .option('--workdir <path>', 'path to backmail repository (default: auto-detect from CWD)')

function getRepoRoot(): string {
  const opts = program.opts() as { workdir?: string }
  const startDir = opts.workdir ? path.resolve(opts.workdir) : process.cwd()
  const repoRoot = findRepository(startDir)
  if (!repoRoot) {
    console.error(
      'Error: Not inside a backmail repository.\n' +
      'Use `backmail init` to create one, or `--workdir <path>` to specify a path.'
    )
    process.exit(1)
  }
  return repoRoot
}

import { syncAccount, getLog, checkoutCommit, listFolders, listMessages, viewMessage, restoreAccount } from '../core/index.js'

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return String(err)
}

function sanitizeErrorMessage(msg: string): string {
  return msg.replace(/(:)([^@:]+)@/g, ':***@')
}

function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value]
}

program
  .command('sync')
  .description('Sync IMAP mailbox(es) to git')
  .option('--exclude-folder <name>', 'skip this folder (repeatable)', collectRepeatable, [])
  .option('--only-folder <name>', 'restrict to this folder (repeatable)', collectRepeatable, [])
  .option('--verbose', 'log one line per folder and per message')
  .option('--force', 're-download all messages and overwrite local copies')
  .option('--reindex', 'rename existing .eml files to match current filename logic (no IMAP)')
  .action(async (opts: { excludeFolder: string[]; onlyFolder: string[]; verbose?: boolean; force?: boolean; reindex?: boolean }) => {
    if (opts.excludeFolder.length > 0 && opts.onlyFolder.length > 0) {
      console.error('Error: --exclude-folder and --only-folder are mutually exclusive')
      process.exit(1)
    }

    try {
      const repoRoot = getRepoRoot()
      const archivePath = path.join(repoRoot, 'archive')
      const config = loadRepositoryConfig(repoRoot)

      const verbose = opts.verbose ?? false
      const result = await syncAccount(config, archivePath, {
        excludeFolders: opts.excludeFolder,
        onlyFolders: opts.onlyFolder,
        verbose,
        force: opts.force ?? false,
        reindex: opts.reindex ?? false,
        onLog: verbose ? (msg) => console.log(msg) : undefined,
      })

      if (result.repoInitialized) {
        console.log(`Initialized git repo at ${archivePath}`)
      }

      if (opts.reindex) {
        console.log(`reindex: =${result.renamed} renamed`)
      } else {
        const partialTag = result.partial ? ' [partial]' : ''
        console.log(`sync${partialTag}: +${result.added} added / -${result.removed} removed`)
      }

      // Per-folder error surfacing
      for (const fr of result.folderResults) {
        if (fr.error) {
          console.error(`folder ${fr.path} failed: ${fr.error.message}`)
        }
      }

      if (result.folderResults.some((fr) => fr.error)) {
        process.exit(1)
      }
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

// ── log ─────────────────────────────────────────────────────────────────────
program
  .command('log')
  .description('Show git commit history')
  .option('--limit <n>', 'number of commits to show (or "unlimited")', '20')
  .action(async (opts: { limit: string }) => {
    try {
      const repoRoot = getRepoRoot()
      const archivePath = path.join(repoRoot, 'archive')
      const limitValue = opts.limit === 'unlimited' ? 'unlimited' : parseInt(opts.limit, 10)
      const commits = await getLog(archivePath, limitValue)
      for (const msg of commits) {
        console.log(msg)
      }
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

// ── checkout ─────────────────────────────────────────────────────────────────
program
  .command('checkout <date|commit>')
  .description('Create a git worktree at a point in history')
  .action(async (dateOrHash: string) => {
    try {
      const repoRoot = getRepoRoot()
      const archivePath = path.join(repoRoot, 'archive')
      const worktreesDir = path.join(repoRoot, 'worktrees')
      const result = await checkoutCommit(archivePath, dateOrHash, worktreesDir)
      console.log(`Checked out ${dateOrHash} (${result.sha}) → ${result.path}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

// ── ls ──────────────────────────────────────────────────────────────────────
program
  .command('ls [folder]')
  .description('List folders or messages in a folder')
  .action(async (folder: string | undefined) => {
    try {
      const repoRoot = getRepoRoot()
      const archivePath = path.join(repoRoot, 'archive')
      if (!folder) {
        // List folders
        const folders = await listFolders(archivePath)
        for (const f of folders) {
          console.log(f)
        }
      } else {
        // List messages in folder
        const messages = await listMessages(archivePath, folder)
        for (const msg of messages) {
          console.log(`${msg.messageId}\t${msg.date}\t${msg.from}\t${msg.subject}`)
        }
      }
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

// ── view ────────────────────────────────────────────────────────────────────
program
  .command('view <filename>')
  .description('View an email message (pass FOLDER/filename, e.g. INBOX/2025-05-08_hello-world_a1b2c3d4)')
  .option('--format <fmt>', 'output format: eml, plaintext, json', 'plaintext')
  .action(async (filename: string, opts: { format: string }) => {
    try {
      const repoRoot = getRepoRoot()
      const archivePath = path.join(repoRoot, 'archive')
      const format = opts.format as 'eml' | 'plaintext' | 'json'
      const result = await viewMessage(archivePath, filename, format)
      if (format === 'json') {
        console.log(JSON.stringify(result, null, 2))
      } else {
        console.log(result)
      }
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

// ── restore ─────────────────────────────────────────────────────────────────
program
  .command('restore [date|commit]')
  .description('Restore messages from backup to target IMAP server')
  .requiredOption('--to <imap-url>', 'target IMAP URL (imap:// or imaps://)')
  .option('--skip-duplicates <yes|no>', 'check for duplicates (default: yes)', 'yes')
  .option('--dry-run', 'output without writing to target server', false)
  .option('--verbose', 'log one line per message', false)
  .action(async (dateOrCommit: string | undefined, opts: {
    to: string
    skipDuplicates: string
    dryRun?: boolean
    verbose?: boolean
  }) => {
    try {
      const repoRoot = getRepoRoot()
      const archivePath = path.join(repoRoot, 'archive')

      const skipDuplicates = opts.skipDuplicates === 'yes'
      const dryRun = opts.dryRun ?? false
      const verbose = opts.verbose ?? false

      const result = await restoreAccount(
        archivePath,
        opts.to,
        dateOrCommit,
        {
          skipDuplicates,
          dryRun,
          verbose,
        }
      )

      const prefix = dryRun ? '[dry-run] ' : ''
      if (result.errors === 0) {
        console.log(
          `${prefix}Total: ${result.uploaded} uploaded, ${result.skipped} skipped`
        )
      } else {
        console.log(
          `${prefix}Total: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.errors} errors`
        )
        console.error('Re-run with --skip-duplicates=yes to safely retry (already-uploaded messages will be skipped)')
        process.exit(1)
      }
    } catch (err) {
      // Sanitize to avoid leaking the password from the --to URL
      const msg = sanitizeErrorMessage(getErrorMessage(err))
      console.error(`Restore failed: ${msg}`)
      process.exit(1)
    }
  })

// ── init ────────────────────────────────────────────────────────────────────
program
  .command('init [path]')
  .description('Create a new backmail repository')
  .option('--host <host>', 'IMAP server hostname')
  .option('--port <port>', 'IMAP server port (default: 993)')
  .option('--username <username>', 'IMAP account username')
  .option('--tls', 'use TLS (default: true)')
  .option('--no-tls', 'disable TLS')
  .option('--password <password>', 'IMAP password (written to OS keyring)')
  .option(
    '--password-ref <ref>',
    'passwordRef string written directly to config (e.g. env:BACKMAIL_PASSWORD) — use this in CI environments instead of --password',
  )
  .action(async (dirPath: string | undefined, opts: {
    host?: string
    port?: string
    username?: string
    tls?: boolean
    password?: string
    passwordRef?: string
  }) => {
    const targetDir = dirPath ? path.resolve(dirPath) : process.cwd()

    // Check before prompting — avoid collecting credentials for a repo that already exists
    if (fs.existsSync(path.join(targetDir, '.backmail'))) {
      console.error(`Repository already exists at ${targetDir}. Remove .backmail/ to reinitialize.`)
      process.exit(1)
    }

    // process.stdin.isTTY is true only on a real TTY; undefined when piped, false when explicitly set off
    const isTTY = process.stdin.isTTY === true

    let host: string
    if (opts.host !== undefined) {
      host = opts.host
    } else if (isTTY) {
      host = await input({ message: 'IMAP host:', required: true })
    } else {
      console.error('Error: --host is required in non-TTY mode')
      process.exit(1)
    }

    let port: number
    if (opts.port !== undefined) {
      const parsed = parseInt(opts.port, 10)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        console.error('Error: --port must be an integer between 1 and 65535')
        process.exit(1)
      }
      port = parsed
    } else if (isTTY) {
      const portStr = await input({
        message: 'IMAP port:',
        default: '993',
        validate: (v) => {
          const n = parseInt(v, 10)
          return (Number.isInteger(n) && n >= 1 && n <= 65535) || 'Port must be an integer 1–65535'
        },
      })
      port = parseInt(portStr, 10)
    } else {
      console.error('Error: --port is required in non-TTY mode')
      process.exit(1)
    }

    let username: string
    if (opts.username !== undefined) {
      username = opts.username
    } else if (isTTY) {
      username = await input({ message: 'IMAP username:', required: true })
    } else {
      console.error('Error: --username is required in non-TTY mode')
      process.exit(1)
    }

    let passwordRef: string
    if (opts.passwordRef !== undefined) {
      passwordRef = opts.passwordRef
    } else {
      let plaintext: string
      if (opts.password !== undefined) {
        plaintext = opts.password
      } else if (isTTY) {
        plaintext = await promptPassword({ message: 'IMAP password:', mask: true })
      } else {
        console.error('Error: --password or --password-ref is required in non-TTY mode')
        process.exit(1)
      }
      try {
        new Entry('backmail', username).setPassword(plaintext)
      } catch (err) {
        console.error(
          `Error: Failed to write password to OS keyring: ${getErrorMessage(err)}\n` +
          'Use --password-ref env:BACKMAIL_PASSWORD for CI environments.',
        )
        process.exit(1)
      }
      passwordRef = `keyring:service=backmail;account=${username}`
    }

    let tls: boolean
    if (opts.tls !== undefined) {
      tls = opts.tls
    } else if (isTTY) {
      tls = await confirm({ message: 'Use TLS?', default: true })
    } else {
      console.error('Error: --tls or --no-tls is required in non-TTY mode')
      process.exit(1)
    }

    const config: RepositoryConfig = { host, port, username, tls, passwordRef }

    try {
      await initRepository(targetDir, config, passwordRef)
      console.log(`Initialized backmail repository at ${targetDir}`)
    } catch (err) {
      console.error(getErrorMessage(err))
      process.exit(1)
    }
  })

program.parse(process.argv)
