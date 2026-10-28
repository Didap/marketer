import { describe, expect, it } from 'vitest'
import { hostName, isAllowedHost, isSameOrigin } from '../server/lib/host'

describe('isAllowedHost', () => {
  it('accetta localhost con qualsiasi porta', () => {
    expect(isAllowedHost('127.0.0.1:4310', [])).toBe(true)
    expect(isAllowedHost('localhost:4311', [])).toBe(true)
    expect(isAllowedHost('[::1]:4310', [])).toBe(true)
  })

  it('rifiuta un nome esterno che punta a 127.0.0.1 (DNS rebinding)', () => {
    expect(isAllowedHost('evil.example:4310', [])).toBe(false)
    expect(isAllowedHost('127.0.0.1.evil.example', [])).toBe(false)
    expect(isAllowedHost(undefined, [])).toBe(false)
  })

  it('accetta i nomi aggiunti in configurazione', () => {
    expect(isAllowedHost('mac.tail1234.ts.net', ['mac.tail1234.ts.net'])).toBe(true)
  })

  it('estrae il nome senza porta', () => {
    expect(hostName('LocalHost:4310')).toBe('localhost')
  })
})

describe('isSameOrigin', () => {
  it('accetta la stessa origine o nessuna', () => {
    expect(isSameOrigin('http://127.0.0.1:4310', '127.0.0.1:4310')).toBe(true)
    expect(isSameOrigin(undefined, '127.0.0.1:4310')).toBe(true)
  })

  it('rifiuta un\'altra origine', () => {
    expect(isSameOrigin('https://evil.example', '127.0.0.1:4310')).toBe(false)
    expect(isSameOrigin('http://127.0.0.1:4311', '127.0.0.1:4310')).toBe(false)
  })
})
