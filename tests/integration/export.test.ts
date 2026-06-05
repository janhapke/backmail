import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { exportAccount } from '../../src/core/export.js'

// ── Fixture EML filenames (stems) ─────────────────────────────────────────────

const FIXTURES_DIR = path.join(import.meta.dirname, '../fixtures/export')

const FOLDER_A_FILES = [
  '2026-01-15_html-only_aabbccdd',
  '2026-01-15_plaintext_bbccddee',
  '2026-01-15_multipart_ccddeeff',
]

const FOLDER_B_FILES = [
  '2026-01-15_attachment_ddeeffgg',
  '2026-01-15_multircpt_eeffgghh',
]

const FIXTURE_MAP: Record<string, string> = {
  '2026-01-15_html-only_aabbccdd': 'html-only.eml',
  '2026-01-15_plaintext_bbccddee': 'plaintext-only.eml',
  '2026-01-15_multipart_ccddeeff': 'multipart.eml',
  '2026-01-15_attachment_ddeeffgg': 'pure-attachment.eml',
  '2026-01-15_multircpt_eeffgghh': 'multi-recipient.eml',
}

function makeState(filenames: string[]) {
  return JSON.stringify({
    uidvalidity: '1',
    uidnext: filenames.length + 1,
    messages: filenames.map((f, i) => ({
      uid: i + 1,
      'message-id': `<${f}@test>`,
      filename: f,
      flags: [],
    })),
  })
}

// ── Setup/teardown ────────────────────────────────────────────────────────────

let tmpDir: string
let archivePath: string
let exportPath: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'backmail-export-integration-'))
  archivePath = path.join(tmpDir, 'archive')
  exportPath = path.join(tmpDir, 'export')

  // Create FolderA and FolderB under archive
  for (const [folder, files] of [['FolderA', FOLDER_A_FILES], ['FolderB', FOLDER_B_FILES]] as const) {
    const folderDir = path.join(archivePath, folder)
    await fs.mkdir(folderDir, { recursive: true })
    await fs.writeFile(path.join(folderDir, '.backmail_state.json'), makeState(files))
    for (const stem of files) {
      const fixtureName = FIXTURE_MAP[stem]
      const src = path.join(FIXTURES_DIR, fixtureName)
      await fs.copyFile(src, path.join(folderDir, `${stem}.eml`))
    }
  }
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('exportAccount integration', () => {
  it('exports all folders and mirrors archive directory structure', async () => {
    const result = await exportAccount(archivePath, exportPath, {})
    expect(result.errors).toBe(0)
    expect(result.exported).toBe(FOLDER_A_FILES.length + FOLDER_B_FILES.length)

    // Check directory structure
    for (const folder of ['FolderA', 'FolderB']) {
      const stat = await fs.stat(path.join(exportPath, folder))
      expect(stat.isDirectory()).toBe(true)
    }
  })

  it('produces one .md per .eml (file counts match)', async () => {
    // Count .eml files under archivePath
    let emlCount = 0
    for (const folder of ['FolderA', 'FolderB']) {
      const entries = await fs.readdir(path.join(archivePath, folder))
      emlCount += entries.filter((e) => e.endsWith('.eml')).length
    }

    // Count .md files under exportPath
    let mdCount = 0
    for (const folder of ['FolderA', 'FolderB']) {
      const entries = await fs.readdir(path.join(exportPath, folder))
      mdCount += entries.filter((e) => e.endsWith('.md')).length
    }

    expect(mdCount).toBe(emlCount)
  })

  it('is idempotent: running twice produces identical output', async () => {
    // Read current content
    const readAll = async () => {
      const contents: Record<string, string> = {}
      for (const folder of ['FolderA', 'FolderB']) {
        const dir = path.join(exportPath, folder)
        const entries = await fs.readdir(dir)
        for (const f of entries.filter((e) => e.endsWith('.md'))) {
          contents[`${folder}/${f}`] = await fs.readFile(path.join(dir, f), 'utf-8')
        }
      }
      return contents
    }

    const before = await readAll()
    await exportAccount(archivePath, exportPath, {})
    const after = await readAll()

    expect(after).toEqual(before)
  })

  it('--only-folder: only specified folder is in output', async () => {
    const onlyExportPath = path.join(tmpDir, 'export-only')
    await exportAccount(archivePath, onlyExportPath, { onlyFolders: ['FolderA'] })

    const entries = await fs.readdir(onlyExportPath)
    expect(entries).toContain('FolderA')
    expect(entries).not.toContain('FolderB')
  })

  it('--exclude-folder: excluded folder is absent from output', async () => {
    const excExportPath = path.join(tmpDir, 'export-exclude')
    await exportAccount(archivePath, excExportPath, { excludeFolders: ['FolderA'] })

    const entries = await fs.readdir(excExportPath)
    expect(entries).not.toContain('FolderA')
    expect(entries).toContain('FolderB')
  })
})
