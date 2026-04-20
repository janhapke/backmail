import { describe, it, expect } from 'vitest'
import * as net from 'node:net'

// Allow override via env vars for CI environments that map ports differently
const IMAP_HOST = process.env.IMAP_HOST ?? 'localhost'
const IMAP_PORT = Number(process.env.IMAP_PORT ?? '143')

describe('TEST-01: IMAP container connectivity', () => {
  it('TCP connection to IMAP port succeeds', () => {
    return new Promise<void>((resolve, reject) => {
      const socket = net.connect(IMAP_PORT, IMAP_HOST, () => {
        socket.destroy()
        resolve()
      })
      socket.on('error', reject)
    })
  })

  it('IMAP greeting contains Dovecot ready banner', () => {
    return new Promise<void>((resolve, reject) => {
      const socket = net.connect(IMAP_PORT, IMAP_HOST, () => {
        socket.once('data', (data) => {
          const banner = data.toString()
          // RFC 3501: server greeting starts with "* OK"
          expect(banner).toMatch(/\* OK/)
          socket.destroy()
          resolve()
        })
      })
      socket.on('error', reject)
    })
  })
})
