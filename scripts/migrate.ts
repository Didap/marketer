import { resolve } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { useDb } from '../server/db/client'

migrate(useDb(), { migrationsFolder: resolve(process.cwd(), 'drizzle') })
console.log('migrazioni applicate')
