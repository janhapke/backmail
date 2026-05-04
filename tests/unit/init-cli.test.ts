/**
 * REPO-05: backmail init errors immediately if any required flag is missing
 * when stdin is not a TTY (non-interactive mode).
 *
 * Approach: spawn the CLI as a child process with piped stdin (input: '').
 * Piped stdin sets process.stdin.isTTY = undefined → undefined === true is false
 * → implementation takes the non-TTY error path.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import fs from 'node:fs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(__dirname, '../..')
const cliPath = resolve(repoRoot, 'src/cli/index.ts')

/**
 * Run the CLI in non-TTY mode (piped stdin) and return the result.
 * `input: ''` forces isTTY to be undefined (not a real TTY).
 */
function runCliNonTTY(args: string[]): { status: number | null; stderr: string; stdout: string } {
  const result = spawnSync('npx', ['tsx', cliPath, ...args], {
    input: '',
    encoding: 'utf-8',
    cwd: repoRoot,
    timeout: 15_000,
  })
  return {
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

describe('REPO-05: init command non-TTY mode — errors on missing required flags', () => {
  it('exits 1 with --host error when no flags are provided in non-TTY mode', () => {
    const tmpDir = fs.mkdtempSync(resolve(os.tmpdir(), 'backmail-init-cli-test-'))
    try {
      const result = runCliNonTTY(['init', tmpDir])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Error: --host is required in non-TTY mode')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('exits 1 with --password error when host/port/username are provided but password is missing in non-TTY mode', () => {
    const tmpDir = fs.mkdtempSync(resolve(os.tmpdir(), 'backmail-init-cli-test-'))
    try {
      const result = runCliNonTTY([
        'init', tmpDir,
        '--host', 'imap.example.com',
        '--port', '993',
        '--username', 'user@example.com',
      ])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Error: --password or --password-ref is required in non-TTY mode')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('does not emit a non-TTY error when all required flags are provided via --password-ref', () => {
    const tmpDir = fs.mkdtempSync(resolve(os.tmpdir(), 'backmail-init-cli-test-'))
    try {
      const result = runCliNonTTY([
        'init', tmpDir,
        '--host', 'imap.example.com',
        '--port', '993',
        '--username', 'user@example.com',
        '--tls',
        '--password-ref', 'env:BACKMAIL_PASSWORD',
      ])
      // Should NOT complain about missing flags — it may fail for other reasons (keyring, git, etc.)
      // but must not output any "required in non-TTY mode" error.
      expect(result.stderr).not.toContain('required in non-TTY mode')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
