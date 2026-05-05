// src/core/discovery.ts — no exit calls, no console, no CLI imports.
// Walk up filesystem to find .backmail/ directory marker.
import fs from 'node:fs'
import path from 'node:path'

/**
 * Walk up from startDir looking for a .backmail/ directory.
 * Returns the repository root path (the directory that contains .backmail/)
 * or null if not found before reaching the filesystem root.
 *
 * Pure function — no side effects, no I/O other than fs.existsSync.
 * Stops at filesystem root (path.parse(p).root).
 * Detection criterion: .backmail/ directory presence.
 */
export function findRepository(startDir: string): string | null {
  let current = path.resolve(startDir)
  const root = path.parse(current).root

  while (true) {
    if (fs.existsSync(path.join(current, '.backmail'))) {
      return current
    }
    if (current === root) {
      return null
    }
    current = path.dirname(current)
  }
}
