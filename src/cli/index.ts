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

// Short-circuit for help/version flags — these must work without a config file
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  program.parse(process.argv)
  process.exit(0)
}

// Phase 2: Load and validate config before any command dispatch.
// loadConfig() throws with the D-08 message when the file is missing.
// getPassword() is NOT called here — credentials are lazy (D-09).
let config
try {
  config = loadConfig()
} catch (err) {
  // Core threw — print to stderr and exit 1 (D-08)
  // Do NOT log the full stack trace — only the error message
  console.error((err as Error).message)
  process.exit(1)
}

// Phase 2+ will add: sync, log, checkout, ls, view, restore subcommands.
// Each subcommand receives `config` and calls getPassword(accountName) lazily when needed.

// Suppress unused variable warning — config is used by Phase 3+ subcommands
void config

// ── Phase 3: sync subcommand ─────────────────────────────────────────────────
import { syncAccount } from '../core/index.js'

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

program.parse(process.argv)
