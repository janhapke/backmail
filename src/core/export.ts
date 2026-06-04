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
  onLog?: (msg: string) => void
}

export interface ExportResult {
  exported: number
  errors: number
  folderResults: FolderExportResult[]
}

export interface FolderExportResult {
  path: string
  exported: number
  error?: Error
}

// ── HTML → Markdown ───────────────────────────────────────────────────────────

export function preprocessHtml(html: string): string {
  // Strip invisible filler characters used as spacers in HTML email
  // (soft hyphen U+00AD, zero-width space U+200B, zero-width non-joiner U+200C,
  //  zero-width joiner U+200D, BOM/zero-width no-break space U+FEFF)
  let out = html.replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '')

  // Strip <style> and <script> blocks
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '')
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '')

  // Strip tracking-pixel <img> tags: width/height attr ≤ 1 or inline style width:0/height:0
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    // Check width/height attributes
    const widthAttr = tag.match(/\bwidth\s*=\s*["']?(\d+)["']?/i)
    const heightAttr = tag.match(/\bheight\s*=\s*["']?(\d+)["']?/i)
    if (widthAttr && parseInt(widthAttr[1]) <= 1) return ''
    if (heightAttr && parseInt(heightAttr[1]) <= 1) return ''

    // Check inline style for width:0 or height:0
    const styleAttr = tag.match(/\bstyle\s*=\s*["']([^"']*)["']/i)
    if (styleAttr) {
      const style = styleAttr[1]
      if (/width\s*:\s*0/.test(style) || /height\s*:\s*0/.test(style)) return ''
    }

    return tag
  })

  return out
}

// ── Smart table rules ─────────────────────────────────────────────────────────
// Layout tables (no <th> in first row, or role="presentation") are unwrapped to
// prose. Data tables (first row all <th>) are kept as GFM pipe tables.

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

  // (a) Replace Unicode non-breaking / decorative spaces with plain space
  md = md.replace(/[\u00a0\u1680\u2002\u2003\u2009\u200a\u202f]/g, ' ')
  // (b) Trim trailing whitespace from every line
  md = md.replace(/[ \t]+$/gm, '')
  // (d) Convert Turndown-escaped visual bullets (\* / \-) to real list items.
  //     Also strips leading whitespace so 4+-space indent doesn't trigger code blocks.
  md = md.replace(/^[ \t]*\\([*-]) /gm, '- ')
  // (c) Collapse 3+ consecutive newlines to 2
  md = md.replace(/\n{3,}/g, '\n\n')

  return md
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
  if (line === '') return { out: '', isBlock: false, isDivider: false }
  if (DIVIDER_RE.test(line)) return { out: '---', isBlock: false, isDivider: true }
  if (MANUAL_LIST_RE.test(line)) return { out: escapeHtml(line), isBlock: true, isDivider: false }
  // Blockquote lines (email quote marker >) are treated as block elements so they
  // neither receive nor trigger hard-break markers on adjacent lines.
  if (line.startsWith('>')) return { out: escapeHtml(line), isBlock: true, isDivider: false }
  // Escape the # to prevent ATX heading interpretation, preserving any leading spaces
  const escaped = ATX_HEADING_RE.test(line)
    ? escapeHtml(line).replace(/^([ ]{0,3})(#{1,6})/, '$1\\$2')
    : escapeHtml(line)
  return { out: escaped, isBlock: false, isDivider: false }
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

export function buildFrontmatter(
  parsed: ParsedMail,
  rawSource: Buffer | string,
  folderPath: string,
): string {
  const messageId = parsed.messageId ?? ''
  const fromName = parsed.from?.value[0]?.name ?? ''
  const fromEmail = parsed.from?.value[0]?.address ?? ''
  const toList = (parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]) : [])
    .flatMap((a) => a.value)
  const subject = parsed.subject ?? ''
  const receivedDate = extractReceivedDate(rawSource)
  const attachments = parsed.attachments ?? []

  const lines: string[] = []
  lines.push('---')
  lines.push(`messageId: ${yamlQuote(messageId)}`)
  lines.push('from:')
  lines.push(`  name: ${yamlQuote(fromName)}`)
  lines.push(`  email: ${yamlQuote(fromEmail)}`)

  if (toList.length === 0) {
    lines.push('to: []')
  } else {
    lines.push('to:')
    for (const addr of toList) {
      lines.push(`  - name: ${yamlQuote(addr.name ?? '')}`)
      lines.push(`    email: ${yamlQuote(addr.address ?? '')}`)
    }
  }

  lines.push(`subject: ${yamlQuote(subject)}`)
  lines.push(`receivedDate: ${yamlQuote(receivedDate)}`)
  lines.push('folders:')
  lines.push(`  - ${yamlQuote(folderPath)}`)

  if (attachments.length === 0) {
    lines.push('attachments: []')
  } else {
    lines.push('attachments:')
    for (const att of attachments) {
      lines.push(`  - filename: ${yamlQuote(att.filename ?? '')}`)
      lines.push(`    contentType: ${yamlQuote(att.contentType)}`)
      lines.push(`    size: ${att.size ?? 0}`)
    }
  }

  lines.push('---')
  return lines.join('\n')
}

// ── Document assembler ────────────────────────────────────────────────────────

export function assembleDocument(
  parsed: ParsedMail,
  rawSource: Buffer | string,
  folderPath: string,
): string {
  const frontmatter = buildFrontmatter(parsed, rawSource, folderPath)

  // mailparser auto-generates text from html and vice versa — check the raw
  // content-type to determine which parts were explicitly present
  const unfolded = parseHeaderBlock(rawSource)
  const ct = extractRawHeader(unfolded, 'content-type').toLowerCase().trim()
  const isTopLevelTextOnly = ct.startsWith('text/plain')
  const isTopLevelHtmlOnly = ct.startsWith('text/html')

  const hasHtml = !isTopLevelTextOnly && typeof parsed.html === 'string' && parsed.html.length > 0
  const hasText = !isTopLevelHtmlOnly && typeof parsed.text === 'string' && parsed.text.length > 0

  if (!hasHtml && !hasText) {
    return frontmatter + '\n'
  }

  if (hasHtml && !hasText) {
    return frontmatter + '\n\n' + htmlToMarkdown(parsed.html as string)
  }

  if (!hasHtml && hasText) {
    return frontmatter + '\n\n' + convertPlainText(parsed.text as string)
  }

  // Both HTML and plain text
  const divider = '\n\n---\n\n---\n\n---\n\n'
  return (
    frontmatter +
    '\n\n' +
    htmlToMarkdown(parsed.html as string) +
    divider +
    convertPlainText(parsed.text as string)
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
  opts: { verbose?: boolean; onLog?: (m: string) => void },
): Promise<FolderExportResult> {
  const result: FolderExportResult = { path: folderPath, exported: 0 }

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

  for (const msg of state.messages) {
    const emlPath = path.join(archivePath, folderPath, `${msg.filename}.eml`)
    try {
      const rawSource = await fs.readFile(emlPath)
      const parsed = await simpleParser(rawSource)
      const mdContent = assembleDocument(parsed, rawSource, folderPath)
      const mdPath = path.join(outDir, `${msg.filename}.md`)
      await fs.writeFile(mdPath, mdContent, 'utf-8')
      result.exported++
      if (opts.verbose) opts.onLog?.(`exported ${folderPath}/${msg.filename}.md`)
    } catch (err) {
      const msg2 = err instanceof Error ? err.message : String(err)
      opts.onLog?.(`error exporting ${folderPath}/${msg.filename}.eml: ${msg2}`)
      result.exported  // don't increment
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
  let totalErrors = 0

  for (const folder of folders) {
    const fr = await exportFolder(archivePath, exportPath, folder, {
      verbose: opts.verbose,
      onLog: opts.onLog,
    })
    folderResults.push(fr)
    totalExported += fr.exported
    if (fr.error) totalErrors++
  }

  return { exported: totalExported, errors: totalErrors, folderResults }
}
