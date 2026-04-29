// src/core/index.ts — ARCH-01: public API boundary
// This file is the eimerjs IPC boundary: must be importable without CLI context.
// RULES:
//   - No circular imports into the CLI layer (enforced by tests/unit/cli-boundary.test.ts)
//   - No process exit calls
//   - No console log/error calls
//   - No readline or interactive I/O
// All relative imports within src/core/ must use .js extension (nodenext moduleResolution).

/**
 * Stub: verify connectivity to an IMAP server.
 * Real implementation arrives in Phase 2 when imapflow is added.
 * Throws 'Not implemented' in Phase 1 — tests only verify the export shape.
 */
export async function ping(_config: unknown): Promise<boolean> {
  throw new Error('Not implemented')
}

// Phase 6: Repository config public API (replaces Phase 2 config exports)
export type { RepositoryConfig, PasswordRef } from './config.js'
export { loadRepositoryConfig, parsePasswordRef, getPasswordByRef } from './config.js'

// Phase 7: Repository discovery public API
export { findRepository } from './discovery.js'

// Phase 3: Sync module public API
export type { SyncResult, SyncOptions, FolderSyncResult } from './sync.js'
export { syncAccount } from './sync.js'

// Phase 4: Browse module public API
export type { MessageSummary } from './browse.js'
export {
  resolveAccount,
  getLog,
  checkoutCommit,
  listFolders,
  listMessages,
  viewMessage,
} from './browse.js'

// Phase 5: Restore module public API
export type { RestoreResult, RestoreOptions } from './restore.js'
export { restoreAccount } from './restore.js'
