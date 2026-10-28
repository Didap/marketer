import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { eq } from 'drizzle-orm'
import type { Db } from '../server/db/client'
import type { Job, JobPermission, JobStatus } from '../server/db/schema'
import { jobs } from '../server/db/schema'
import { appUrl, claudeBin, dataDir, mcpToken } from '../server/lib/env'
import { addJobEvent } from '../server/lib/jobs'
import type { Usage } from '../server/lib/tokens'
import { EMPTY_USAGE, addUsage, romeDay, weigh } from '../server/lib/tokens'
import type { ParsedResult } from './stream'
import { clip, parseStreamLine } from './stream'

// Un job = un processo `claude -p` su Opus, con il server MCP di Marketer e nient'altro.
// Ogni riga dello stream diventa un evento in job_events; i token si aggiornano dal vivo,
// e se il giorno sfora il tetto il job viene fermato.

const READ_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'mcp__marketer']
const EDIT_TOOLS = [...READ_TOOLS, 'Edit', 'Write', 'NotebookEdit']
const MAX_PAYLOAD = 20_000
const KILL_GRACE_MS = 5_000

export function permissionArgs(permission: JobPermission): string[] {
  switch (permission) {
    case 'read':
      return ['--permission-mode', 'dontAsk', '--allowedTools', READ_TOOLS.join(',')]
    case 'edit':
      return ['--permission-mode', 'dontAsk', '--allowedTools', EDIT_TOOLS.join(',')]
    case 'full':
      return ['--permission-mode', 'auto', '--allowedTools', 'mcp__marketer']
  }
}

export function systemPromptFor(job: Pick<Job, 'id' | 'title'>): string {
  return [
    `Sei il job ${job.id} di Marketer («${job.title}»), l'agente commerciale di didap.`,
    'Giri senza nessuno al terminale: nessuno può rispondere a domande. Se ti manca qualcosa, dillo nel risultato finale.',
    'Con i tool mcp__marketer leggi e scrivi i dati di Marketer. Con activity_log registra le cose fatte che William deve vedere nella pagina Oggi.',
    'Testi in italiano, niente trattini lunghi né medi. Chiudi con un riassunto breve di cosa hai fatto.',
  ].join('\n')
}

export function claudeArgs(job: Pick<Job, 'id' | 'title' | 'permission'>, mcpConfigPath: string): string[] {
  return [
    '-p',
    '--model', 'opus',
    '--output-format', 'stream-json',
    '--verbose',
    '--mcp-config', mcpConfigPath,
    '--strict-mcp-config',
    '--append-system-prompt', systemPromptFor(job),
    ...permissionArgs(job.permission),
  ]
}

export interface RunOptions {
  /** Token pesati già spesi oggi dagli altri job quando questo parte. */
  usedBefore: number
  cap: number
  onExit: () => void
}

export class JobRun {
  private child: ChildProcess | null = null
  private readonly usageByMessage = new Map<string, Usage>()
  private result: ParsedResult | null = null
  private endedBy: { status: JobStatus, reason: string } | null = null
  private stderrTail: string[] = []
  private finished = false
  private readonly mcpConfigPath: string

  constructor(private readonly db: Db, readonly job: Job, private readonly opts: RunOptions) {
    this.mcpConfigPath = join(dataDir(), 'run', `job-${job.id}.mcp.json`)
  }

  start(): void {
    const { db, job } = this
    const startedAt = new Date()
    this.writeMcpConfig()

    const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CODE_SUBAGENT_MODEL: 'opus', MARKETER_JOB_ID: String(job.id) }
    // I job consumano l'abbonamento, mai una chiave API a consumo.
    delete env.ANTHROPIC_API_KEY

    const child = spawn(claudeBin(), claudeArgs(job, this.mcpConfigPath), {
      cwd: job.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Gruppo di processi a parte: fermando il job si fermano anche i comandi che ha lanciato.
      detached: true,
    })
    this.child = child

    db.update(jobs).set({
      status: 'running',
      startedAt,
      day: romeDay(startedAt),
      pid: child.pid ?? null,
    }).where(eq(jobs.id, job.id)).run()
    addJobEvent(db, job.id, 'runner', `Avviato in ${job.cwd} (permessi: ${job.permission}, pid ${child.pid ?? '?'})`)

    child.stdin?.on('error', () => {})
    child.stdin?.end(job.prompt)

    createInterface({ input: child.stdout! }).on('line', line => this.onLine(line))
    createInterface({ input: child.stderr! }).on('line', (line) => {
      if (!line.trim()) return
      this.stderrTail = [...this.stderrTail.slice(-19), line]
      addJobEvent(db, job.id, 'stderr', clip(line, 2000))
    })

    child.on('error', (err) => {
      this.endedBy ??= { status: 'failed', reason: `Impossibile avviare ${claudeBin()}: ${err.message}` }
      // Se il processo non è mai partito, 'close' può non arrivare.
      if (child.pid === undefined) this.finish(null)
    })
    child.on('close', code => this.finish(code))
  }

  /** Ferma il job (annullato da William, tetto, worker che si spegne). */
  stop(status: JobStatus, reason: string): void {
    if (!this.child || this.endedBy) return
    this.endedBy = { status, reason }
    addJobEvent(this.db, this.job.id, 'runner', reason)
    this.killGroup('SIGTERM')
    setTimeout(() => this.killGroup('SIGKILL'), KILL_GRACE_MS).unref()
  }

  get running(): boolean {
    return this.child !== null
  }

  private killGroup(signal: NodeJS.Signals): void {
    const pid = this.child?.pid
    if (!pid) return
    try {
      process.kill(-pid, signal)
    }
    catch {}
  }

  private onLine(line: string): void {
    if (!line.trim()) return
    const { db, job } = this
    const parsed = parseStreamLine(line)
    const payload = clip(line, MAX_PAYLOAD)
    parsed.events.forEach((ev, i) => addJobEvent(db, job.id, ev.kind, ev.summary, i === 0 ? payload : undefined))

    if (parsed.init) {
      db.update(jobs).set({ sessionId: parsed.init.sessionId, model: parsed.init.model }).where(eq(jobs.id, job.id)).run()
    }
    if (parsed.usage) {
      this.usageByMessage.set(parsed.usage.messageId, parsed.usage.usage)
      this.saveUsage(this.liveUsage())
    }
    if (parsed.result) {
      this.result = parsed.result
      this.saveUsage(parsed.result.usage, parsed.result.costUsd)
    }
  }

  private liveUsage(): Usage {
    let total = EMPTY_USAGE
    for (const u of this.usageByMessage.values()) total = addUsage(total, u)
    return total
  }

  private saveUsage(usage: Usage, costUsd?: number): void {
    const weighted = weigh(usage)
    this.db.update(jobs).set({
      inputTokens: usage.input,
      outputTokens: usage.output,
      cacheWriteTokens: usage.cacheWrite,
      cacheReadTokens: usage.cacheRead,
      weightedTokens: weighted,
      ...(costUsd === undefined ? {} : { costUsd }),
    }).where(eq(jobs.id, this.job.id)).run()

    if (!this.result && this.opts.usedBefore + weighted >= this.opts.cap) {
      this.stop('stopped', `Fermato: con questo job il giorno arriva a ${(this.opts.usedBefore + weighted).toLocaleString('it-IT')} token pesati, oltre il tetto di ${this.opts.cap.toLocaleString('it-IT')}.`)
    }
  }

  private finish(code: number | null): void {
    if (this.finished) return
    this.finished = true
    const { db, job } = this
    let status: JobStatus
    let error: string | null = null
    if (this.endedBy) {
      status = this.endedBy.status
      error = this.endedBy.reason
    }
    else if (this.result) {
      status = this.result.ok ? 'done' : 'failed'
      if (!this.result.ok) error = `Claude ha chiuso con ${this.result.subtype}`
    }
    else {
      status = 'failed'
      error = `Claude è uscito con codice ${code ?? '?'} senza risultato.${this.stderrTail.length ? ` Ultime righe: ${clip(this.stderrTail.slice(-3).join(' | '), 600)}` : ''}`
    }

    db.update(jobs).set({
      status,
      error,
      finishedAt: new Date(),
      pid: null,
      cancelRequested: false,
      result: this.result?.text ?? null,
      numTurns: this.result?.numTurns ?? null,
      durationMs: this.result?.durationMs ?? null,
    }).where(eq(jobs.id, job.id)).run()
    addJobEvent(db, job.id, 'runner', status === 'done' ? 'Job chiuso' : `Job chiuso: ${error}`)

    rmSync(this.mcpConfigPath, { force: true })
    this.child = null
    this.opts.onExit()
  }

  /** Il token MCP sta in un file leggibile solo da William, non negli argomenti del processo. */
  private writeMcpConfig(): void {
    mkdirSync(join(dataDir(), 'run'), { recursive: true })
    const config = {
      mcpServers: {
        marketer: {
          type: 'http',
          url: `${appUrl()}/mcp`,
          headers: { 'Authorization': `Bearer ${mcpToken()}`, 'X-Marketer-Job': String(this.job.id) },
        },
      },
    }
    writeFileSync(this.mcpConfigPath, JSON.stringify(config, null, 2), { mode: 0o600 })
    chmodSync(this.mcpConfigPath, 0o600)
  }
}
