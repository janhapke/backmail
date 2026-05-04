import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

describe('CMD-01: legacy account types absent from src/core/browse.ts', () => {
  const browseSource = readFileSync(
    resolve(__dirname, '../../src/core/browse.ts'),
    'utf-8'
  )

  it('browse.ts does not contain resolveAccount', () => {
    expect(browseSource).not.toMatch(/resolveAccount/)
  })

  it('browse.ts does not contain LegacyAccountConfig', () => {
    expect(browseSource).not.toMatch(/LegacyAccountConfig/)
  })

  it('browse.ts does not contain LegacyBackmailConfig', () => {
    expect(browseSource).not.toMatch(/LegacyBackmailConfig/)
  })
})

describe('CMD-01: resolveAccount not exported from src/core/index.ts', () => {
  const coreSource = readFileSync(
    resolve(__dirname, '../../src/core/index.ts'),
    'utf-8'
  )

  it('core/index.ts does not export or reference resolveAccount', () => {
    expect(coreSource).not.toMatch(/resolveAccount/)
  })
})

describe('CMD-02: resolveAccount import absent from src/cli/index.ts', () => {
  const cliSource = readFileSync(
    resolve(__dirname, '../../src/cli/index.ts'),
    'utf-8'
  )

  it('cli/index.ts does not import resolveAccount', () => {
    expect(cliSource).not.toMatch(/resolveAccount/)
  })
})

describe('CMD-02: getConfig helper absent from src/cli/index.ts', () => {
  const cliSource = readFileSync(
    resolve(__dirname, '../../src/cli/index.ts'),
    'utf-8'
  )

  it('cli/index.ts does not define function getConfig', () => {
    expect(cliSource).not.toMatch(/function getConfig/)
  })
})

describe('CMD-02: --account option absent from all CLI commands', () => {
  const cliSource = readFileSync(
    resolve(__dirname, '../../src/cli/index.ts'),
    'utf-8'
  )

  it("cli/index.ts does not register .option('--account ...')", () => {
    expect(cliSource).not.toMatch(/\.option\('--account/)
  })
})

describe('CMD-02: --all option absent from sync command', () => {
  const cliSource = readFileSync(
    resolve(__dirname, '../../src/cli/index.ts'),
    'utf-8'
  )

  it("cli/index.ts does not register .option('--all ...')", () => {
    expect(cliSource).not.toMatch(/\.option\('--all/)
  })
})

describe("CMD-02: accounts subcommand absent from CLI", () => {
  const cliSource = readFileSync(
    resolve(__dirname, '../../src/cli/index.ts'),
    'utf-8'
  )

  it("cli/index.ts does not register .command('accounts')", () => {
    expect(cliSource).not.toMatch(/\.command\('accounts'\)/)
  })
})

describe('CMD-02: account? typed opts absent from src/cli/index.ts', () => {
  const cliSource = readFileSync(
    resolve(__dirname, '../../src/cli/index.ts'),
    'utf-8'
  )

  it('cli/index.ts does not contain account?: (optional account property in TypeScript types)', () => {
    expect(cliSource).not.toMatch(/account\?:/)
  })
})
