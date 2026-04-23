#!/usr/bin/env node
// src/cli/index.ts — ARCH-02: thin CLI wrapper over core
// RULES:
//   - Import only from src/core/, node: built-ins, and npm packages
//   - No business logic here — all logic lives in src/core/
//   - process.exit() and console are acceptable here (this IS the CLI layer)

import { Command } from 'commander'
import { loadConfig } from '../core/index.js'

const program = new Command()

program
  .name('backmail')
  .description('Mirror IMAP mailboxes to git')
  .version('0.1.0')

// Helper to load config with error handling
function getConfig() {
  try {
    return loadConfig()
  } catch (err) {
    // Core threw — print to stderr and exit 1 (D-08)
    // Do NOT log the full stack trace — only the error message
    console.error((err as Error).message)
    process.exit(1)
  }
}

// ── Phase 3+ imports ────────────────────────────────────────────────────────
import { syncAccount, getLog, checkoutCommit, listFolders, listMessages, viewMessage, resolveAccount, restoreAccount } from '../core/index.js'

function collectRepeatable(value: string, previous: string[]): string[] {
  return [...previous, value]
}

program
  .command('sync [account]')
  .description('Sync IMAP mailbox(es) to git')
  .option('--all', 'sync all configured accounts')
  .option('--exclude-folder <name>', 'skip this folder (repeatable)', collectRepeatable, [])
  .option('--only-folder <name>', 'restrict to this folder (repeatable)', collectRepeatable, [])
  .option('--verbose', 'log one line per folder and per message')
  .action(async (account: string | undefined, opts: { all?: boolean; excludeFolder: string[]; onlyFolder: string[]; verbose?: boolean }) => {
    const config = getConfig()

    // D-02: --exclude-folder and --only-folder are mutually exclusive
    if (opts.excludeFolder.length > 0 && opts.onlyFolder.length > 0) {
      console.error('Error: --exclude-folder and --only-folder are mutually exclusive')
      process.exit(1)
    }

    // SYNC-06: --all iterates every configured account
    let accountNames: string[]
    if (opts.all) {
      accountNames = Object.keys(config.accounts)
      if (accountNames.length === 0) {
        console.error('No accounts configured')
        process.exit(1)
      }
    } else if (account) {
      if (!(account in config.accounts)) {
        console.error(`Unknown account: ${account}`)
        process.exit(1)
      }
      accountNames = [account]
    } else {
      console.error('Specify an account name or use --all')
      process.exit(1)
    }

    let anyFailed = false
    for (const name of accountNames) {
      try {
        const result = await syncAccount(name, config.accounts[name], {
          excludeFolders: opts.excludeFolder,
          onlyFolders: opts.onlyFolder,
          verbose: opts.verbose ?? false,
        })
        if (result.repoInitialized) {
          console.log(`Initialized git repo at ${config.accounts[name].repoPath}`)
        }
        // D-05 summary format; D-08 partial marker
        const partialTag = result.partial ? ' [partial]' : ''
        console.log(`${name}${partialTag}: +${result.added} added / -${result.removed} removed`)
        // Per-folder error surfacing (verbose or error-only)
        for (const fr of result.folderResults) {
          if (fr.error) {
            console.error(`${name}: folder ${fr.path} failed: ${fr.error.message}`)
            anyFailed = true
          } else if (opts.verbose) {
            console.log(`${name}: ${fr.path}: +${fr.added} / -${fr.removed}`)
          }
        }
      } catch (err) {
        console.error(`${name}: ${(err as Error).message}`)
        anyFailed = true
      }
    }

    if (anyFailed) process.exit(1)
  })

// ── Phase 4: accounts subcommand ─────────────────────────────────────────────
program
  .command('accounts')
  .description('List all configured IMAP accounts')
  .action(() => {
    const config = getConfig()
    const names = Object.keys(config.accounts)
    for (const name of names) {
      console.log(name)
    }
  })

// ── Phase 4: log subcommand ─────────────────────────────────────────────────
program
  .command('log')
  .description('Show git commit history for account')
  .option('--account <name>', 'account name (optional if single account configured)')
  .option('--limit <n>', 'number of commits to show (or "unlimited")', '20')
  .action(async (opts: { account?: string; limit: string }) => {
    try {
      const config = getConfig()
      const [, accountConfig] = resolveAccount(config, opts.account)
      const limitValue = opts.limit === 'unlimited' ? 'unlimited' : parseInt(opts.limit, 10)
      const commits = await getLog(accountConfig.repoPath, limitValue)
      for (const msg of commits) {
        console.log(msg)
      }
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

// ── Phase 4: checkout subcommand ─────────────────────────────────────────────
program
  .command('checkout <date|commit>')
  .description('Create a git worktree at a point in history')
  .option('--account <name>', 'account name (optional if single account configured)')
  .action(async (dateOrHash: string, opts: { account?: string }) => {
    try {
      const config = getConfig()
      const [, accountConfig] = resolveAccount(config, opts.account)
      const result = await checkoutCommit(accountConfig.repoPath, dateOrHash)
      console.log(`Checked out ${dateOrHash} (${result.sha}) → ${result.path}`)
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

// ── Phase 4: ls subcommand ──────────────────────────────────────────────────
program
  .command('ls [folder]')
  .description('List folders or messages in a folder')
  .option('--account <name>', 'account name (optional if single account configured)')
  .action(async (folder: string | undefined, opts: { account?: string }) => {
    try {
      const config = getConfig()
      const [, accountConfig] = resolveAccount(config, opts.account)
      if (!folder) {
        // List folders
        const folders = await listFolders(accountConfig.repoPath)
        for (const f of folders) {
          console.log(f)
        }
      } else {
        // List messages in folder
        const messages = await listMessages(accountConfig.repoPath, folder)
        for (const msg of messages) {
          console.log(`${msg.messageId}\t${msg.date}\t${msg.from}\t${msg.subject}`)
        }
      }
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }
  })

// ── Phase 4: view subcommand ────────────────────────────────────────────────
program
  .command('view <message-id>')
  .description('View an email message')
  .option('--account <name>', 'account name (optional if single account configured)')
  .option('--format <fmt>', 'output format: eml, plaintext, json', 'plaintext')
  .action(async (messageId: string, opts: { account?: string; format: string }) => {
    try {
      const config = getConfig()
      const [, accountConfig] = resolveAccount(config, opts.account)
      const format = opts.format as 'eml' | 'plaintext' | 'json'
      const result = await viewMessage(accountConfig.repoPath, messageId, format)
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

// ── Phase 5: restore subcommand ─────────────────────────────────────────────
program
  .command('restore [date|commit]')
  .description('Restore messages from backup to target IMAP server')
  .requiredOption('--to <imap-url>', 'target IMAP URL (imap:// or imaps://)')
  .option('--account <name>', 'account name (optional if single account configured)')
  .option('--skip-duplicates <yes|no>', 'check for duplicates (default: yes)', 'yes')
  .option('--dry-run', 'output without writing to target server', false)
  .option('--verbose', 'log one line per message', false)
  .action(async (dateOrCommit: string | undefined, opts: {
    to: string
    account?: string
    skipDuplicates: string
    dryRun?: boolean
    verbose?: boolean
  }) => {
    try {
      const config = getConfig()
      const [, accountConfig] = resolveAccount(config, opts.account)

      // Convert --skip-duplicates string to boolean (D-11)
      const skipDuplicates = opts.skipDuplicates === 'yes'
      const dryRun = opts.dryRun ?? false
      const verbose = opts.verbose ?? false

      // Call core restoreAccount function
      const result = await restoreAccount(
        accountConfig,
        opts.to,
        dateOrCommit,
        {
          skipDuplicates,
          dryRun,
          verbose,
        }
      )

      // Format and print output (D-14, D-15, D-16)
      const prefix = dryRun ? '[dry-run] ' : ''
      if (result.errors === 0) {
        console.log(
          `${prefix}Total: ${result.uploaded} uploaded, ${result.skipped} skipped`
        )
      } else {
        // D-18: Include error count in summary
        console.log(
          `${prefix}Total: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.errors} errors`
        )
        // D-19: Include retry hint
        console.error('Re-run with --skip-duplicates=yes to safely retry (already-uploaded messages will be skipped)')
        process.exit(1)
      }
    } catch (err) {
      // D-19: Print error but never the URL with password (Pitfall 4, T-5-02)
      const msg = (err as Error).message
      console.error(`Restore failed: ${msg}`)
      process.exit(1)
    }
  })

program.parse(process.argv)
