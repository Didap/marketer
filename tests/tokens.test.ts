import { describe, expect, it } from 'vitest'
import { romeDay, weigh } from '../server/lib/tokens'

describe('weigh', () => {
  it('pesa i token sul listino Opus', () => {
    expect(weigh({ input: 1000, output: 1000, cacheWrite: 1000, cacheRead: 1000 })).toBe(1000 + 5000 + 1250 + 100)
  })
})

describe('romeDay', () => {
  it('cambia giorno a mezzanotte di Roma, non di UTC', () => {
    expect(romeDay(new Date('2026-10-21T21:59:00Z'))).toBe('2026-10-21')
    expect(romeDay(new Date('2026-10-21T22:01:00Z'))).toBe('2026-10-22')
  })

  it('segue l\'ora solare', () => {
    expect(romeDay(new Date('2026-12-01T22:59:00Z'))).toBe('2026-12-01')
    expect(romeDay(new Date('2026-12-01T23:01:00Z'))).toBe('2026-12-02')
  })
})
