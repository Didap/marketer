import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { dataDir } from '../lib/env'
import * as schema from './schema'

// Un solo file SQLite condiviso da app e worker: WAL per leggere mentre l'altro scrive.

function open() {
  mkdirSync(dataDir(), { recursive: true })
  const sqlite = new Database(dbPath())
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}

let db: ReturnType<typeof open> | undefined

export const dbPath = () => join(dataDir(), 'marketer.db')

export function useDb() {
  db ??= open()
  return db
}

export type Db = ReturnType<typeof useDb>
