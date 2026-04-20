#!/usr/bin/env node
// src/cli/index.ts — ARCH-02: thin CLI wrapper over core
// RULES:
//   - Import only from src/core/, node: built-ins, and npm packages
//   - No business logic here — all logic lives in src/core/
//   - process.exit() and console are acceptable here (this IS the CLI layer)

import { Command } from 'commander'

const program = new Command()

program
  .name('backmail')
  .description('Mirror IMAP mailboxes to git')
  .version('0.1.0')

// Phase 1: skeleton only — no subcommands yet
// Phase 2+ will add: config, sync, log, checkout, ls, view, restore

program.parse(process.argv)
