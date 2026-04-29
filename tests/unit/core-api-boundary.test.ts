import { describe, it, expect } from 'vitest'
import * as core from '../../src/core/index.js'

describe('ARCH-01: core module API boundary', () => {
  it('exports RepositoryConfig as a usable interface (compile-time check)', () => {
    // If RepositoryConfig is not exported, this assignment fails at TypeScript compile time.
    const config: core.RepositoryConfig = {
      host: 'localhost',
      port: 993,
      username: 'jan@gmail.com',
      tls: true,
      passwordRef: 'env:BACKMAIL_PASSWORD',
    }
    expect(config.host).toBe('localhost')
    expect(config.port).toBe(993)
    expect(config.username).toBe('jan@gmail.com')
    expect(config.tls).toBe(true)
    expect(config.passwordRef).toBe('env:BACKMAIL_PASSWORD')
  })

  it('exports ping as a function', () => {
    expect(typeof core.ping).toBe('function')
  })

  it('ping returns a Promise (async function)', () => {
    // ping throws 'Not implemented' in Phase 1 — we only check it returns a Promise
    const result = core.ping({})
    expect(result).toBeInstanceOf(Promise)
    // Suppress unhandled rejection from the stub
    result.catch(() => {})
  })
})

describe('Phase 3: sync public API surface', () => {
  it('exports syncAccount as a function', () => {
    expect(typeof core.syncAccount).toBe('function')
  })

  it('SyncResult type is usable (compile-time check)', () => {
    // If SyncResult is not exported as a type, this assignment fails at tsc.
    const result: core.SyncResult = {
      added: 0,
      removed: 0,
      partial: false,
      repoInitialized: false,
      folderResults: [],
    }
    expect(result.added).toBe(0)
    expect(result.folderResults).toEqual([])
  })

  it('SyncOptions type is usable (compile-time check)', () => {
    const opts: core.SyncOptions = {
      excludeFolders: [],
      onlyFolders: [],
      verbose: false,
    }
    expect(opts.verbose).toBe(false)
  })

  it('FolderSyncResult type is usable (compile-time check)', () => {
    const fr: core.FolderSyncResult = {
      path: 'INBOX',
      added: 1,
      removed: 0,
    }
    expect(fr.path).toBe('INBOX')
  })
})
