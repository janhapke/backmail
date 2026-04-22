// src/core/config.ts — CONFIG-01, CONFIG-02, CONFIG-03
// ARCH-01: no exit calls, no console.*, no CLI imports
import * as z from 'zod'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { Entry } from '@napi-rs/keyring'

// ── Schema ────────────────────────────────────────────────────────────────────

const AccountConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  tls: z.boolean(),
  repoPath: z.string().min(1),
})

const ConfigSchema = z.object({
  accounts: z.record(
    z.string().min(1).regex(/^[a-z0-9_-]+$/i, 'Account name must be alphanumeric'),
    AccountConfigSchema
  ),
})

export type BackmailConfig = z.infer<typeof ConfigSchema>

// ── Path resolution ───────────────────────────────────────────────────────────

function getConfigDir(): string {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA ?? os.homedir(), 'backmail')
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'backmail')
    default: // linux + other unix — XDG_CONFIG_HOME aware
      return path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'),
        'backmail'
      )
  }
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json')
}

// ── repoPath normalization (D-03) ─────────────────────────────────────────────

function resolveRepoPath(repoPath: string, configDir: string): string {
  const expanded = repoPath.startsWith('~/')
    ? path.join(os.homedir(), repoPath.slice(2))
    : repoPath
  // CRITICAL: resolve against configDir, not CWD (pitfall 5 in RESEARCH.md)
  return path.resolve(configDir, expanded)
}

// ── Config loading ────────────────────────────────────────────────────────────

export function loadConfig(configPath?: string): BackmailConfig {
  const resolvedPath = configPath ?? getConfigPath()
  const configDir = path.dirname(resolvedPath)

  let raw: string
  try {
    raw = fs.readFileSync(resolvedPath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `No config found at ${resolvedPath}. Create it with your IMAP accounts — see README for format.`
      )
    }
    throw err
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Config file at ${resolvedPath} is not valid JSON.`)
  }

  const config = ConfigSchema.parse(parsed) as BackmailConfig

  // Resolve all repoPaths (D-03)
  for (const account of Object.values(config.accounts)) {
    account.repoPath = resolveRepoPath(account.repoPath, configDir)
  }

  return config
}

// ── Credential lookup (D-07, D-09) ───────────────────────────────────────────

export async function getPassword(accountName: string): Promise<string> {
  let resolvedPassword: string | null = null
  try {
    // Use Entry class (synchronous) — mocked in tests via vi.mock('@napi-rs/keyring')
    const entry = new Entry('backmail', accountName)
    const result = entry.getPassword()

    // Check if result is a Promise
    if (result && typeof (result as any).then === 'function') {
      resolvedPassword = await (result as unknown as Promise<string>)
    } else if (typeof result === 'string') {
      resolvedPassword = result
    }
    // If result is null or undefined, resolvedPassword stays null
  } catch {
    // keyring unavailable (headless Linux, no D-Bus/GNOME Keyring) — fall through
  }

  if (resolvedPassword) return resolvedPassword

  // Env var fallback (D-06): BACKMAIL_<ACCOUNT_UPPERCASED>_PASSWORD
  const envKey = `BACKMAIL_${accountName.toUpperCase()}_PASSWORD`
  const envPassword = process.env[envKey]
  if (envPassword !== undefined) return envPassword

  // No credential found — throw lazily (D-09)
  throw new Error(
    `No credential for account "${accountName}" — set ${envKey} or add to OS keyring.`
  )
}
