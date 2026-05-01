import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'

describe('CLI: Repository Discovery (DISC-01, DISC-02, DISC-03)', () => {
  let tmpDir: string
  let repoRoot: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-cli-disc-'))
    repoRoot = path.join(tmpDir, 'repo')
    fs.mkdirSync(repoRoot)
    fs.mkdirSync(path.join(repoRoot, '.backmail'))
    // Create minimal config for non-discovery errors
    fs.writeFileSync(
      path.join(repoRoot, '.backmail', 'config.json'),
      JSON.stringify({
        host: 'localhost',
        port: 993,
        username: 'test',
        tls: true,
        passwordRef: 'env:BACKMAIL_PASSWORD',
      })
    )
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('DISC-03: prints exact error message and exits 1 when not in repo', () => {
    // Run from a directory with no .backmail anywhere
    const noRepoDir = path.join(tmpDir, 'no-repo')
    fs.mkdirSync(noRepoDir)

    // Use absolute path to CLI
    const cliPath = path.resolve('/home/jan/dev/backmail/src/cli/index.ts')

    const result = spawnSync('npx', ['tsx', cliPath, 'log'], {
      cwd: noRepoDir,
      encoding: 'utf-8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Error: Not inside a backmail repository.')
    expect(result.stderr).toContain('Use `backmail init` to create one, or `--workdir <path>` to specify a path.')
  })

  it('DISC-02: --workdir flag targets specified repo regardless of CWD', () => {
    // Run from a different directory (not the repo), but use --workdir
    const otherDir = path.join(tmpDir, 'other')
    fs.mkdirSync(otherDir)

    const cliPath = path.resolve('/home/jan/dev/backmail/src/cli/index.ts')

    const result = spawnSync('npx', ['tsx', cliPath, '--workdir', repoRoot, 'log'], {
      cwd: otherDir,
      encoding: 'utf-8',
      env: { ...process.env, BACKMAIL_PASSWORD: 'test' },
    })

    // Should not fail with discovery error (may fail with git/archive error instead)
    expect(result.stderr).not.toContain('Error: Not inside a backmail repository.')
    // The error should be about archive not existing or git not being initialized
    // We're checking that discovery succeeded and failed on a different layer
  })

  it('DISC-01: auto-detects repo from CWD when in repo directory', () => {
    // Run from inside the repo directory
    const cliPath = path.resolve('/home/jan/dev/backmail/src/cli/index.ts')
    const result = spawnSync('npx', ['tsx', cliPath, 'log'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      env: { ...process.env, BACKMAIL_PASSWORD: 'test' },
    })

    // Should not fail with discovery error
    expect(result.stderr).not.toContain('Error: Not inside a backmail repository.')
  })

  it('DISC-01: auto-detects repo from CWD when in descendant directory of repo', () => {
    // Create a nested directory inside the repo
    const nestedDir = path.join(repoRoot, 'subdir', 'nested')
    fs.mkdirSync(nestedDir, { recursive: true })

    // Run from nested directory
    const cliPath = path.resolve('/home/jan/dev/backmail/src/cli/index.ts')
    const result = spawnSync('npx', ['tsx', cliPath, 'log'], {
      cwd: nestedDir,
      encoding: 'utf-8',
      env: { ...process.env, BACKMAIL_PASSWORD: 'test' },
    })

    // Should not fail with discovery error
    expect(result.stderr).not.toContain('Error: Not inside a backmail repository.')
  })

  it('DISC-02: --workdir with relative path is resolved against CWD', () => {
    // Run with relative --workdir
    const otherDir = path.join(tmpDir, 'other')
    fs.mkdirSync(otherDir)

    // Calculate relative path from otherDir to repoRoot
    const relativePath = path.relative(otherDir, repoRoot)

    const cliPath = path.resolve('/home/jan/dev/backmail/src/cli/index.ts')
    const result = spawnSync('npx', ['tsx', cliPath, '--workdir', relativePath, 'log'], {
      cwd: otherDir,
      encoding: 'utf-8',
      env: { ...process.env, BACKMAIL_PASSWORD: 'test' },
    })

    // Should not fail with discovery error (relative path resolved correctly)
    expect(result.stderr).not.toContain('Error: Not inside a backmail repository.')
  })

  it('DISC-02: --workdir with nonexistent path prints error and exits 1', () => {
    const cliPath = path.resolve('/home/jan/dev/backmail/src/cli/index.ts')
    const result = spawnSync('npx', ['tsx', cliPath, '--workdir', '/tmp/nonexistent-backmail-repo', 'log'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Error: Not inside a backmail repository.')
    expect(result.stderr).toContain('Use `backmail init` to create one, or `--workdir <path>` to specify a path.')
  })

  it('DISC-03: error message contains exact expected text (no CWD path)', () => {
    const noRepoDir = path.join(tmpDir, 'isolated')
    fs.mkdirSync(noRepoDir)

    const cliPath = path.resolve('/home/jan/dev/backmail/src/cli/index.ts')
    const result = spawnSync('npx', ['tsx', cliPath, 'log'], {
      cwd: noRepoDir,
      encoding: 'utf-8',
    })

    // Check exact two-line message
    const expectedMessage = 'Error: Not inside a backmail repository.\nUse `backmail init` to create one, or `--workdir <path>` to specify a path.'
    expect(result.stderr).toContain(expectedMessage)

    // Verify no CWD path is included
    expect(result.stderr).not.toContain(noRepoDir)
  })
})
