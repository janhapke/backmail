import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { initRepository } from '../../src/core/init.js'

vi.mock('@napi-rs/keyring', () => {
  const mockSetPassword = vi.fn()
  const mockGetPassword = vi.fn()
  return {
    Entry: vi.fn().mockImplementation(function () {
      return { getPassword: mockGetPassword, setPassword: mockSetPassword }
    }),
    _mockSetPassword: mockSetPassword,
    _mockGetPassword: mockGetPassword,
  }
})

vi.mock('simple-git', () => ({
  simpleGit: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
  })),
}))

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-init-test-'))
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const testConfig = {
  host: 'imap.example.com',
  port: 993,
  username: 'user@example.com',
  tls: true,
  passwordRef: 'keyring:service=backmail;account=user@example.com',
}

describe('initRepository', () => {
  it('creates .backmail/, .backmail/config.json, .backmail/log, archive/, worktrees/', async () => {
    await initRepository(tmpDir, testConfig, 'keyring:service=backmail;account=user@example.com')
    expect(fs.existsSync(path.join(tmpDir, '.backmail'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, '.backmail', 'config.json'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, '.backmail', 'log'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'archive'))).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, 'worktrees'))).toBe(true)
  })

  it('writes config.json with all config fields and passwordRef', async () => {
    const passwordRef = 'keyring:service=backmail;account=user@example.com'
    await initRepository(tmpDir, testConfig, passwordRef)
    const written = JSON.parse(fs.readFileSync(path.join(tmpDir, '.backmail', 'config.json'), 'utf-8'))
    expect(written.host).toBe('imap.example.com')
    expect(written.port).toBe(993)
    expect(written.username).toBe('user@example.com')
    expect(written.tls).toBe(true)
    expect(written.passwordRef).toBe(passwordRef)
  })

  it('calls simpleGit(archivePath).init()', async () => {
    const { simpleGit } = await import('simple-git')
    const mockInit = vi.fn().mockResolvedValue(undefined)
    ;(simpleGit as ReturnType<typeof vi.fn>).mockImplementation(() => ({ init: mockInit }))
    await initRepository(tmpDir, testConfig, 'keyring:service=backmail;account=user@example.com')
    const expectedArchivePath = path.join(tmpDir, 'archive')
    expect(simpleGit).toHaveBeenCalledWith(expectedArchivePath)
    expect(mockInit).toHaveBeenCalledOnce()
  })

  it('throws "Repository already exists" error when .backmail/ already exists', async () => {
    fs.mkdirSync(path.join(tmpDir, '.backmail'))
    await expect(
      initRepository(tmpDir, testConfig, 'keyring:service=backmail;account=user@example.com')
    ).rejects.toThrow(/Repository already exists at/)
  })

  it('does not create any new files when .backmail/ already exists', async () => {
    fs.mkdirSync(path.join(tmpDir, '.backmail'))
    await expect(
      initRepository(tmpDir, testConfig, 'keyring:service=backmail;account=user@example.com')
    ).rejects.toThrow()
    // archive/ and worktrees/ must NOT have been created
    expect(fs.existsSync(path.join(tmpDir, 'archive'))).toBe(false)
    expect(fs.existsSync(path.join(tmpDir, 'worktrees'))).toBe(false)
  })
})
