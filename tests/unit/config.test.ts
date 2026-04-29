import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

import { loadRepositoryConfig, parsePasswordRef, getPasswordByRef } from '../../src/core/config.js'

// ---------------------------------------------------------------------------
// Mock @napi-rs/keyring Entry class — used by all getPasswordByRef tests.
// vi.mock is hoisted to the top of the file by Vitest.
// ---------------------------------------------------------------------------
vi.mock('@napi-rs/keyring', () => {
  const mockGetPassword = vi.fn()
  // Use a regular function (not arrow) so that `new Entry(...)` works in Vitest 4.x.
  // Arrow functions cannot be used as constructors (Reflect.construct requirement).
  return {
    Entry: vi.fn().mockImplementation(function () {
      return { getPassword: mockGetPassword }
    }),
    _mockGetPassword: mockGetPassword,
  }
})

// ---------------------------------------------------------------------------
// CRED-01: loadRepositoryConfig
// ---------------------------------------------------------------------------

describe('loadRepositoryConfig', () => {
  let tmpDir: string
  let tmpConfigPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-test-'))
    const backmailDir = path.join(tmpDir, '.backmail')
    fs.mkdirSync(backmailDir)
    tmpConfigPath = path.join(backmailDir, 'config.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('throws error containing "No config found at" when file does not exist', () => {
    const missingDir = path.join(os.tmpdir(), 'backmail-nonexistent-' + Date.now())
    expect(() => loadRepositoryConfig(missingDir)).toThrow('No config found at')
  })

  it('includes the config path in the ENOENT error message', () => {
    const missingDir = path.join(os.tmpdir(), 'backmail-nonexistent-' + Date.now())
    const expectedPath = path.join(missingDir, '.backmail', 'config.json')
    expect(() => loadRepositoryConfig(missingDir)).toThrow(expectedPath)
  })

  it('throws error containing "is not valid JSON" when config.json is malformed', () => {
    fs.writeFileSync(tmpConfigPath, 'not-json{{{')
    expect(() => loadRepositoryConfig(tmpDir)).toThrow('is not valid JSON')
  })

  it('lets ZodError propagate when config is missing required fields', () => {
    fs.writeFileSync(tmpConfigPath, JSON.stringify({ host: 'imap.example.com' }))
    expect(() => loadRepositoryConfig(tmpDir)).toThrow()
  })

  it('returns a typed RepositoryConfig when config is valid', () => {
    const config = {
      host: 'imap.example.com',
      port: 993,
      username: 'jan@example.com',
      tls: true,
      passwordRef: 'keyring:service=backmail;account=jan@example.com',
    }
    fs.writeFileSync(tmpConfigPath, JSON.stringify(config))

    const result = loadRepositoryConfig(tmpDir)

    expect(result.host).toBe('imap.example.com')
    expect(result.port).toBe(993)
    expect(result.username).toBe('jan@example.com')
    expect(result.tls).toBe(true)
    expect(result.passwordRef).toBe('keyring:service=backmail;account=jan@example.com')
  })
})

// ---------------------------------------------------------------------------
// CRED-02: parsePasswordRef
// ---------------------------------------------------------------------------

describe('parsePasswordRef - keyring scheme', () => {
  it('parses keyring ref with email account correctly', () => {
    const result = parsePasswordRef('keyring:service=backmail;account=user@example.com')
    expect(result).toEqual({ type: 'keyring', service: 'backmail', account: 'user@example.com' })
  })

  it('parses keyring ref with simple account name', () => {
    const result = parsePasswordRef('keyring:service=backmail;account=jan')
    expect(result).toEqual({ type: 'keyring', service: 'backmail', account: 'jan' })
  })

  it('throws when keyring ref is missing account=', () => {
    expect(() => parsePasswordRef('keyring:service=backmail')).toThrow(
      'must include service= and account= keys'
    )
  })

  it('throws when keyring ref is missing service=', () => {
    expect(() => parsePasswordRef('keyring:account=jan')).toThrow(
      'must include service= and account= keys'
    )
  })
})

describe('parsePasswordRef - env scheme', () => {
  it('parses env ref with standard var name', () => {
    const result = parsePasswordRef('env:BACKMAIL_PASSWORD')
    expect(result).toEqual({ type: 'env', envVar: 'BACKMAIL_PASSWORD' })
  })

  it('parses env ref with custom var name', () => {
    const result = parsePasswordRef('env:MY_CUSTOM_VAR')
    expect(result).toEqual({ type: 'env', envVar: 'MY_CUSTOM_VAR' })
  })

  it('throws when env ref has empty var name', () => {
    expect(() => parsePasswordRef('env:')).toThrow('variable name must follow "env:"')
  })
})

describe('parsePasswordRef - unsupported schemes', () => {
  it('throws with scheme name when scheme is unknown', () => {
    expect(() => parsePasswordRef('ftp:something')).toThrow('Unsupported passwordRef scheme "ftp"')
  })

  it('throws when there is no colon (no scheme)', () => {
    expect(() => parsePasswordRef('unknown')).toThrow('Unsupported passwordRef scheme "unknown"')
  })
})

// ---------------------------------------------------------------------------
// CRED-03: getPasswordByRef - keyring success
// ---------------------------------------------------------------------------

describe('getPasswordByRef keyring success', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = await import('@napi-rs/keyring') as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockReturnValue('secret')
  })

  it('resolves to keyring value when keyring returns a string', async () => {
    const result = await getPasswordByRef('keyring:service=backmail;account=jan')
    expect(result).toBe('secret')
  })
})

// ---------------------------------------------------------------------------
// CRED-03: getPasswordByRef - keyring returns null, env fallback
// ---------------------------------------------------------------------------

describe('getPasswordByRef keyring null + BACKMAIL_PASSWORD fallback', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = await import('@napi-rs/keyring') as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockReturnValue(null)
    process.env.BACKMAIL_PASSWORD = 'envpass'
  })

  afterEach(() => {
    delete process.env.BACKMAIL_PASSWORD
  })

  it('falls back to BACKMAIL_PASSWORD when keyring returns null', async () => {
    const result = await getPasswordByRef('keyring:service=backmail;account=jan')
    expect(result).toBe('envpass')
  })
})

// ---------------------------------------------------------------------------
// CRED-03: getPasswordByRef - keyring throws, env fallback (headless Linux)
// ---------------------------------------------------------------------------

describe('getPasswordByRef keyring throws', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = await import('@napi-rs/keyring') as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockImplementation(() => {
      throw new Error('DBus unavailable')
    })
    process.env.BACKMAIL_PASSWORD = 'envpass'
  })

  afterEach(() => {
    delete process.env.BACKMAIL_PASSWORD
  })

  it('falls back to BACKMAIL_PASSWORD when keyring throws DBus error', async () => {
    const result = await getPasswordByRef('keyring:service=backmail;account=jan')
    expect(result).toBe('envpass')
  })
})

// ---------------------------------------------------------------------------
// CRED-03: getPasswordByRef - env: scheme
// ---------------------------------------------------------------------------

describe('getPasswordByRef env scheme', () => {
  beforeEach(() => {
    process.env.MY_VAR = 'myvalue'
  })

  afterEach(() => {
    delete process.env.MY_VAR
    delete process.env.BACKMAIL_PASSWORD
  })

  it('resolves to env var value when env: scheme and var is set', async () => {
    const result = await getPasswordByRef('env:MY_VAR')
    expect(result).toBe('myvalue')
  })

  it('falls back to BACKMAIL_PASSWORD when env var is not set', async () => {
    delete process.env.MY_VAR
    process.env.BACKMAIL_PASSWORD = 'fallback'
    const result = await getPasswordByRef('env:MY_VAR')
    expect(result).toBe('fallback')
  })
})

// ---------------------------------------------------------------------------
// CRED-03: getPasswordByRef - throws when nothing resolves
// ---------------------------------------------------------------------------

describe('getPasswordByRef throws when no credential', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = await import('@napi-rs/keyring') as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockReturnValue(null)
    delete process.env.BACKMAIL_PASSWORD
  })

  it('throws error mentioning BACKMAIL_PASSWORD when no credential resolves', async () => {
    await expect(
      getPasswordByRef('keyring:service=backmail;account=jan')
    ).rejects.toThrow('BACKMAIL_PASSWORD')
  })
})
