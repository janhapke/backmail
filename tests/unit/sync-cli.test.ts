import { describe, it, expect } from 'vitest'
import { filterFolders } from '../../src/core/sync.js'

describe('D-02 + D-03: folder filter semantics', () => {
  const mkFolder = (path: string, flags: string[] = []) => ({
    path, delimiter: '/', flags: new Set(flags),
  })

  it('throws on both onlyFolders and excludeFolders non-empty (mutual exclusion)', () => {
    expect(() => filterFolders(
      [mkFolder('INBOX')],
      ['INBOX'],
      ['Spam'],
    )).toThrow(/mutually exclusive/)
  })

  it('onlyFolders leaf-name match: "Sent Mail" matches "[Gmail]/Sent Mail"', () => {
    const folders = [
      mkFolder('[Gmail]/Sent Mail'),
      mkFolder('INBOX'),
    ]
    const result = filterFolders(folders, ['Sent Mail'], [])
    expect(result.map(f => f.path)).toEqual(['[Gmail]/Sent Mail'])
  })

  it('onlyFolders full-path match: "[Gmail]/Sent Mail" matches exactly', () => {
    const folders = [
      mkFolder('[Gmail]/Sent Mail'),
      mkFolder('INBOX'),
    ]
    const result = filterFolders(folders, ['[Gmail]/Sent Mail'], [])
    expect(result.map(f => f.path)).toEqual(['[Gmail]/Sent Mail'])
  })

  it('excludeFolders drops matching leaf', () => {
    const folders = [
      mkFolder('INBOX'),
      mkFolder('INBOX/Trash'),
    ]
    const result = filterFolders(folders, [], ['Trash'])
    expect(result.map(f => f.path)).toEqual(['INBOX'])
  })

  it('\\Noselect folders are always dropped', () => {
    const folders = [
      mkFolder('[Gmail]', ['\\Noselect']),
      mkFolder('INBOX'),
    ]
    const result = filterFolders(folders, [], [])
    expect(result.map(f => f.path)).toEqual(['INBOX'])
  })

  it('empty filters: passes all non-Noselect folders through', () => {
    const folders = [
      mkFolder('INBOX'),
      mkFolder('Sent'),
      mkFolder('[Gmail]', ['\\Noselect']),
    ]
    const result = filterFolders(folders, [], [])
    expect(result.map(f => f.path).sort()).toEqual(['INBOX', 'Sent'])
  })
})
