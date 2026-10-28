import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { dbPath, useDb } from '../server/db/client'
import { nameKey } from '../server/lib/comuni'
import { dataDir } from '../server/lib/env'
import { importSignals, signalTargets } from '../server/lib/prospects'
import type { Reporting } from '../server/lib/signals'
import { pugliaReportApps, scanSite, signalsFile } from '../server/lib/signals'

// pnpm segnali <regione>: raccoglie dai dati aperti i segnali dei Comuni già trovati in quella
// regione (scripts/segnali_comuni.py), legge i loro siti e importa tutto. Le fonti grandi restano in cache.

const region = process.argv.slice(2).join(' ').trim()
if (!region) {
  console.error('Uso: pnpm segnali <regione>, per esempio pnpm segnali Puglia')
  process.exit(1)
}
const out = join(dataDir(), 'segnali', `${nameKey(region).toLowerCase()}.json`)
const run = spawnSync('python3', ['-I', resolve('scripts/segnali_comuni.py'), '--regione', region, '--db', dbPath(), '--out', out], { stdio: 'inherit' })
if (run.status !== 0) process.exit(run.status ?? 1)

const file = signalsFile.parse(JSON.parse(readFileSync(out, 'utf8')))
const db = useDb()
const targets = signalTargets(db, file)
console.log(`Leggo i siti di ${targets.length} Comuni`)
const sites = new Map<number, { reporting: Reporting | null, modelSite: boolean }>()
const queue = [...targets]
await Promise.all(Array.from({ length: 12 }, async () => {
  for (let t = queue.shift(); t; t = queue.shift()) sites.set(t.id, await scanSite(t.website))
}))
if (nameKey(region) === 'PUGLIA') {
  for (const app of await pugliaReportApps()) {
    const t = targets.find(x => nameKey(x.city ?? '') === nameKey(app.comune))
    if (t) sites.set(t.id, { modelSite: sites.get(t.id)?.modelSite ?? false, reporting: { kind: 'piattaforma', tool: app.tool, vendor: null, url: app.url, spid: false, map: false } })
  }
}
const result = importSignals(db, file, sites)
console.log(`${file.region}: ${result.updated} Comuni aggiornati${result.missing ? `, ${result.missing} non ancora tra i prospect` : ''}`)
