import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { useDb } from '../server/db/client'
import { heartbeats, jobs } from '../server/db/schema'
import { telegramConfig } from '../server/lib/env'
import { addJobEvent, tokenGuard } from '../server/lib/jobs'
import { claimNextAudit, claimNextSearch, requeueInterrupted, rescoreProspects, runSearch } from '../server/lib/prospects'
import { runAudit, stopLighthouse } from './audit'
import { JobRun } from './runner'
import { TelegramBot } from './telegram'

// Il worker di Marketer: tenuto vivo da launchd, fa il lavoro meccanico senza LLM.
// Fase 1: battito, coda dei job con la guardia sui token, un job alla volta.
// Fase 3: ricerche dei prospect e audit dei siti, una alla volta per coda, accanto ai job.
// Fase 4: il bot Telegram per le approvazioni, se in .env ci sono token e chat.

const TICK_MS = 2_000
// La freschezza cala col tempo e il portfolio cambia: i punteggi si rifanno ogni ora.
const RESCORE_MS = 3_600_000

const db = useDb()
const startedAt = new Date()
let current: JobRun | null = null
let lastHeldReason: string | null = null
let stopping = false
let searching = false
let auditing = false
let lastRescore = 0
const telegram = telegramConfig() ? new TelegramBot(db, telegramConfig()!, log) : null

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`)
}

/** Un job rimasto «in corso» da una vita precedente del worker non ha più nessuno che lo segue. */
function recoverOrphans(): void {
  const orphans = db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, 'running')).all()
  for (const { id } of orphans) {
    db.update(jobs).set({ status: 'failed', error: 'Interrotto: il worker è ripartito mentre il job girava', finishedAt: new Date(), pid: null })
      .where(eq(jobs.id, id)).run()
    addJobEvent(db, id, 'runner', 'Interrotto: il worker è ripartito mentre il job girava')
  }
  if (orphans.length) log(`job orfani chiusi: ${orphans.map(o => o.id).join(', ')}`)
}

/** Tiene sveglio il Mac finché il worker è vivo: caffeinate esce da solo quando il worker muore. */
function keepAwake(): void {
  if (process.env.MARKETER_NO_CAFFEINATE === '1' || process.platform !== 'darwin') return
  const child = spawn('/usr/bin/caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore' })
  child.on('error', err => log(`caffeinate non partito: ${err.message}`))
  child.unref()
}

function beat(): void {
  const now = new Date()
  db.insert(heartbeats)
    .values({ name: 'worker', pid: process.pid, at: now, startedAt })
    .onConflictDoUpdate({ target: heartbeats.name, set: { pid: process.pid, at: now, startedAt } })
    .run()
}

/** Ricerche e audit girano in parallelo ai job: niente token, solo rete e il Chrome del Mac. */
function pumpProspectWork(): void {
  if (!searching) {
    const search = claimNextSearch(db)
    if (search) {
      searching = true
      log(`ricerca ${search.id} (${search.query.source})`)
      runSearch(db, search)
        .then(done => log(`ricerca ${search.id}: ${done.status}${done.error ? ` (${done.error})` : `, ${done.found} trovate, ${done.added} nuove`}`))
        .catch(err => log(`ricerca ${search.id}: ${err instanceof Error ? err.message : String(err)}`))
        .finally(() => { searching = false })
    }
  }
  if (!auditing) {
    const audit = claimNextAudit(db)
    if (audit) {
      auditing = true
      runAudit(db, audit)
        .then(done => log(`audit ${audit.id} ${audit.url}: ${done.status}${done.error ? ` (${done.error})` : ''}`))
        .catch(err => log(`audit ${audit.id}: ${err instanceof Error ? err.message : String(err)}`))
        .finally(() => { auditing = false })
    }
  }
  if (Date.now() - lastRescore > RESCORE_MS) {
    lastRescore = Date.now()
    rescoreProspects(db)
  }
}

function tick(): void {
  beat()
  if (stopping) return
  pumpProspectWork()
  void telegram?.tick()

  if (current) {
    const row = db.select({ cancelRequested: jobs.cancelRequested }).from(jobs).where(eq(jobs.id, current.job.id)).get()
    if (row?.cancelRequested) current.stop('canceled', 'Annullato dalla dashboard')
    return
  }

  const next = db.select().from(jobs).where(eq(jobs.status, 'queued')).orderBy(asc(jobs.id)).limit(1).get()
  if (!next) return

  const guard = tokenGuard(db)
  if (guard.blocked) {
    if (guard.reason !== lastHeldReason) log(`coda ferma: ${guard.reason}`)
    lastHeldReason = guard.reason
    return
  }
  lastHeldReason = null

  log(`avvio job ${next.id}: ${next.title}`)
  const run = new JobRun(db, next, {
    usedBefore: guard.used,
    cap: guard.cap,
    onExit: () => {
      log(`job ${next.id} chiuso`)
      current = null
    },
  })
  current = run
  run.start()
}

function shutdown(signal: string): void {
  if (stopping) return
  stopping = true
  log(`${signal}: chiudo`)
  stopLighthouse()
  telegram?.stop()
  if (!current) process.exit(0)
  current.stop('failed', 'Interrotto: il worker si è spento')
  const deadline = Date.now() + 8_000
  const wait = setInterval(() => {
    if (!current || Date.now() > deadline) {
      clearInterval(wait)
      process.exit(0)
    }
  }, 200)
}

migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') })
recoverOrphans()
const requeued = requeueInterrupted(db)
if (requeued.searches || requeued.audits) log(`riprese ${requeued.searches} ricerche e ${requeued.audits} audit interrotti`)
keepAwake()
telegram?.start()
log(telegram ? 'bot Telegram acceso' : 'bot Telegram spento: mancano TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID')
beat()
log(`worker avviato (pid ${process.pid})`)
setInterval(() => {
  try {
    tick()
  }
  catch (err) {
    log(`errore nel giro: ${err instanceof Error ? err.stack : String(err)}`)
  }
}, TICK_MS)

// Un errore sfuggito a una ricerca o a un audit si scrive nel log: far cadere il worker fermerebbe anche il job in corso.
process.on('unhandledRejection', err => log(`errore non gestito: ${err instanceof Error ? err.stack : String(err)}`))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
