// src/core/init.ts — no exit calls, no console, no CLI imports.
import fs from 'node:fs'
import path from 'node:path'
import { simpleGit } from 'simple-git'
import type { RepositoryConfig } from './config.js'

export async function initRepository(
  targetDir: string,
  config: RepositoryConfig,
  passwordRef: string,
): Promise<void> {
  const backmailDir = path.join(targetDir, '.backmail')

  // Non-destructive guard — .backmail/ presence is the repo marker
  if (fs.existsSync(backmailDir)) {
    throw new Error(
      `Repository already exists at ${targetDir}. Remove .backmail/ to reinitialize.`,
    )
  }

  const archivePath = path.join(targetDir, 'archive')
  const worktreesPath = path.join(targetDir, 'worktrees')

  // Create archive/ and worktrees/ BEFORE .backmail/ so that if git init fails,
  // .backmail/ is never created, so the user can safely re-run init.
  fs.mkdirSync(archivePath, { recursive: true })
  fs.mkdirSync(worktreesPath, { recursive: true })

  // Initialize the git repo at archive/ — must succeed before writing the .backmail/ marker
  await simpleGit(archivePath).init()

  // Create .backmail/ and write files last — their presence marks the repo as initialized
  fs.mkdirSync(backmailDir, { recursive: true })
  fs.writeFileSync(path.join(backmailDir, 'log'), '')
  fs.writeFileSync(
    path.join(backmailDir, 'config.json'),
    JSON.stringify({ ...config, passwordRef }, null, 2),
  )
}
