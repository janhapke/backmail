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

})

describe('sync public API surface', () => {
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

describe('credential infrastructure public API surface', () => {
  it('exports loadRepositoryConfig as a function', () => {
    expect(typeof core.loadRepositoryConfig).toBe('function')
  })

  it('exports parsePasswordRef as a function', () => {
    expect(typeof core.parsePasswordRef).toBe('function')
  })

  it('exports getPasswordByRef as a function', () => {
    expect(typeof core.getPasswordByRef).toBe('function')
  })

  it('RepositoryConfig type is usable (compile-time check)', () => {
    const config: core.RepositoryConfig = {
      host: 'imap.example.com',
      port: 993,
      username: 'user@example.com',
      tls: true,
      passwordRef: 'keyring:service=backmail;account=user@example.com',
    }
    expect(config.passwordRef).toContain('keyring:')
  })
})
