import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const FIXTURES_DIR = resolve(__dirname, '../../tests/fixtures')

describe('TEST-03: synthetic .eml fixtures', () => {
  const emlFiles = readdirSync(FIXTURES_DIR).filter(f => extname(f) === '.eml')

  it('at least two .eml fixture files exist', () => {
    expect(emlFiles.length).toBeGreaterThanOrEqual(2)
  })

  emlFiles.forEach(file => {
    describe(`fixture: ${file}`, () => {
      const filePath = resolve(FIXTURES_DIR, file)

      it('has required RFC 2822 headers', () => {
        const content = readFileSync(filePath, 'utf-8')
        expect(content).toMatch(/^From:/m)
        expect(content).toMatch(/^To:/m)
        expect(content).toMatch(/^Subject:/m)
        expect(content).toMatch(/^Date:/m)
        expect(content).toMatch(/^Message-ID:/m)
        expect(content).toMatch(/^MIME-Version:/m)
        expect(content).toMatch(/^Content-Type:/m)
      })

      it('contains only @example.com email addresses (no real email)', () => {
        const content = readFileSync(filePath, 'utf-8')
        const emailAddresses = content.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []
        expect(emailAddresses.length).toBeGreaterThan(0)
        emailAddresses.forEach(addr => {
          expect(addr, `Found non-example.com address: ${addr}`).toMatch(/@example\.com$/)
        })
      })

      it('has a non-empty body (content after blank line separator)', () => {
        const content = readFileSync(filePath, 'utf-8')
        // RFC 2822: headers and body separated by a blank line
        const parts = content.split(/\r?\n\r?\n/)
        expect(parts.length).toBeGreaterThanOrEqual(2)
        const body = parts.slice(1).join('\n\n').trim()
        expect(body.length).toBeGreaterThan(0)
      })

      it('Message-ID uses fixture naming convention', () => {
        const content = readFileSync(filePath, 'utf-8')
        // Message-IDs must follow <fixture-NNN@example.com> pattern
        expect(content).toMatch(/^Message-ID: <fixture-\d+@example\.com>/m)
      })
    })
  })
})
