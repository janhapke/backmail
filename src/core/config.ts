// src/core/config.ts — CRED-01, CRED-02, CRED-03
// ARCH-01: no exit calls, no console.*, no CLI imports
import * as z from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { Entry } from '@napi-rs/keyring'

// ── Schema ────────────────────────────────────────────────────────────────────

const RepositoryConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  tls: z.boolean(),
  passwordRef: z.string().min(1),
})

export type RepositoryConfig = z.infer<typeof RepositoryConfigSchema>

// ── PasswordRef ───────────────────────────────────────────────────────────────

export interface PasswordRef {
  type: 'keyring' | 'env'
  service?: string
  account?: string
  envVar?: string
}

// ── Repository config loading ─────────────────────────────────────────────────

export function loadRepositoryConfig(repoRoot: string): RepositoryConfig {
  const configPath = path.join(repoRoot, '.backmail', 'config.json')

  let raw: string
  try {
    raw = fs.readFileSync(configPath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `No config found at ${configPath}. Run \`backmail init\` to create a repository.`
      )
    }
    throw err
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Config file at ${configPath} is not valid JSON.`)
  }

  return RepositoryConfigSchema.parse(parsed) as RepositoryConfig
}

// ── passwordRef parser (D-04, D-05) ──────────────────────────────────────────

export function parsePasswordRef(ref: string): PasswordRef {
  if (ref.startsWith('keyring:')) {
    const params = new URLSearchParams(ref.slice(8).replace(/;/g, '&'))
    const service = params.get('service')
    const account = params.get('account')
    if (!service || !account) {
      throw new Error(
        `Malformed keyring passwordRef "${ref}": must include service= and account= keys.`
      )
    }
    return { type: 'keyring', service, account }
  } else if (ref.startsWith('env:')) {
    const envVar = ref.slice(4)
    if (!envVar) {
      throw new Error(`Malformed env passwordRef "${ref}": variable name must follow "env:".`)
    }
    return { type: 'env', envVar }
  }
  const scheme = ref.split(':')[0]
  throw new Error(
    `Unsupported passwordRef scheme "${scheme}" in "${ref}". Use "keyring:" or "env:".`
  )
}

// ── Credential resolver (D-03) ────────────────────────────────────────────────

export async function getPasswordByRef(passwordRef: string): Promise<string> {
  const parsed = parsePasswordRef(passwordRef)
  let resolvedPassword: string | null = null

  if (parsed.type === 'keyring') {
    try {
      const entry = new Entry(parsed.service!, parsed.account!)
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
  } else if (parsed.type === 'env') {
    resolvedPassword = process.env[parsed.envVar!] ?? null
  }

  if (resolvedPassword) return resolvedPassword

  // D-03: top-level BACKMAIL_PASSWORD env var fallback
  const fallback = process.env.BACKMAIL_PASSWORD
  if (fallback) return fallback

  throw new Error(
    `No credential resolved for passwordRef "${passwordRef}". ` +
      `Set the BACKMAIL_PASSWORD environment variable or configure a valid passwordRef.`
  )
}
