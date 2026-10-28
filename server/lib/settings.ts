import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db/client'
import { settings } from '../db/schema'

// Impostazioni modificabili dalla dashboard, con il loro valore di partenza.

// Si parte piccoli: circa 5 dollari di listino al giorno. Va tarato sui consumi reali.
const DEFAULT_DAILY_TOKEN_CAP = 1_000_000

export const settingsInput = z.object({
  dailyTokenCap: z.number().int().min(0).max(1_000_000_000),
}).partial()

/** Valore libero salvato dal worker (per esempio lo stato del bot Telegram). */
export function readSetting(db: Db, key: string): unknown {
  return read(db, key)
}

export function writeSetting(db: Db, key: string, value: unknown): void {
  write(db, key, value)
}

function read(db: Db, key: string): unknown {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value
}

function write(db: Db, key: string, value: unknown): void {
  db.insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
    .run()
}

export function getDailyTokenCap(db: Db): number {
  const parsed = settingsInput.shape.dailyTokenCap.safeParse(read(db, 'dailyTokenCap'))
  return parsed.success && parsed.data !== undefined ? parsed.data : DEFAULT_DAILY_TOKEN_CAP
}

export function setDailyTokenCap(db: Db, value: number): void {
  write(db, 'dailyTokenCap', value)
}
