import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

describe('ARCH-02: cli/core module boundary enforcement', () => {
  it('src/core/index.ts does not import from src/cli/', () => {
    const coreSource = readFileSync(
      resolve(__dirname, '../../src/core/index.ts'),
      'utf-8'
    )
    // Core must never import from cli — this breaks the eimerjs IPC boundary
    expect(coreSource).not.toMatch(/from ['"]\.\.\/cli\//)
    expect(coreSource).not.toMatch(/from ['"].*\/cli\//)
    expect(coreSource).not.toMatch(/require\(.*cli/)
  })

  it('src/core/index.ts does not call process.exit()', () => {
    const coreSource = readFileSync(
      resolve(__dirname, '../../src/core/index.ts'),
      'utf-8'
    )
    expect(coreSource).not.toMatch(/process\.exit/)
  })

  it('src/core/index.ts does not call console methods', () => {
    const coreSource = readFileSync(
      resolve(__dirname, '../../src/core/index.ts'),
      'utf-8'
    )
    expect(coreSource).not.toMatch(/console\.(log|error|warn|info|debug)/)
  })

  it('src/cli/index.ts does not import from paths that bypass core boundary', () => {
    const cliSource = readFileSync(
      resolve(__dirname, '../../src/cli/index.ts'),
      'utf-8'
    )
    // CLI must not have circular imports back into itself
    expect(cliSource).not.toMatch(/from ['"]\.\.\/cli\//)
  })
})

describe('ARCH-01: src/core/config.ts module boundary enforcement', () => {
  it('src/core/config.ts does not import from src/cli/', () => {
    const configSource = readFileSync(
      resolve(__dirname, '../../src/core/config.ts'),
      'utf-8'
    )
    expect(configSource).not.toMatch(/from ['"]\.\.\/cli\//)
    expect(configSource).not.toMatch(/from ['"].*\/cli\//)
    expect(configSource).not.toMatch(/require\(.*cli/)
  })

  it('src/core/config.ts does not call process.exit()', () => {
    const configSource = readFileSync(
      resolve(__dirname, '../../src/core/config.ts'),
      'utf-8'
    )
    expect(configSource).not.toMatch(/process\.exit/)
  })

  it('src/core/config.ts does not call console methods', () => {
    const configSource = readFileSync(
      resolve(__dirname, '../../src/core/config.ts'),
      'utf-8'
    )
    expect(configSource).not.toMatch(/console\.(log|error|warn|info|debug)/)
  })

  it('src/core/config.ts does not import from the archived keytar package', () => {
    const configSource = readFileSync(
      resolve(__dirname, '../../src/core/config.ts'),
      'utf-8'
    )
    // Must use @napi-rs/keyring (the maintained replacement), never the archived keytar
    expect(configSource).not.toMatch(/from ['"]keytar['"]/)
    expect(configSource).not.toMatch(/require\(['"]keytar['"]\)/)
  })
})
