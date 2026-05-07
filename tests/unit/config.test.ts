import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { loadRepositoryConfig, parsePasswordRef, getPasswordByRef } from '../../src/core/config.js'

vi.mock('@napi-rs/keyring', () => {
  const mockGetPassword = vi.fn()
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

  it('returns RepositoryConfig when config.json is valid', () => {
    const config = {
      host: 'imap.example.com',
      port: 993,
      username: 'user@example.com',
      tls: true,
      passwordRef: 'env:BACKMAIL_PASSWORD',
    }
    fs.writeFileSync(tmpConfigPath, JSON.stringify(config))
    const result = loadRepositoryConfig(tmpDir)
    expect(result.host).toBe('imap.example.com')
  })

  it('throws with path in message when .backmail/config.json does not exist', () => {
    expect(() => loadRepositoryConfig('/nonexistent/dir')).toThrow('No config found at')
  })

  it('throws when config.json is not valid JSON', () => {
    fs.writeFileSync(tmpConfigPath, 'not-json-at-all')
    expect(() => loadRepositoryConfig(tmpDir)).toThrow('is not valid JSON')
  })

  it('throws ZodError when required field is missing', () => {
    fs.writeFileSync(
      tmpConfigPath,
      JSON.stringify({ port: 993, username: 'user@example.com', tls: true, passwordRef: 'env:X' })
    )
    expect(() => loadRepositoryConfig(tmpDir)).toThrow()
  })

  it('throws ZodError when passwordRef is empty string', () => {
    fs.writeFileSync(
      tmpConfigPath,
      JSON.stringify({
        host: 'imap.example.com',
        port: 993,
        username: 'user@example.com',
        tls: true,
        passwordRef: '',
      })
    )
    expect(() => loadRepositoryConfig(tmpDir)).toThrow()
  })

  it('re-throws non-ENOENT errors from readFileSync (e.g. EACCES)', () => {
    const acces = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => { throw acces })
    try {
      expect(() => loadRepositoryConfig(tmpDir)).toThrow('permission denied')
    } finally {
      spy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// CRED-02: parsePasswordRef
// ---------------------------------------------------------------------------

describe('parsePasswordRef', () => {
  it('parses keyring ref with service and account', () => {
    const result = parsePasswordRef('keyring:service=backmail;account=user@example.com')
    expect(result).toEqual({ type: 'keyring', service: 'backmail', account: 'user@example.com' })
  })

  it('parses keyring ref where account contains special characters', () => {
    const result = parsePasswordRef('keyring:service=backmail;account=jan@gmail.com')
    expect(result.account).toBe('jan@gmail.com')
  })

  it('parses env ref', () => {
    const result = parsePasswordRef('env:BACKMAIL_PASSWORD')
    expect(result).toEqual({ type: 'env', envVar: 'BACKMAIL_PASSWORD' })
  })

  it('parses env ref with custom var name', () => {
    const result = parsePasswordRef('env:MY_CUSTOM_SECRET')
    expect(result).toEqual({ type: 'env', envVar: 'MY_CUSTOM_SECRET' })
  })

  it('throws on missing account= in keyring ref', () => {
    expect(() => parsePasswordRef('keyring:service=backmail')).toThrow(
      'must include service= and account= keys'
    )
  })

  it('throws on missing service= in keyring ref', () => {
    expect(() => parsePasswordRef('keyring:account=user')).toThrow(
      'must include service= and account= keys'
    )
  })

  it('throws on empty var name in env ref', () => {
    expect(() => parsePasswordRef('env:')).toThrow('variable name must follow "env:"')
  })

  it('throws on unsupported scheme', () => {
    expect(() => parsePasswordRef('ftp:something')).toThrow('Unsupported passwordRef scheme "ftp"')
  })

  it('throws on ref with no colon scheme', () => {
    expect(() => parsePasswordRef('plainpassword')).toThrow('Unsupported passwordRef scheme')
  })
})

// ---------------------------------------------------------------------------
// CRED-03: getPasswordByRef — keyring success
// ---------------------------------------------------------------------------

describe('getPasswordByRef — keyring success', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = (await import('@napi-rs/keyring')) as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockReturnValue('secret123')
  })

  it('resolves password from keyring', async () => {
    const result = await getPasswordByRef('keyring:service=backmail;account=jan')
    expect(result).toBe('secret123')
  })
})

// ---------------------------------------------------------------------------
// CRED-03: getPasswordByRef — keyring returns null, BACKMAIL_PASSWORD fallback
// ---------------------------------------------------------------------------

describe('getPasswordByRef — keyring returns null, BACKMAIL_PASSWORD fallback', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = (await import('@napi-rs/keyring')) as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockReturnValue(null)
    process.env.BACKMAIL_PASSWORD = 'envfallback'
  })

  afterEach(() => {
    delete process.env.BACKMAIL_PASSWORD
  })

  it('falls back to BACKMAIL_PASSWORD when keyring returns null', async () => {
    const result = await getPasswordByRef('keyring:service=backmail;account=jan')
    expect(result).toBe('envfallback')
  })
})

// ---------------------------------------------------------------------------
// CRED-03: getPasswordByRef — keyring throws, BACKMAIL_PASSWORD fallback
// ---------------------------------------------------------------------------

describe('getPasswordByRef — keyring returns a Promise (async keyring)', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = (await import('@napi-rs/keyring')) as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockReturnValue(Promise.resolve('async-secret'))
  })

  it('awaits the Promise and returns the resolved password', async () => {
    const result = await getPasswordByRef('keyring:service=backmail;account=jan')
    expect(result).toBe('async-secret')
  })
})

describe('getPasswordByRef — keyring throws, BACKMAIL_PASSWORD fallback', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = (await import('@napi-rs/keyring')) as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockImplementation(() => {
      throw new Error('DBus unavailable')
    })
    process.env.BACKMAIL_PASSWORD = 'envfallback'
  })

  afterEach(() => {
    delete process.env.BACKMAIL_PASSWORD
  })

  it('falls back to BACKMAIL_PASSWORD when keyring throws a dbus error', async () => {
    const result = await getPasswordByRef('keyring:service=backmail;account=jan')
    expect(result).toBe('envfallback')
  })
})

describe('getPasswordByRef — keyring throws "No such interface"', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = (await import('@napi-rs/keyring')) as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockImplementation(() => {
      throw new Error('No such interface "org.freedesktop.Secret.Service"')
    })
    process.env.BACKMAIL_PASSWORD = 'envfallback'
  })

  afterEach(() => {
    delete process.env.BACKMAIL_PASSWORD
  })

  it('swallows D-Bus "No such interface" error and falls back to BACKMAIL_PASSWORD', async () => {
    const result = await getPasswordByRef('keyring:service=backmail;account=jan')
    expect(result).toBe('envfallback')
  })
})

describe('getPasswordByRef — keyring throws an unexpected error', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = (await import('@napi-rs/keyring')) as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockImplementation(() => {
      throw new Error('Unexpected internal failure')
    })
    delete process.env.BACKMAIL_PASSWORD
  })

  it('re-throws errors that are not keyring/dbus/No-such-interface errors', async () => {
    await expect(
      getPasswordByRef('keyring:service=backmail;account=jan')
    ).rejects.toThrow('Unexpected internal failure')
  })
})

// ---------------------------------------------------------------------------
// CRED-03: getPasswordByRef — env: scheme
// ---------------------------------------------------------------------------

describe('getPasswordByRef — env: scheme', () => {
  beforeEach(() => {
    process.env.MY_TEST_VAR = 'testvalue'
  })

  afterEach(() => {
    delete process.env.MY_TEST_VAR
    delete process.env.BACKMAIL_PASSWORD
  })

  it('resolves password from env var named in ref', async () => {
    const result = await getPasswordByRef('env:MY_TEST_VAR')
    expect(result).toBe('testvalue')
  })

  it('falls back to BACKMAIL_PASSWORD when named env var is unset', async () => {
    delete process.env.MY_TEST_VAR
    process.env.BACKMAIL_PASSWORD = 'backmail_fallback'
    const result = await getPasswordByRef('env:MY_TEST_VAR')
    expect(result).toBe('backmail_fallback')
  })
})

// ---------------------------------------------------------------------------
// CRED-03: getPasswordByRef — no credential
// ---------------------------------------------------------------------------

describe('getPasswordByRef — no credential', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = (await import('@napi-rs/keyring')) as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockReturnValue(null)
    delete process.env.BACKMAIL_PASSWORD
  })

  it('throws with BACKMAIL_PASSWORD mentioned when nothing resolves', async () => {
    await expect(
      getPasswordByRef('keyring:service=backmail;account=jan')
    ).rejects.toThrow('BACKMAIL_PASSWORD')
  })
})
