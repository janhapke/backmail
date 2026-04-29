import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { findRepository } from '../../src/core/discovery.js'

describe('findRepository', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-disc-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns startDir when .backmail/ exists directly in it', () => {
    fs.mkdirSync(path.join(tmpDir, '.backmail'))
    const result = findRepository(tmpDir)
    expect(result).toBe(tmpDir)
  })

  it('returns null when .backmail/ not found anywhere in walk', () => {
    // tmpDir has no .backmail — walk up to / and return null
    const result = findRepository(tmpDir)
    expect(result).toBeNull()
  })

  it('finds .backmail/ in direct parent directory', () => {
    fs.mkdirSync(path.join(tmpDir, '.backmail'))
    const child = path.join(tmpDir, 'child')
    fs.mkdirSync(child)
    expect(findRepository(child)).toBe(tmpDir)
  })

  it('finds .backmail/ three levels up', () => {
    fs.mkdirSync(path.join(tmpDir, '.backmail'))
    const deep = path.join(tmpDir, 'a', 'b', 'c')
    fs.mkdirSync(deep, { recursive: true })
    expect(findRepository(deep)).toBe(tmpDir)
  })

  it('returns null when walking all the way to filesystem root', () => {
    // No .backmail anywhere — should reach / and return null without throwing
    expect(() => findRepository(tmpDir)).not.toThrow()
    expect(findRepository(tmpDir)).toBeNull()
  })

  it('returns closest (innermost) .backmail/ when nested repos exist', () => {
    // Outer: tmpDir/.backmail/
    fs.mkdirSync(path.join(tmpDir, '.backmail'))
    // Inner: tmpDir/inner/.backmail/
    const inner = path.join(tmpDir, 'inner')
    fs.mkdirSync(inner)
    fs.mkdirSync(path.join(inner, '.backmail'))
    // Start from inner — should return inner, not tmpDir
    expect(findRepository(inner)).toBe(inner)
  })
})
