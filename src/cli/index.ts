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

program.parse(process.argv)
