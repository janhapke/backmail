// src/core/export.ts — no exit calls, no console, no CLI imports.
import fs from 'node:fs/promises'
import path from 'node:path'
import { simpleParser } from 'mailparser'
import type { ParsedMail } from 'mailparser'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { parseHeaderBlock, extractRawHeader } from './sync.js'
import { listFolders } from './browse.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExportOptions {
  excludeFolders?: string[]
  onlyFolders?: string[]
  verbose?: boolean
  force?: boolean
  onLog?: (msg: string) => void
}

export interface ExportResult {
  exported: number
  skipped: number
  removed: number
  errors: number
  folderResults: FolderExportResult[]
}

export interface FolderExportResult {
  path: string
  exported: number
  skipped: number
  removed: number
  error?: Error
}

// ── HTML → Markdown ───────────────────────────────────────────────────────────

export function preprocessHtml(html: string): string {
  // Strip invisible filler characters used as spacers in HTML email
  // (soft hyphen U+00AD, zero-width space U+200B, zero-width non-joiner U+200C,
  //  zero-width joiner U+200D, BOM/zero-width no-break space U+FEFF,
  //  combining grapheme joiner U+034F \u2014 used in preheader padding sequences)
  let out = html.replace(/[\u034f\u00ad\u200b\u200c\u200d\ufeff]/g, '')

  // Strip <style> and <script> blocks
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '')
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '')

  // Strip all <img> tags except inline attachments (src="cid:...").
  // Logos, layout images, and tracking pixels from external URLs are all removed.
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i)
    return src && src[1].toLowerCase().startsWith('cid:') ? tag : ''
  })

  return out
}

// ── Smart table rules ─────────────────────────────────────────────────────────
// Layout tables (no <th> in first row, or role="presentation") are unwrapped to
// prose. Data tables (first row all <th>) are kept as GFM pipe tables.

// Block-level tags that indicate a <th> is being used for layout rather than
// as a data column header. A genuine header cell contains short inline text.
const BLOCK_TAGS = new Set(['table', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'blockquote', 'img', 'figure'])

function cellHasBlockContent(cell: any): boolean {
  function walk(node: any): boolean {
    if (node.nodeType !== 1) return false
    if (BLOCK_TAGS.has((node.nodeName as string).toLowerCase())) return true
    for (const child of Array.from(node.childNodes as Iterable<any>)) {
      if (walk(child)) return true
    }
    return false
  }
  for (const child of Array.from(cell.childNodes as Iterable<any>)) {
    if (walk(child)) return true
  }
  return false
}

function tableHasHeadingRow(table: any): boolean {
  if (typeof table.getAttribute === 'function' && table.getAttribute('role') === 'presentation') {
    return false
  }
  if (!table.rows || table.rows.length === 0) return false
  const firstRow = table.rows[0]
  let cellCount = 0
  for (const child of Array.from(firstRow.childNodes as Iterable<any>)) {
    if (child.nodeType !== 1) continue
    cellCount++
    if (child.nodeName !== 'TH') return false
    // A <th> containing block-level elements is a layout cell, not a data header
    if (cellHasBlockContent(child)) return false
  }
  return cellCount > 0
}

function findAncestorTable(node: any): any {
  for (let n = node.parentNode; n; n = n.parentNode) {
    if (n.nodeName === 'TABLE') return n
  }
  return null
}

function gfmPipeCell(content: string, node: any): string {
  const index = Array.prototype.indexOf.call(node.parentNode.childNodes, node)
  return (index === 0 ? '| ' : ' ') + content + ' |'
}

function isFirstTbody(node: any): boolean {
  const prev = node.previousSibling
  return (
    node.nodeName === 'TBODY' &&
    (!prev || (prev.nodeName === 'THEAD' && /^\s*$/.test(prev.textContent || '')))
  )
}

function isGfmHeadingRow(tr: any): boolean {
  const parent = tr.parentNode
  const allTh = Array.prototype.every.call(tr.childNodes, (n: any) => n.nodeName === 'TH')
  return (
    parent.nodeName === 'THEAD' ||
    (parent.firstChild === tr &&
      allTh &&
      (parent.nodeName === 'TABLE' || isFirstTbody(parent)))
  )
}

function configureSmartTableRules(service: TurndownService): void {
  // These override GFM's rules by reusing the same key names, preserving rule
  // priority order while replacing the implementation.

  service.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement(content: string, node: any): string {
      const table = findAncestorTable(node)
      if (!table || !tableHasHeadingRow(table)) {
        const trimmed = content.trim()
        return trimmed ? '\n\n' + trimmed + '\n\n' : ''
      }
      return gfmPipeCell(content, node)
    },
  })

  service.addRule('tableRow', {
    filter: 'tr',
    replacement(content: string, node: any): string {
      const table = findAncestorTable(node)
      if (!table || !tableHasHeadingRow(table)) return content
      if (isGfmHeadingRow(node)) {
        let border = ''
        for (const n of Array.from(node.childNodes as Iterable<any>)) {
          if (n.nodeType === 1) border += gfmPipeCell('---', n)
        }
        return '\n' + content + '\n' + border
      }
      return '\n' + content
    },
  })

  service.addRule('table', {
    filter: 'table',
    replacement(content: string, node: any): string {
      if (!tableHasHeadingRow(node)) {
        const prose = content.replace(/\n{2,}/g, '\n').trim()
        return prose ? '\n\n' + prose + '\n\n' : ''
      }
      return '\n\n' + content + '\n\n'
    },
  })
}

export function htmlToMarkdown(html: string): string {
  const cleaned = preprocessHtml(html)

  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
  td.use(gfm)
  configureSmartTableRules(td)
  let md = td.turndown(cleaned)

  // (a) Strip invisible characters that may have been decoded from HTML entities
  //     by the DOM parser inside Turndown (e.g. &#847; \u2192 U+034F, &shy; \u2192 U+00AD).
  //     Mirrors the preprocessHtml strip but catches entity-encoded variants.
  md = md.replace(/[\u00ad\u034f\u200b\u200c\u200d\ufeff]/g, '')
  // (b) Replace Unicode non-breaking / decorative spaces with plain space.
  //     U+2007 FIGURE SPACE (&#8199;) is the main culprit in preheader padding divs.
  md = md.replace(/[\u00a0\u1680\u2002\u2003\u2007\u2008\u2009\u200a\u202f\u205f\u3000]/g, ' ')
  // (c) Trim trailing whitespace from every line (also collapses space-only lines to empty)
  md = md.replace(/[ \t]+$/gm, '')
  // (e) Remove links with empty or whitespace-only text \u2014 these come from <a> tags
  //     that wrapped images or content we stripped (tracking links, logo anchors).
  md = md.replace(/\[ *\]\([^)]*\)/g, '')
  // (d) Convert Turndown-escaped visual bullets (\* / \-) to real list items.
  //     Also strips leading whitespace so 4+-space indent doesn't trigger code blocks.
  md = md.replace(/^[ \t]*\\([*-]) /gm, '- ')
  // (c) Collapse 3+ consecutive newlines to 2
  md = md.replace(/\n{3,}/g, '\n\n')
  // (f) Add hard line breaks between consecutive non-block prose lines so that
  //     content extracted from layout tables (collapsed to single newlines) still
  //     renders with visible line breaks in markdown.
  md = addMarkdownHardBreaks(md)

  return md
}

// ── Markdown hard-break pass ──────────────────────────────────────────────────
// Detects markdown structural lines that should not receive or trigger a hard-
// break marker: headings, blockquotes, list items, indented/fenced code,
// thematic breaks, setext underlines, and GFM table rows.
const MD_BLOCK_RE =
  /^(?:[ ]{0,3}#{1,6}[ \t]|>|[ ]{0,3}[-*+][ \t]|[ ]{0,3}\d+\.[ \t]|[ ]{4,}|\t|`{3,}|~{3,}|[=\-*_]{3,}\s*$|\|)/

function addMarkdownHardBreaks(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const next = lines[i + 1]
    const isEmpty = (s: string | undefined): boolean =>
      s === undefined || s === '' || /^\s+$/.test(s)
    const isBlock = (s: string): boolean => MD_BLOCK_RE.test(s)

    const addBreak =
      !isEmpty(line) &&
      !isBlock(line) &&
      !isEmpty(next) &&
      !isBlock(next)

    out.push(addBreak ? line + '\\' : line)
  }
  return out.join('\n')
}

// ── Plain text → Markdown ─────────────────────────────────────────────────────

// Matches manually typed list lines: optional leading spaces, then "- " or "* " or "N. "
const MANUAL_LIST_RE = /^[ ]*(?:[-*][ \t]|\d+\.[ \t])/

// Matches ASCII divider lines: 2+ dashes or equals signs (optional trailing spaces).
// These are Setext heading underlines in CommonMark — when they appear directly under
// a text line they would turn it into a heading. We normalise them to thematic breaks.
const DIVIDER_RE = /^[-=]{2,}\s*$/

function escapeHtml(s: string): string {
  return s.replace(/</g, '&lt;')
}

interface ConvertedLine {
  out: string
  isBlock: boolean
  isDivider: boolean
}

// Matches ATX heading lines: up to 3 leading spaces, then 1-6 # chars, then space/tab or EOL
const ATX_HEADING_RE = /^[ ]{0,3}#{1,6}([ \t]|$)/

function classifyLine(line: string): ConvertedLine {
  // Whitespace-only lines (tabs, spaces) count as blank lines — they must not
  // trigger hard-break markers on the line before them.
  if (line === '' || /^\s+$/.test(line)) return { out: '', isBlock: false, isDivider: false }
  if (DIVIDER_RE.test(line)) return { out: '---', isBlock: false, isDivider: true }
  if (MANUAL_LIST_RE.test(line)) return { out: escapeHtml(line).trimEnd(), isBlock: true, isDivider: false }
  // Blockquote lines (email quote marker >) are treated as block elements so they
  // neither receive nor trigger hard-break markers on adjacent lines.
  if (line.startsWith('>')) return { out: escapeHtml(line).trimEnd(), isBlock: true, isDivider: false }
  // Escape the # to prevent ATX heading interpretation, preserving any leading spaces
  const escaped = ATX_HEADING_RE.test(line)
    ? escapeHtml(line).replace(/^([ ]{0,3})(#{1,6})/, '$1\\$2')
    : escapeHtml(line)
  return { out: escaped.trimEnd(), isBlock: false, isDivider: false }
}

export function convertPlainText(text: string): string {
  if (text === '') return ''

  const lines = text.split('\n').map(classifyLine)
  const out: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const curr = lines[i]
    const next = lines[i + 1]

    if (curr.isDivider) {
      // Insert a blank line before the divider when the previous output line is
      // non-empty, so the Markdown parser sees a thematic break rather than a
      // Setext heading underline.
      if (out.length > 0 && out[out.length - 1] !== '') out.push('')
      out.push('---')
      continue
    }

    if (curr.out === '') {
      out.push('')
      continue
    }

    // Append \ only between two consecutive non-empty prose lines.
    // Skip if the next line is a divider (a blank line will be inserted before it).
    const hardBreak =
      !curr.isBlock &&
      next !== undefined &&
      !next.isDivider &&
      next.out !== '' &&
      !next.isBlock

    out.push(hardBreak ? curr.out + '\\' : curr.out)
  }

  return out.join('\n')
}

// ── receivedDate extraction ───────────────────────────────────────────────────

export function extractReceivedDate(rawSource: Buffer | string): string {
  const unfolded = parseHeaderBlock(rawSource)

  const receivedLine = extractRawHeader(unfolded, 'received')
  if (receivedLine) {
    const semi = receivedLine.lastIndexOf(';')
    if (semi !== -1) {
      const parsed = new Date(receivedLine.slice(semi + 1).trim())
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().replace('T', ' ').slice(0, 19)
      }
    }
  }

  const dateLine = extractRawHeader(unfolded, 'date')
  if (dateLine) {
    const parsed = new Date(dateLine.trim())
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().replace('T', ' ').slice(0, 19)
    }
  }

  return '0000-00-00 00:00:00'
}

// ── Frontmatter builder ───────────────────────────────────────────────────────

function yamlQuote(s: string): string {
  // Escape backslashes and double quotes, then wrap in double quotes
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

function formatAddress(name: string | undefined, email: string | undefined): string {
  const n = name?.trim() ?? ''
  const e = email?.trim() ?? ''
  if (n && e) return `${n} <${e}>`
  return n || e
}

export function buildFrontmatter(
  parsed: ParsedMail,
  rawSource: Buffer | string,
  folderPath: string,
  formats: string[],
): string {
  const messageId = parsed.messageId ?? ''
  const fromAddr = parsed.from?.value[0]
  const fromStr = formatAddress(fromAddr?.name, fromAddr?.address)
  const toList = (parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]) : [])
    .flatMap((a) => a.value)
  const subject = parsed.subject ?? ''
  const receivedDate = extractReceivedDate(rawSource)
  const attachments = parsed.attachments ?? []

  const lines: string[] = []
  lines.push('---')
  lines.push(`messageId: ${yamlQuote(messageId)}`)
  lines.push(`from: ${yamlQuote(fromStr)}`)

  if (toList.length === 0) {
    lines.push('to: []')
  } else {
    lines.push('to:')
    for (const addr of toList) {
      lines.push(`  - ${yamlQuote(formatAddress(addr.name, addr.address))}`)
    }
  }

  lines.push(`subject: ${yamlQuote(subject)}`)
  lines.push(`received: ${yamlQuote(receivedDate)}`)
  lines.push('folders:')
  lines.push(`  - ${yamlQuote(folderPath)}`)

  if (formats.length === 0) {
    lines.push('formats: []')
  } else {
    lines.push('formats:')
    for (const fmt of formats) {
      lines.push(`  - ${yamlQuote(fmt)}`)
    }
  }

  if (attachments.length === 0) {
    lines.push('attachments: []')
  } else {
    lines.push('attachments:')
    for (const att of attachments) {
      const name = att.filename ?? ''
      const size = att.size ?? 0
      lines.push(`  - ${yamlQuote(name ? `${name} (${size} bytes)` : `(${size} bytes)`)}`)
    }
  }

  lines.push('---')
  return lines.join('\n')
}

// ── Document assembler ────────────────────────────────────────────────────────

// Separator used when both plain text and HTML body parts are present.
// Three thematic breaks frame a bold label so AI agents and humans can
// unambiguously identify the boundary and understand what follows.
const HTML_BODY_SEPARATOR =
  '\n\n---\n---\n---\n\n' +
  '**[html-body below - automatically converted from HTML; may contain formatting loss or artifacts]**' +
  '\n\n---\n---\n---\n\n'

export function assembleDocument(
  parsed: ParsedMail,
  rawSource: Buffer | string,
  folderPath: string,
): string {
  // mailparser auto-generates text from html and vice versa — check the raw
  // content-type to determine which parts were explicitly present
  const unfolded = parseHeaderBlock(rawSource)
  const ct = extractRawHeader(unfolded, 'content-type').toLowerCase().trim()
  const isTopLevelTextOnly = ct.startsWith('text/plain')
  const isTopLevelHtmlOnly = ct.startsWith('text/html')

  const hasHtml = !isTopLevelTextOnly && typeof parsed.html === 'string' && parsed.html.length > 0
  const hasText = !isTopLevelHtmlOnly && typeof parsed.text === 'string' && parsed.text.length > 0

  const formats: string[] = []
  if (hasText) formats.push('plaintext')
  if (hasHtml) formats.push('html')

  const frontmatter = buildFrontmatter(parsed, rawSource, folderPath, formats)

  const subject = parsed.subject ?? ''
  const subjectHeading = subject.length > 0
    ? subject + '\n' + '='.repeat(subject.length)
    : ''

  const header = subjectHeading ? frontmatter + '\n\n' + subjectHeading : frontmatter

  if (!hasHtml && !hasText) {
    return header + '\n'
  }

  if (hasHtml && !hasText) {
    return header + '\n\n' + htmlToMarkdown(parsed.html as string)
  }

  if (!hasHtml && hasText) {
    return header + '\n\n' + convertPlainText(parsed.text as string)
  }

  // Both present: plain text first (canonical), then HTML conversion
  return (
    header +
    '\n\n' +
    convertPlainText(parsed.text as string) +
    HTML_BODY_SEPARATOR +
    htmlToMarkdown(parsed.html as string)
  )
}

// ── Folder/account export ─────────────────────────────────────────────────────

interface FolderMessage {
  uid: number
  'message-id': string
  filename: string
  flags: string[]
}

interface FolderState {
  uidvalidity: string
  uidnext: number
  messages: FolderMessage[]
}

function filterStringFolders(
  folders: string[],
  onlyFolders?: string[],
  excludeFolders?: string[],
): string[] {
  if (onlyFolders && onlyFolders.length > 0 && excludeFolders && excludeFolders.length > 0) {
    throw new Error('onlyFolders and excludeFolders are mutually exclusive')
  }
  if (onlyFolders && onlyFolders.length > 0) {
    return folders.filter((f) => onlyFolders.includes(f))
  }
  if (excludeFolders && excludeFolders.length > 0) {
    return folders.filter((f) => !excludeFolders.includes(f))
  }
  return folders
}

export async function listExportFolders(
  archivePath: string,
  opts: { excludeFolders?: string[]; onlyFolders?: string[] },
): Promise<string[]> {
  const all = await listFolders(archivePath)
  return filterStringFolders(all, opts.onlyFolders, opts.excludeFolders)
}

export async function exportFolder(
  archivePath: string,
  exportPath: string,
  folderPath: string,
  opts: { verbose?: boolean; force?: boolean; onLog?: (m: string) => void },
): Promise<FolderExportResult> {
  const result: FolderExportResult = { path: folderPath, exported: 0, skipped: 0, removed: 0 }

  const stateFilePath = path.join(archivePath, folderPath, '.backmail_state.json')
  let state: FolderState
  try {
    const content = await fs.readFile(stateFilePath, 'utf-8')
    state = JSON.parse(content) as FolderState
  } catch (err) {
    result.error = err instanceof Error ? err : new Error(String(err))
    return result
  }

  const outDir = path.join(exportPath, folderPath)
  await fs.mkdir(outDir, { recursive: true })

  // Remove orphaned .md files (no matching entry in state)
  const knownStems = new Set(state.messages.map((m) => m.filename))
  try {
    const existing = await fs.readdir(outDir)
    for (const entry of existing) {
      if (!entry.endsWith('.md')) continue
      const stem = entry.slice(0, -3)
      if (!knownStems.has(stem)) {
        await fs.unlink(path.join(outDir, entry))
        result.removed++
        if (opts.verbose) opts.onLog?.(`removed ${folderPath}/${entry}`)
      }
    }
  } catch {
    // outDir may not exist yet on the very first run — nothing to clean up
  }

  for (const msg of state.messages) {
    const emlPath = path.join(archivePath, folderPath, `${msg.filename}.eml`)
    const mdPath = path.join(outDir, `${msg.filename}.md`)
    try {
      if (!opts.force) {
        // Skip if the .md already exists and is at least as new as the .eml
        try {
          const [emlStat, mdStat] = await Promise.all([fs.stat(emlPath), fs.stat(mdPath)])
          if (mdStat.mtimeMs >= emlStat.mtimeMs) {
            result.skipped++
            continue
          }
        } catch {
          // .md doesn't exist or .eml missing — fall through to export
        }
      }

      const rawSource = await fs.readFile(emlPath)
      const parsed = await simpleParser(rawSource)
      const mdContent = assembleDocument(parsed, rawSource, folderPath)
      await fs.writeFile(mdPath, mdContent, 'utf-8')
      result.exported++
      if (opts.verbose) opts.onLog?.(`exported ${folderPath}/${msg.filename}.md`)
    } catch (err) {
      const msg2 = err instanceof Error ? err.message : String(err)
      opts.onLog?.(`error exporting ${folderPath}/${msg.filename}.eml: ${msg2}`)
    }
  }

  return result
}

export async function exportAccount(
  archivePath: string,
  exportPath: string,
  opts: ExportOptions,
): Promise<ExportResult> {
  const folders = await listExportFolders(archivePath, {
    excludeFolders: opts.excludeFolders,
    onlyFolders: opts.onlyFolders,
  })

  const folderResults: FolderExportResult[] = []
  let totalExported = 0
  let totalSkipped = 0
  let totalRemoved = 0
  let totalErrors = 0

  for (const folder of folders) {
    const fr = await exportFolder(archivePath, exportPath, folder, {
      verbose: opts.verbose,
      force: opts.force,
      onLog: opts.onLog,
    })
    folderResults.push(fr)
    totalExported += fr.exported
    totalSkipped += fr.skipped
    totalRemoved += fr.removed
    if (fr.error) totalErrors++
  }

  return { exported: totalExported, skipped: totalSkipped, removed: totalRemoved, errors: totalErrors, folderResults }
}
