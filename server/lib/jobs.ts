import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db/client'
import type { Job, JobEventKind, JobSource, JobStatus } from '../db/schema'
import { FINAL_JOB_STATUSES, activity, heartbeats, JOB_PERMISSIONS, jobEvents, jobs } from '../db/schema'
import { getDailyTokenCap } from './settings'
import { romeDay } from './tokens'

// Coda dei job: la usano le API della dashboard, il server MCP e il worker.

export class JobError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'BAD_CWD' | 'NOT_CANCELABLE', message: string) {
    super(message)
  }
}

export const jobInput = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(50_000),
  cwd: z.string().trim().min(1).max(1024),
  permission: z.enum(JOB_PERMISSIONS).default('read'),
})
export type JobInput = z.input<typeof jobInput>

/** La cartella deve esistere: Claude parte lì dentro e ne legge il CLAUDE.md. */
export function resolveCwd(raw: string): string {
  const expanded = raw === '~' ? homedir() : raw.startsWith('~/') ? resolve(homedir(), raw.slice(2)) : raw
  if (!isAbsolute(expanded)) throw new JobError('BAD_CWD', `La cartella deve essere un percorso assoluto: ${raw}`)
  const path = resolve(expanded)
  let isDir = false
  try {
    isDir = statSync(path).isDirectory()
  }
  catch {}
  if (!isDir) throw new JobError('BAD_CWD', `La cartella non esiste: ${path}`)
  return path
}

/** kind: 'free' per i job scritti a mano, il nome del lavoro per quelli preparati da Marketer. */
export function enqueueJob(db: Db, raw: JobInput, source: JobSource, kind = 'free'): Job {
  const input = jobInput.parse(raw)
  const cwd = resolveCwd(input.cwd)
  return db.insert(jobs).values({ ...input, cwd, source, kind }).returning().get()
}

export function getJob(db: Db, id: number): Job {
  const job = db.select().from(jobs).where(eq(jobs.id, id)).get()
  if (!job) throw new JobError('NOT_FOUND', `Il job ${id} non esiste`)
  return job
}

export function listJobs(db: Db, opts: { limit?: number, status?: JobStatus } = {}): Job[] {
  return db.select().from(jobs)
    .where(opts.status ? eq(jobs.status, opts.status) : undefined)
    .orderBy(desc(jobs.id))
    .limit(opts.limit ?? 50)
    .all()
}

/** In coda si annulla subito; in corso lo ferma il worker al giro dopo. */
export function cancelJob(db: Db, id: number): Job {
  const job = getJob(db, id)
  if (job.status === 'queued') {
    return db.update(jobs)
      .set({ status: 'canceled', finishedAt: new Date() })
      .where(and(eq(jobs.id, id), eq(jobs.status, 'queued')))
      .returning().get() ?? getJob(db, id)
  }
  if (job.status === 'running') {
    return db.update(jobs).set({ cancelRequested: true }).where(eq(jobs.id, id)).returning().get()!
  }
  throw new JobError('NOT_CANCELABLE', `Il job ${id} è già chiuso`)
}

export function addJobEvent(db: Db, jobId: number, kind: JobEventKind, summary: string, payload?: string): void {
  db.insert(jobEvents).values({ jobId, kind, summary, payload }).run()
}

export function jobEventsAfter(db: Db, jobId: number, afterId: number, limit = 200) {
  return db.select({ id: jobEvents.id, at: jobEvents.at, kind: jobEvents.kind, summary: jobEvents.summary })
    .from(jobEvents)
    .where(and(eq(jobEvents.jobId, jobId), gt(jobEvents.id, afterId)))
    .orderBy(asc(jobEvents.id))
    .limit(limit)
    .all()
}

export function lastJobEvents(db: Db, jobId: number, limit: number) {
  return db.select({ id: jobEvents.id, at: jobEvents.at, kind: jobEvents.kind, summary: jobEvents.summary })
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId))
    .orderBy(desc(jobEvents.id))
    .limit(limit)
    .all()
    .reverse()
}

export function isFinal(job: Pick<Job, 'status'>): boolean {
  return FINAL_JOB_STATUSES.includes(job.status)
}

export function logActivity(db: Db, text: string, jobId?: number | null): void {
  db.insert(activity).values({ text, jobId: jobId ?? null }).run()
}

/** Token pesati spesi oggi contro il tetto. Al tetto i job nuovi restano in coda. */
export function tokenGuard(db: Db, at: Date = new Date()) {
  const day = romeDay(at)
  const used = db.select({ n: sql<number>`coalesce(sum(${jobs.weightedTokens}), 0)` })
    .from(jobs).where(eq(jobs.day, day)).get()?.n ?? 0
  const cap = getDailyTokenCap(db)
  const blocked = used >= cap
  return {
    day,
    used,
    cap,
    remaining: Math.max(0, cap - used),
    blocked,
    reason: blocked
      ? `Tetto giornaliero raggiunto (${used.toLocaleString('it-IT')} di ${cap.toLocaleString('it-IT')} token pesati): i job in coda ripartono domani o alzando il tetto.`
      : null,
  }
}
export type TokenGuard = ReturnType<typeof tokenGuard>

const WORKER_STALE_MS = 15_000

export function workerStatus(db: Db, now: Date = new Date()) {
  const beat = db.select().from(heartbeats).where(eq(heartbeats.name, 'worker')).get()
  return {
    alive: !!beat && now.getTime() - beat.at.getTime() < WORKER_STALE_MS,
    lastBeat: beat?.at ?? null,
    startedAt: beat?.startedAt ?? null,
    pid: beat?.pid ?? null,
  }
}

/** Quadro sintetico per la pagina Oggi e per il tool marketer_status. */
export function overview(db: Db) {
  const counts = db.select({ status: jobs.status, n: sql<number>`count(*)` })
    .from(jobs).where(inArray(jobs.status, ['queued', 'running'])).groupBy(jobs.status).all()
  const running = db.select().from(jobs).where(eq(jobs.status, 'running')).orderBy(asc(jobs.id)).all()
  return {
    worker: workerStatus(db),
    guard: tokenGuard(db),
    queued: counts.find(c => c.status === 'queued')?.n ?? 0,
    running: running.map(j => ({ id: j.id, title: j.title, startedAt: j.startedAt, weightedTokens: j.weightedTokens })),
  }
}
