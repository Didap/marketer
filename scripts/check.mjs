// Controlli del repo con poche righe di uscita: una per passo, e il primo errore se c'è.
// Esce con 0 solo se passa tutto.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SKIP = new Set(['node_modules', '.nuxt', '.output', '.data', 'data', '.git'])
const DASHES = /[\u2013\u2014]/

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.(ts|mjs|js|vue|json|md|css|sql)$/.test(name) && name !== 'pnpm-lock.yaml') yield path
  }
}

function dashCheck() {
  const hits = []
  for (const file of files('.')) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (DASHES.test(line)) hits.push(`${file}:${i + 1}`)
    })
  }
  return { ok: hits.length === 0, detail: hits.slice(0, 10).join('\n') }
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const errors = out.split('\n').filter(l => /error|fail|✗|×/i.test(l) && !/0 errors?|Node\.js|upgrade/i.test(l))
  return { ok: r.status === 0, detail: errors.slice(0, 12).join('\n') || out.trim().split('\n').slice(-8).join('\n') }
}

const steps = [
  ['trattini lunghi e medi', dashCheck],
  ['typecheck app', () => run('pnpm', ['exec', 'nuxt', 'typecheck'])],
  ['typecheck worker', () => run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.worker.json', '--noEmit'])],
  ['test', () => run('pnpm', ['exec', 'vitest', 'run'])],
]

let failed = false
for (const [name, step] of steps) {
  const { ok, detail } = step()
  console.log(`${ok ? 'ok ' : 'NO '} ${name}`)
  if (!ok) {
    failed = true
    if (detail) console.log(detail)
  }
}
process.exit(failed ? 1 : 0)
