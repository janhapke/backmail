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
  convertPlainText,
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

  it('strips external images (logos, layout, tracking pixels)', () => {
    const html = '<img src="https://example.com/logo.png"><img src="track.gif" width="1" height="1"><p>Text</p>'
    const result = preprocessHtml(html)
    expect(result).not.toContain('<img')
    expect(result).toContain('<p>Text</p>')
  })

  it('preserves inline attachment images (cid: src)', () => {
    const html = '<img src="cid:image001@example.com"><p>Text</p>'
    const result = preprocessHtml(html)
    expect(result).toContain('<img')
    expect(result).toContain('cid:image001@example.com')
  })

  it('strips soft hyphens and zero-width spaces used as email spacers', () => {
    const html = '<td>­</td><td>Text</td><td>​</td>'
    const result = preprocessHtml(html)
    expect(result).not.toContain('­')
    expect(result).not.toContain('​')
    expect(result).toContain('Text')
  })

  it('strips combining grapheme joiner (U+034F) used in preheader padding', () => {
    const html = '<p>Preview text͏͏͏͏͏</p><p>Body</p>'
    const result = preprocessHtml(html)
    expect(result).not.toContain('͏')
    expect(result).toContain('Preview text')
  })
})

// ── htmlToMarkdown ────────────────────────────────────────────────────────────

describe('htmlToMarkdown', () => {
  it('converts basic HTML to markdown', () => {
    const result = htmlToMarkdown('<p><strong>Hello</strong> world</p>')
    expect(result).toContain('**Hello**')
  })

  it('replaces non-breaking spaces with regular spaces', () => {
    const result = htmlToMarkdown('<p>Hello World</p>')
    expect(result).not.toContain(' ')
    expect(result).toContain('Hello World')
  })

  it('strips entity-encoded invisible chars and figure spaces that survive preprocessHtml', () => {
    // &#8199; = U+2007 figure space, &#847; = U+034F CGJ, &shy; = U+00AD soft hyphen
    const html = '<div>&#8199;&#847; &#8199;&#847; &shy; &shy;</div><p>Body</p>'
    const result = htmlToMarkdown(html)
    expect(result).not.toContain('\u2007')
    expect(result).not.toContain('\u034f')
    // The padding div should collapse to nothing, leaving only the body
    expect(result.trim()).toBe('Body')
  })

  it('trims trailing whitespace from lines', () => {
    const result = htmlToMarkdown('<p>Hello   </p><p>World</p>')
    expect(result).not.toMatch(/[ \t]+\n/)
    expect(result).not.toMatch(/[ \t]+$/)
  })

  it('collapses 3+ consecutive newlines to 2', () => {
    const html = '<p>A</p><p></p><p></p><p></p><p>B</p>'
    const result = htmlToMarkdown(html)
    expect(result).not.toMatch(/\n{3,}/)
  })

  it('converts escaped visual bullets with leading spaces to real list items', () => {
    // &nbsp;&nbsp;&nbsp;* text is a common email pattern for visual lists
    const html = '<p>&nbsp;&nbsp;&nbsp;&nbsp;* Item one<br>&nbsp;&nbsp;&nbsp;&nbsp;* Item two</p>'
    const result = htmlToMarkdown(html)
    expect(result).not.toContain('\\*')
    expect(result).toContain('- Item one')
    expect(result).toContain('- Item two')
  })

  it('does not convert \\* in the middle of a line', () => {
    // Only line-leading escaped bullets should become list items
    const html = '<p>Price is 5 \\* 3 = 15</p>'
    const result = htmlToMarkdown(html)
    expect(result).toContain('5')
    expect(result).toContain('3')
  })

  it('removes links with empty text (remnants of stripped images inside <a>)', () => {
    const html = '<p>Before</p><a href="https://track.example.com/click"><img src="logo.png"></a><p>After</p>'
    const result = htmlToMarkdown(html)
    expect(result).not.toMatch(/\[\s*\]\(/)
    expect(result).toContain('Before')
    expect(result).toContain('After')
  })

  it('collapses 4+ consecutive blank lines to 2', () => {
    // Force 4+ blank lines by injecting them after conversion
    // We test by passing content that will produce multiple blank lines
    const html = '<p>A</p><p></p><p></p><p></p><p>B</p>'
    const result = htmlToMarkdown(html)
    expect(result).not.toMatch(/\n{4,}/)
  })

  describe('table handling', () => {
    it('unwraps a layout table (no <th>) to prose — no pipe characters', () => {
      const html = `<table>
        <tr><td>Hello</td><td>World</td></tr>
        <tr><td>Foo</td><td>Bar</td></tr>
      </table>`
      const result = htmlToMarkdown(html)
      expect(result).not.toContain('|')
      expect(result).toContain('Hello')
      expect(result).toContain('World')
    })

    it('unwraps a table with role="presentation" even if it has <th>', () => {
      const html = `<table role="presentation">
        <tr><th>Name</th><th>Value</th></tr>
        <tr><td>foo</td><td>bar</td></tr>
      </table>`
      const result = htmlToMarkdown(html)
      expect(result).not.toContain('|')
      expect(result).toContain('Name')
      expect(result).toContain('foo')
    })

    it('preserves a data table (first row all <th>) as a pipe table', () => {
      const html = `<table>
        <tr><th>Name</th><th>Value</th></tr>
        <tr><td>foo</td><td>bar</td></tr>
      </table>`
      const result = htmlToMarkdown(html)
      expect(result).toContain('| Name | Value |')
      expect(result).toContain('| foo | bar |')
      expect(result).toContain('---')
    })

    it('preserves inline formatting inside layout table cells', () => {
      const html = `<table>
        <tr><td><strong>Bold</strong> and <a href="/x">link</a></td></tr>
      </table>`
      const result = htmlToMarkdown(html)
      expect(result).toContain('**Bold**')
      expect(result).toContain('[link](/x)')
    })

    it('unwraps nested layout tables', () => {
      const html = `<table>
        <tr><td>
          <table><tr><td>Inner</td></tr></table>
        </td></tr>
      </table>`
      const result = htmlToMarkdown(html)
      expect(result).not.toContain('|')
      expect(result).toContain('Inner')
    })

    it('unwraps a layout table that uses <th> for layout (cells contain block content)', () => {
      // Newsletters often use <th> for two-column grids — these are layout tables,
      // not data tables, and should be unwrapped to prose, not rendered as pipe tables.
      const html = `<table>
        <tr>
          <th><img src="cid:a.jpg" alt="A"><p>Left text</p></th>
          <th><img src="cid:b.jpg" alt="B"><p>Right text</p></th>
        </tr>
      </table>`
      const result = htmlToMarkdown(html)
      expect(result).not.toContain('|')
      expect(result).toContain('Left text')
      expect(result).toContain('Right text')
    })

    it('preserves a data table nested inside a layout table', () => {
      const html = `<table>
        <tr><td>
          <table>
            <tr><th>Col A</th><th>Col B</th></tr>
            <tr><td>1</td><td>2</td></tr>
          </table>
        </td></tr>
      </table>`
      const result = htmlToMarkdown(html)
      expect(result).toContain('| Col A | Col B |')
    })

    it('adds hard line breaks between layout table cell lines so they render visibly', () => {
      // Each cell ends up on its own line after table unwrapping; without \
      // they would render as a single run-on paragraph in markdown.
      const html = `<table>
        <tr><td>First cell</td><td>Second cell</td></tr>
        <tr><td>Third cell</td><td>Fourth cell</td></tr>
      </table>`
      const result = htmlToMarkdown(html)
      // All prose lines except the last in a consecutive run should end with \
      const lines = result.split('\n').filter((l) => l.trim() !== '')
      for (let i = 0; i < lines.length - 1; i++) {
        expect(lines[i]).toMatch(/\\$/)
      }
      expect(lines[lines.length - 1]).not.toMatch(/\\$/)
    })

    it('does not add hard breaks to lines already separated by blank lines', () => {
      // Regular paragraphs are separated by \n\n and must NOT get \
      const html = '<p>Paragraph one</p><p>Paragraph two</p>'
      const result = htmlToMarkdown(html)
      expect(result).not.toContain('\\')
    })

    it('does not add hard breaks to heading or list lines from layout tables', () => {
      // When a layout table cell contains a heading or list, those lines are
      // block elements and should not receive or trigger hard-break markers.
      const html = `<table>
        <tr><td><h2>Section title</h2></td></tr>
        <tr><td><ul><li>item one</li><li>item two</li></ul></td></tr>
      </table>`
      const result = htmlToMarkdown(html)
      // No line ending with \ should appear
      expect(result).not.toMatch(/\\\n/)
      expect(result).not.toMatch(/\\$/)
    })
  })
})

// ── convertPlainText ──────────────────────────────────────────────────────────

describe('convertPlainText', () => {
  it('returns empty string for empty input', () => {
    expect(convertPlainText('')).toBe('')
  })

  it('adds trailing \\ between consecutive prose lines', () => {
    const result = convertPlainText('Line one\nLine two\nLine three')
    expect(result).toBe('Line one\\\nLine two\\\nLine three')
  })

  it('does not add \\ after the last line', () => {
    const result = convertPlainText('Only line')
    expect(result).toBe('Only line')
  })

  it('does not add \\ before a blank line', () => {
    const result = convertPlainText('Para one\n\nPara two')
    expect(result).toBe('Para one\n\nPara two')
  })

  it('does not add \\ to list items (- )', () => {
    const result = convertPlainText('- item one\n- item two')
    expect(result).toBe('- item one\n- item two')
  })

  it('does not add \\ to list items (* )', () => {
    const result = convertPlainText('* item one\n* item two')
    expect(result).toBe('* item one\n* item two')
  })

  it('does not add \\ to numbered list items', () => {
    const result = convertPlainText('1. first\n2. second')
    expect(result).toBe('1. first\n2. second')
  })

  it('does not add \\ to prose line followed by a list item', () => {
    const result = convertPlainText('Intro text\n- item one')
    expect(result).toBe('Intro text\n- item one')
  })

  it('does not add \\ to list item followed by prose', () => {
    const result = convertPlainText('- item\nTrailing prose')
    expect(result).toBe('- item\nTrailing prose')
  })

  it('handles mixed prose and list', () => {
    const result = convertPlainText('Hello\nWorld\n\n- item\n\nFoo\nBar')
    expect(result).toBe('Hello\\\nWorld\n\n- item\n\nFoo\\\nBar')
  })

  it('escapes < in prose (prevents HTML injection)', () => {
    const result = convertPlainText('See <https://example.com>')
    expect(result).toBe('See &lt;https://example.com>')
  })

  it('escapes < in list items', () => {
    const result = convertPlainText('- See <note>')
    expect(result).toBe('- See &lt;note>')
  })

  it('keeps > as-is so quoted lines become Markdown blockquotes', () => {
    const text = '> Hello\n> World'
    const result = convertPlainText(text)
    expect(result).toContain('> Hello')
    expect(result).toContain('> World')
    expect(result).not.toContain('&gt;')
  })

  it('treats whitespace-only lines as blank — does not add \\ to preceding line', () => {
    // Plain-text emails often use tab-only lines as separators between content blocks.
    // They should not trigger hard-break markers on the line before them.
    const text = 'USA / New York\n\t\nLive dabei'
    const result = convertPlainText(text)
    expect(result).not.toContain('\\')
    expect(result).toContain('USA / New York')
    expect(result).toContain('Live dabei')
  })

  it('does not emit whitespace-only lines — collapses them to empty', () => {
    const text = 'Line A\n\t\n\t\nLine B'
    const result = convertPlainText(text)
    expect(result).not.toMatch(/^\t/m)
  })

  it('does not add hard-break \\ to blockquote lines', () => {
    const text = '> Quoted line one\n> Quoted line two'
    const result = convertPlainText(text)
    expect(result).not.toContain('\\')
  })

  it('does not add hard-break \\ to prose line immediately before a blockquote', () => {
    const text = 'Someone wrote:\n> Quoted text'
    const result = convertPlainText(text)
    expect(result).not.toMatch(/wrote:\\$/)
    expect(result).toContain('> Quoted text')
  })

  it('preserves indented list items (spaces)', () => {
    const result = convertPlainText('  - nested item')
    expect(result).toBe('  - nested item')
  })

  it('turns a dash divider directly under text into a thematic break (not a heading)', () => {
    const result = convertPlainText('Some text\n----------')
    expect(result).toBe('Some text\n\n---')
  })

  it('turns an equals divider directly under text into a thematic break', () => {
    const result = convertPlainText('Some text\n==========')
    expect(result).toBe('Some text\n\n---')
  })

  it('turns a standalone dash divider into a thematic break without extra blank line', () => {
    // Divider not preceded by non-empty line — no extra blank line needed
    const result = convertPlainText('----------')
    expect(result).toBe('---')
  })

  it('handles divider between two prose paragraphs', () => {
    const result = convertPlainText('Para one\n----------\nPara two')
    expect(result).toBe('Para one\n\n---\nPara two')
  })

  it('does not add \\ to prose line immediately before a divider', () => {
    const result = convertPlainText('Line one\n----------')
    // "Line one" should NOT get a trailing \ even though it is followed by non-empty content
    expect(result).not.toContain('\\')
  })

  it('normalises both 2-char and long dividers to ---', () => {
    expect(convertPlainText('--')).toBe('---')
    expect(convertPlainText('==================================================================')).toBe('---')
  })

  it('escapes # heading (h1)', () => {
    expect(convertPlainText('# Hello')).toBe('\\# Hello')
  })

  it('escapes ## heading (h2)', () => {
    expect(convertPlainText('## Section')).toBe('\\## Section')
  })

  it('escapes up to h6', () => {
    expect(convertPlainText('###### tiny')).toBe('\\###### tiny')
  })

  it('escapes # with no following space (bare hash at EOL counts as heading)', () => {
    expect(convertPlainText('#')).toBe('\\#')
  })

  it('does not escape # in the middle of a line', () => {
    expect(convertPlainText('color: #ff0000')).toBe('color: #ff0000')
  })

  it('does not escape lines with 7+ # chars (not a heading)', () => {
    expect(convertPlainText('####### not a heading')).toBe('####### not a heading')
  })

  it('escapes # with up to 3 leading spaces, backslash right before #', () => {
    expect(convertPlainText('   # indented')).toBe('   \\# indented')
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
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX', [])
    expect(fm).toContain('messageId:')
    expect(fm).toContain('subject: "Hello World"')
    expect(fm).toContain('from: "Jane Doe <jane@example.com>"')
    expect(fm).toContain('- "INBOX"')
  })

  it('produces to: [] when To header is absent', async () => {
    const eml = 'From: foo@example.com\r\nSubject: Test\r\n\r\nBody'
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX', [])
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
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX', [])
    expect(fm).toContain('"Alice <alice@example.com>"')
    expect(fm).toContain('"Bob <bob@example.com>"')
  })

  it('sets subject to empty string when missing', async () => {
    const eml = 'From: foo@example.com\r\n\r\nBody'
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX', [])
    expect(fm).toContain('subject: ""')
  })

  it('sets from to bare email when name is absent', async () => {
    const eml = 'From: foo@example.com\r\nSubject: Test\r\n\r\nBody'
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX', [])
    expect(fm).toContain('from: "foo@example.com"')
  })

  it('lists attachments as "filename (N bytes)" strings', async () => {
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
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX', [])
    expect(fm).toMatch(/- "report\.pdf \(\d+ bytes\)"/)
    expect(fm).not.toContain('contentType:')
  })

  it('sets attachments: [] when no attachments', async () => {
    const eml = 'From: foo@example.com\r\nSubject: Test\r\n\r\nBody'
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX', [])
    expect(fm).toContain('attachments: []')
  })

  it('includes formats list in frontmatter', async () => {
    const eml = 'From: foo@example.com\r\nSubject: Test\r\n\r\nBody'
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX', ['plaintext', 'html'])
    expect(fm).toContain('formats:')
    expect(fm).toContain('  - "plaintext"')
    expect(fm).toContain('  - "html"')
  })

  it('includes formats: [] when no formats given', async () => {
    const eml = 'From: foo@example.com\r\nSubject: Test\r\n\r\nBody'
    const parsed = await simpleParser(Buffer.from(eml))
    const fm = buildFrontmatter(parsed, Buffer.from(eml), 'INBOX', [])
    expect(fm).toContain('formats: []')
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
    expect(doc).not.toContain('html-body below')
  })

  it('plain-text-only: body is plain text, no conversion', async () => {
    const eml = 'From: foo@example.com\r\nSubject: Text\r\n\r\nHello plain world'
    const parsed = await simpleParser(Buffer.from(eml))
    const doc = assembleDocument(parsed, Buffer.from(eml), 'INBOX')
    expect(doc).toContain('Hello plain world')
  })

  it('HTML + plain text: separator present, plain text before HTML', async () => {
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
    expect(doc).toContain('**[html-body below - automatically converted from HTML; may contain formatting loss or artifacts]**')
    expect(doc).toContain('HTML here')
    expect(doc).toContain('Plain text here')
    // Plain text section must come before the HTML section
    expect(doc.indexOf('Plain text here')).toBeLessThan(doc.indexOf('HTML here'))
    // Frontmatter must list both formats
    expect(doc).toContain('formats:')
    expect(doc).toContain('"plaintext"')
    expect(doc).toContain('"html"')
  })

  it('includes setext h1 with subject between frontmatter and body', async () => {
    const eml = 'From: foo@example.com\r\nSubject: Hello World\r\n\r\nBody text'
    const parsed = await simpleParser(Buffer.from(eml))
    const doc = assembleDocument(parsed, Buffer.from(eml), 'INBOX')
    expect(doc).toContain('Hello World\n===========')
  })

  it('omits heading when subject is empty', async () => {
    const eml = 'From: foo@example.com\r\n\r\nBody text'
    const parsed = await simpleParser(Buffer.from(eml))
    const doc = assembleDocument(parsed, Buffer.from(eml), 'INBOX')
    // No setext underline in output
    expect(doc).not.toMatch(/^=+$/m)
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
    // Only frontmatter + optional subject heading, no body content
    expect(doc).not.toContain('AAAA')
    expect(doc).not.toContain('text/plain')
    // No prose body after the heading
    const afterHeading = doc.replace(/^---[\s\S]*?---\n(\n[\s\S]*?={3,}\n)?/, '')
    expect(afterHeading.trim()).toBe('')
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
    expect(result.skipped).toBe(0)
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

  it('skips .md that is newer than .eml (incremental)', async () => {
    const archivePath = path.join(tmpDir, 'archive')
    const exportPath = path.join(tmpDir, 'export')
    const folderDir = path.join(archivePath, 'INBOX')
    const outDir = path.join(exportPath, 'INBOX')
    await fsp.mkdir(folderDir, { recursive: true })
    await fsp.mkdir(outDir, { recursive: true })
    await fsp.writeFile(path.join(folderDir, '.backmail_state.json'), makeState([{ filename: '2026-01-01_test_abc12345' }]))

    // Write the .eml with a past mtime, then write a .md with a future mtime
    const emlPath = path.join(folderDir, '2026-01-01_test_abc12345.eml')
    const mdPath = path.join(outDir, '2026-01-01_test_abc12345.md')
    await fsp.writeFile(emlPath, SIMPLE_EML)
    const past = new Date(Date.now() - 10000)
    await fsp.utimes(emlPath, past, past)
    await fsp.writeFile(mdPath, 'existing content')

    const result = await exportFolder(archivePath, exportPath, 'INBOX', {})
    expect(result.exported).toBe(0)
    expect(result.skipped).toBe(1)
    // Existing .md content must be unchanged
    expect(await fsp.readFile(mdPath, 'utf-8')).toBe('existing content')
  })

  it('re-exports when .eml is newer than .md (incremental)', async () => {
    const archivePath = path.join(tmpDir, 'archive')
    const exportPath = path.join(tmpDir, 'export')
    const folderDir = path.join(archivePath, 'INBOX')
    const outDir = path.join(exportPath, 'INBOX')
    await fsp.mkdir(folderDir, { recursive: true })
    await fsp.mkdir(outDir, { recursive: true })
    await fsp.writeFile(path.join(folderDir, '.backmail_state.json'), makeState([{ filename: '2026-01-01_test_abc12345' }]))

    // Write a .md with a past mtime, then write the .eml with a newer mtime
    const emlPath = path.join(folderDir, '2026-01-01_test_abc12345.eml')
    const mdPath = path.join(outDir, '2026-01-01_test_abc12345.md')
    await fsp.writeFile(mdPath, 'stale content')
    const past = new Date(Date.now() - 10000)
    await fsp.utimes(mdPath, past, past)
    await fsp.writeFile(emlPath, SIMPLE_EML)

    const result = await exportFolder(archivePath, exportPath, 'INBOX', {})
    expect(result.exported).toBe(1)
    expect(result.skipped).toBe(0)
    expect(await fsp.readFile(mdPath, 'utf-8')).not.toBe('stale content')
  })

  it('force flag re-exports even when .md is up to date', async () => {
    const archivePath = path.join(tmpDir, 'archive')
    const exportPath = path.join(tmpDir, 'export')
    const folderDir = path.join(archivePath, 'INBOX')
    const outDir = path.join(exportPath, 'INBOX')
    await fsp.mkdir(folderDir, { recursive: true })
    await fsp.mkdir(outDir, { recursive: true })
    await fsp.writeFile(path.join(folderDir, '.backmail_state.json'), makeState([{ filename: '2026-01-01_test_abc12345' }]))

    const emlPath = path.join(folderDir, '2026-01-01_test_abc12345.eml')
    const mdPath = path.join(outDir, '2026-01-01_test_abc12345.md')
    await fsp.writeFile(emlPath, SIMPLE_EML)
    const past = new Date(Date.now() - 10000)
    await fsp.utimes(emlPath, past, past)
    await fsp.writeFile(mdPath, 'existing content')

    const result = await exportFolder(archivePath, exportPath, 'INBOX', { force: true })
    expect(result.exported).toBe(1)
    expect(result.skipped).toBe(0)
    expect(await fsp.readFile(mdPath, 'utf-8')).not.toBe('existing content')
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
    expect(result.skipped).toBe(0)
    expect(result.errors).toBe(0)
    expect(result.folderResults).toHaveLength(2)
  })
})
