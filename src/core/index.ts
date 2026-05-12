// src/core/index.ts — public API boundary
// Must be importable without CLI context: no exit calls, no console, no CLI imports.
// All relative imports must use .js extension (nodenext moduleResolution).

// Repository config
export type { RepositoryConfig, PasswordRef } from './config.js'
export { loadRepositoryConfig, parsePasswordRef, getPasswordByRef } from './config.js'

// Repository discovery
export { findRepository } from './discovery.js'

// Sync
export type { SyncResult, SyncOptions, FolderSyncResult } from './sync.js'
export { syncAccount, reindexLocalFolders } from './sync.js'

// Browse
export type { MessageSummary } from './browse.js'
export {
  getLog,
  checkoutCommit,
  listFolders,
  listMessages,
  viewMessage,
} from './browse.js'

// Restore
export type { RestoreResult, RestoreOptions } from './restore.js'
export { restoreAccount } from './restore.js'

// Init
export { initRepository } from './init.js'
