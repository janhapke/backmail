import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

// All tests in this file are RED until src/core/config.ts is created in Plan 02-02.
// The import below will fail with MODULE_NOT_FOUND, causing all tests to error — expected RED state.
import { getConfigPath, loadConfig, getPassword } from '../../src/core/config.js'

// ---------------------------------------------------------------------------
// Mock @napi-rs/keyring Entry class — used by all getPassword tests.
// vi.mock is hoisted to the top of the file by Vitest.
// ---------------------------------------------------------------------------
vi.mock('@napi-rs/keyring', () => {
  const mockGetPassword = vi.fn()
  return {
    Entry: vi.fn().mockImplementation(() => ({
      getPassword: mockGetPassword,
    })),
    _mockGetPassword: mockGetPassword,
  }
})

// ---------------------------------------------------------------------------
// CONFIG-01: OS-appropriate config path
// ---------------------------------------------------------------------------

describe('getConfigDir', () => {
  let originalPlatform: PropertyDescriptor | undefined

  beforeEach(() => {
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  })

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    delete process.env.XDG_CONFIG_HOME
    delete process.env.APPDATA
  })

  it('returns linux path when process.platform is linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    delete process.env.XDG_CONFIG_HOME

    const result = getConfigPath()

    expect(result).toBe(path.join(os.homedir(), '.config', 'backmail', 'config.json'))
  })

  it('returns macOS Application Support path when process.platform is darwin', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

    const result = getConfigPath()

    expect(result).toContain(path.join('Library', 'Application Support', 'backmail', 'config.json'))
  })

  it('returns APPDATA path when process.platform is win32', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    process.env.APPDATA = 'C:\\Users\\jan\\AppData\\Roaming'

    const result = getConfigPath()

    expect(result).toContain(path.join('backmail', 'config.json'))
  })
})

// ---------------------------------------------------------------------------
// CONFIG-01: Missing config file error
// ---------------------------------------------------------------------------

describe('missing config', () => {
  it('throws error with config path when file does not exist', () => {
    expect(() => loadConfig('/nonexistent/path/config.json')).toThrow(
      'No config found at /nonexistent/path/config.json'
    )
  })
})

// ---------------------------------------------------------------------------
// CONFIG-02: Valid config parsing
// ---------------------------------------------------------------------------

describe('valid config', () => {
  let tmpDir: string
  let tmpConfigPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-test-'))
    tmpConfigPath = path.join(tmpDir, 'config.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('parses a valid multi-account config', () => {
    const config = {
      accounts: {
        gmail: {
          host: 'imap.gmail.com',
          port: 993,
          username: 'user@gmail.com',
          tls: true,
          repoPath: '/tmp/gmail',
        },
      },
    }
    fs.writeFileSync(tmpConfigPath, JSON.stringify(config))

    const result = loadConfig(tmpConfigPath)

    expect(result.accounts.gmail.host).toBe('imap.gmail.com')
  })
})

// ---------------------------------------------------------------------------
// CONFIG-02: Schema validation
// ---------------------------------------------------------------------------

describe('invalid schema', () => {
  let tmpDir: string
  let tmpConfigPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-test-'))
    tmpConfigPath = path.join(tmpDir, 'config.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('throws on missing host', () => {
    const config = {
      accounts: {
        gmail: {
          // host is intentionally missing
          port: 993,
          username: 'user@gmail.com',
          tls: true,
          repoPath: '/tmp/gmail',
        },
      },
    }
    fs.writeFileSync(tmpConfigPath, JSON.stringify(config))

    expect(() => loadConfig(tmpConfigPath)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// CONFIG-02: repoPath resolution
// ---------------------------------------------------------------------------

describe('repoPath', () => {
  let tmpDir: string
  let tmpConfigPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-test-'))
    tmpConfigPath = path.join(tmpDir, 'config.json')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('resolves tilde to absolute path', () => {
    const config = {
      accounts: {
        gmail: {
          host: 'imap.gmail.com',
          port: 993,
          username: 'user@gmail.com',
          tls: true,
          repoPath: '~/mail/gmail',
        },
      },
    }
    fs.writeFileSync(tmpConfigPath, JSON.stringify(config))

    const result = loadConfig(tmpConfigPath)

    expect(result.accounts.gmail.repoPath).toBe(path.join(os.homedir(), 'mail', 'gmail'))
  })

  it('resolves relative path against config dir', () => {
    const configDir = path.join(os.tmpdir(), 'backmail-test-rel')
    fs.mkdirSync(configDir, { recursive: true })
    const configPath = path.join(configDir, 'config.json')

    const config = {
      accounts: {
        gmail: {
          host: 'imap.gmail.com',
          port: 993,
          username: 'user@gmail.com',
          tls: true,
          repoPath: './gmail',
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(config))

    const result = loadConfig(configPath)

    expect(result.accounts.gmail.repoPath).toBe(path.join(configDir, 'gmail'))

    fs.rmSync(configDir, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------
// CONFIG-03: Credential lookup — keyring success
// ---------------------------------------------------------------------------

describe('getPassword keyring', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = await import('@napi-rs/keyring') as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockReturnValue('secret123')
  })

  afterEach(() => {
    delete process.env.BACKMAIL_GMAIL_PASSWORD
  })

  it('returns keyring value when available', async () => {
    const result = await getPassword('gmail')
    expect(result).toBe('secret123')
  })
})

// ---------------------------------------------------------------------------
// CONFIG-03: Credential lookup — env var fallback
// ---------------------------------------------------------------------------

describe('getPassword env var', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = await import('@napi-rs/keyring') as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockReturnValue(null)
    process.env.BACKMAIL_GMAIL_PASSWORD = 'envpass'
  })

  afterEach(() => {
    delete process.env.BACKMAIL_GMAIL_PASSWORD
  })

  it('falls back to env var when keyring returns null', async () => {
    const result = await getPassword('gmail')
    expect(result).toBe('envpass')
  })
})

// ---------------------------------------------------------------------------
// CONFIG-03: Credential lookup — throws when no credential
// ---------------------------------------------------------------------------

describe('getPassword throws', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = await import('@napi-rs/keyring') as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockReturnValue(null)
    delete process.env.BACKMAIL_GMAIL_PASSWORD
  })

  it('throws when neither keyring nor env var has value', async () => {
    await expect(getPassword('gmail')).rejects.toThrow('No credential for account "gmail"')
  })
})

// ---------------------------------------------------------------------------
// CONFIG-03: Credential lookup — keyring throws (headless Linux)
// ---------------------------------------------------------------------------

describe('getPassword keyring error', () => {
  beforeEach(async () => {
    const { _mockGetPassword } = await import('@napi-rs/keyring') as any
    _mockGetPassword.mockReset()
    _mockGetPassword.mockImplementation(() => {
      throw new Error('DBus unavailable')
    })
    process.env.BACKMAIL_GMAIL_PASSWORD = 'envpass'
  })

  afterEach(() => {
    delete process.env.BACKMAIL_GMAIL_PASSWORD
  })

  it('falls back to env var when keyring throws', async () => {
    const result = await getPassword('gmail')
    expect(result).toBe('envpass')
  })
})
