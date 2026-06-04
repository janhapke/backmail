import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { simpleParser } from 'mailparser'
import {
  preprocessHtml,
  htmlToMarkdown,
  extractReceivedDate,
  buildFrontmatter,
  assembleDocument,
  exportFolder,
  exportAccount,
} from '../../src/core/export.js'

// ── preprocessHtml ────────────────────────────────────────────────────────────

describe('preprocessHtml', () => {
  it('strips <style> blocks', () => {
    const html = '<style>body { color: red; }</style><p>Hello</p>'
    expect(preprocessHtml(html)).not.toContain('<style>')
    expect(preprocessHtml(html)).toContain('<p>Hello</p>')
  })

  it('strips <script> blocks', () => {
    const html = '<script>alert(1)</script><p>Text</p>'
    expect(preprocessHtml(html)).not.toContain('<script>')
    expect(preprocessHtml(html)).toContain('<p>Text</p>')
  })

  it('strips 1x1 tracking pixel img (width=1 height=1 attrs)', () => {
    const html = '<img src="track.png" width="1" height="1"><p>Text</p>'
    expect(preprocessHtml(html)).not.toContain('<img')
    expect(preprocessHtml(html)).toContain('<p>Text</p>')
  })

  it('strips img with width=0 attribute', () => {
    const html = '<img src="t.gif" width="0"><p>Text</p>'
    expect(preprocessHtml(html)).not.toContain('<img')
  })

  it('strips img with style width:0', () => {
    const html = '<img src="t.gif" style="width:0;height:0"><p>Text</p>'
    expect(preprocessHtml(html)).not.toContain('<img')
  })

  it('preserves normal images', () => {
    const html = '<img src="photo.jpg" width="800" height="600"><p>Text</p>'
    expect(preprocessHtml(html)).toContain('<img')
  })
})

// ── htmlToMarkdown ────────────────────────────────────────────────────────────

describe('htmlToMarkdown', () => {
  it('converts basic HTML to markdown', () => {
    const result = htmlToMarkdown('<p><strong>Hello</strong> world</p>')
    expect(result).toContain('**Hello**')
  })

  it('collapses 4+ consecutive blank lines to 2', () => {
    // Force 4+ blank lines by injecting them after conversion
    // We test by passing content that will produce multiple blank lines
    const html = '<p>A</p><p></p><p></p><p></p><p>B</p>'
    const result = htmlToMarkdown(html)
    expect(result).not.toMatch(/\n{4,}/)
  })
})

// ── extractReceivedDate ───────────────────────────────────────────────────────

describe('extractReceivedDate', () => {
  it('prefers Received: header timestamp after semicolon', () => {
    const raw = 'Received: from mail.example.com by server; Thu, 15 Jan 2026 13:37:42 +0000\r\nDate: Mon, 1 Jan 2024 00:00:00 +0000\r\n\r\nBody'
    expect(extractReceivedDate(raw)).toBe('2026-01-15 13:37:42')
  })

  it('falls back to Date: header when Received: is absent', () => {
    const raw = 'Date: Wed, 15 Jan 2025 10:20:30 +0000\r\n\r\nBody'
    expect(extractReceivedDate(raw)).toBe('2025-01-15 10:20:30')
  })

  it('falls back to 0000-00-00 00:00:00 when no date headers', () => {
    const raw = 'From: foo@example.com\r\n\r\nBody'
    expect(extractReceivedDate(raw)).toBe('0000-00-00 00:00:00')
  })
})

// ── buildFrontmatter ──────────────────────────────────────────────────────────

describe('buildFrontmatter', () => {
  it('produces correct frontmatter for a basic email', async () => {
    const eml = [
      'From: Jane Doe <jane@example.com>',
      'To: John Doe <john@example.com>',
      'Subject: Hello World',
      'Message-ID: <abc123@example.com>',
      'Date: Thu, 15 Jan 2026 13:37:42 +0000',
      '',
      'Body text',
    ].join('\r\n')
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX')
    expect(fm).toContain('messageId:')
    expect(fm).toContain('subject: "Hello World"')
    expect(fm).toContain('name: "Jane Doe"')
    expect(fm).toContain('email: "jane@example.com"')
    expect(fm).toContain('- "INBOX"')
  })

  it('produces to: [] when To header is absent', async () => {
    const eml = 'From: foo@example.com\r\nSubject: Test\r\n\r\nBody'
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX')
    expect(fm).toContain('to: []')
  })

  it('produces YAML list when multiple To recipients', async () => {
    const eml = [
      'From: sender@example.com',
      'To: Alice <alice@example.com>, Bob <bob@example.com>',
      'Subject: Multi',
      '',
      'Body',
    ].join('\r\n')
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX')
    expect(fm).toContain('email: "alice@example.com"')
    expect(fm).toContain('email: "bob@example.com"')
  })

  it('sets subject to empty string when missing', async () => {
    const eml = 'From: foo@example.com\r\n\r\nBody'
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX')
    expect(fm).toContain('subject: ""')
  })

  it('sets from name to empty string when not present', async () => {
    const eml = 'From: foo@example.com\r\nSubject: Test\r\n\r\nBody'
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX')
    expect(fm).toContain('name: ""')
  })

  it('lists attachments with filename, contentType, size', async () => {
    const boundary = 'abc123boundary'
    const eml = [
      'From: foo@example.com',
      'Subject: With Attachment',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain',
      '',
      'Body',
      `--${boundary}`,
      'Content-Type: application/pdf',
      'Content-Disposition: attachment; filename="report.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'AAAA',
      `--${boundary}--`,
    ].join('\r\n')
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX')
    expect(fm).toContain('filename: "report.pdf"')
    expect(fm).toContain('contentType: "application/pdf"')
    expect(fm).toContain('size:')
  })

  it('sets attachments: [] when no attachments', async () => {
    const eml = 'From: foo@example.com\r\nSubject: Test\r\n\r\nBody'
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX')
    expect(fm).toContain('attachments: []')
  })
})

// ── assembleDocument ──────────────────────────────────────────────────────────

describe('assembleDocument', () => {
  it('HTML-only: body is markdown, no divider', async () => {
    const eml = [
      'From: foo@example.com',
      'Subject: HTML Only',
      'Content-Type: text/html',
      '',
      '<p><strong>Hello</strong></p>',
    ].join('\r\n')
    const parsed = await simpleParser(Buffer.from(eml))
    const doc = assembleDocument(parsed, Buffer.from(eml), 'INBOX')
    expect(doc).toContain('**Hello**')
    expect(doc).not.toContain('\n\n---\n\n---\n\n---\n\n')
  })

  it('plain-text-only: body is plain text, no conversion', async () => {
    const eml = 'From: foo@example.com\r\nSubject: Text\r\n\r\nHello plain world'
    const parsed = await simpleParser(Buffer.from(eml))
    const doc = assembleDocument(parsed, Buffer.from(eml), 'INBOX')
    expect(doc).toContain('Hello plain world')
  })

  it('HTML + plain text: three-divider block present', async () => {
    const boundary = 'div123'
    const eml = [
      'From: foo@example.com',
      'Subject: Both',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain',
      '',
      'Plain text here',
      `--${boundary}`,
      'Content-Type: text/html',
      '',
      '<p>HTML here</p>',
      `--${boundary}--`,
    ].join('\r\n')
    const parsed = await simpleParser(Buffer.from(eml))
    const doc = assembleDocument(parsed, Buffer.from(eml), 'INBOX')
    expect(doc).toContain('\n\n---\n\n---\n\n---\n\n')
    expect(doc).toContain('HTML here')
    expect(doc).toContain('Plain text here')
  })

  it('pure-attachment: only frontmatter, no body content', async () => {
    const boundary = 'att123'
    const eml = [
      'From: foo@example.com',
      'Subject: Attachment Only',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: application/pdf',
      'Content-Disposition: attachment; filename="doc.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'AAAA',
      `--${boundary}--`,
    ].join('\r\n')
    const parsed = await simpleParser(Buffer.from(eml))
    const doc = assembleDocument(parsed, Buffer.from(eml), 'INBOX')
    // Should end with --- (closing frontmatter delimiter) and newline, nothing else
    const afterFm = doc.replace(/^---[\s\S]*?---\n/, '')
    expect(afterFm.trim()).toBe('')
  })
})

// ── exportFolder / exportAccount (I/O) ────────────────────────────────────────

const SIMPLE_EML = 'From: foo@example.com\r\nSubject: Test\r\n\r\nHello world'

function makeState(messages: { filename: string }[]) {
  return JSON.stringify({
    uidvalidity: '1',
    uidnext: messages.length + 1,
    messages: messages.map((m, i) => ({
      uid: i + 1,
      'message-id': `<${m.filename}@test>`,
      filename: m.filename,
      flags: [],
    })),
  })
}

describe('exportFolder', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-export-'))
  })

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  it('writes .md at correct path for a single message', async () => {
    const archivePath = path.join(tmpDir, 'archive')
    const exportPath = path.join(tmpDir, 'export')
    const folderDir = path.join(archivePath, 'INBOX')
    await fsp.mkdir(folderDir, { recursive: true })
    await fsp.writeFile(path.join(folderDir, '.backmail_state.json'), makeState([{ filename: '2026-01-01_test_abc12345' }]))
    await fsp.writeFile(path.join(folderDir, '2026-01-01_test_abc12345.eml'), SIMPLE_EML)

    const result = await exportFolder(archivePath, exportPath, 'INBOX', {})
    expect(result.exported).toBe(1)
    expect(result.error).toBeUndefined()

    const mdPath = path.join(exportPath, 'INBOX', '2026-01-01_test_abc12345.md')
    const content = await fsp.readFile(mdPath, 'utf-8')
    expect(content).toContain('messageId:')
  })

  it('counts error and continues when .eml is missing', async () => {
    const archivePath = path.join(tmpDir, 'archive')
    const exportPath = path.join(tmpDir, 'export')
    const folderDir = path.join(archivePath, 'INBOX')
    await fsp.mkdir(folderDir, { recursive: true })
    await fsp.writeFile(
      path.join(folderDir, '.backmail_state.json'),
      makeState([{ filename: 'missing_file' }, { filename: '2026-01-01_ok_abc12345' }]),
    )
    // Only write the second eml
    await fsp.writeFile(path.join(folderDir, '2026-01-01_ok_abc12345.eml'), SIMPLE_EML)

    const logs: string[] = []
    const result = await exportFolder(archivePath, exportPath, 'INBOX', { onLog: (m) => logs.push(m) })
    expect(result.exported).toBe(1)
    expect(logs.some((l) => l.includes('missing_file'))).toBe(true)
  })
})

describe('exportAccount', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backmail-exportacc-'))
  })

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  })

  it('exports two folders and sums counts correctly', async () => {
    const archivePath = path.join(tmpDir, 'archive')
    const exportPath = path.join(tmpDir, 'export')

    for (const folder of ['INBOX', 'Sent']) {
      const folderDir = path.join(archivePath, folder)
      await fsp.mkdir(folderDir, { recursive: true })
      await fsp.writeFile(
        path.join(folderDir, '.backmail_state.json'),
        makeState([{ filename: `2026-01-01_msg_${folder.toLowerCase()}` }]),
      )
      await fsp.writeFile(
        path.join(folderDir, `2026-01-01_msg_${folder.toLowerCase()}.eml`),
        SIMPLE_EML,
      )
    }

    const result = await exportAccount(archivePath, exportPath, {})
    expect(result.exported).toBe(2)
    expect(result.errors).toBe(0)
    expect(result.folderResults).toHaveLength(2)
  })
})
