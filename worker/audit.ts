import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Db } from '../server/db/client'
import type { Audit } from '../server/db/schema'
import type { LighthouseScores } from '../server/lib/audit'
import { analyzeHtml, buildIssues, fetchSite } from '../server/lib/audit'
import { isComune } from '../server/lib/comuni'
import { failAudit, finishAudit, getProspect } from '../server/lib/prospects'

// L'audit di un sito: verifiche sull'HTML della home, e Lighthouse in un processo figlio (worker/lighthouse.ts).

const LIGHTHOUSE_TIMEOUT_MS = 150_000
// Sul Mac le prestazioni di Lighthouse oscillano molto da un giro all'altro (89 e poi 55 sullo stesso sito).
// Sotto questa soglia si rifà un giro e vale il migliore: a un prospect si dice solo un difetto che regge.
const RETRY_BELOW = 90
const CHILD = fileURLToPath(new URL('./lighthouse.ts', import.meta.url))

let child: ChildProcess | null = null

export function runLighthouse(url: string): Promise<LighthouseScores> {
  return new Promise((resolve, reject) => {
    // Stessi flag del worker (--import tsx): il figlio è TypeScript come lui.
    const proc = spawn(process.execPath, [...process.execArgv, CHILD, url], { stdio: ['ignore', 'pipe', 'ignore'] })
    child = proc
    let out = ''
    proc.stdout!.on('data', (chunk: Buffer) => { out += chunk.toString() })
    const timer = setTimeout(() => proc.kill('SIGTERM'), LIGHTHOUSE_TIMEOUT_MS)
    proc.on('error', reject)
    proc.on('close', (code) => {
      clearTimeout(timer)
      child = null
      const line = out.trim().split('\n').pop() ?? ''
      try {
        const result = JSON.parse(line) as { ok: true, scores: LighthouseScores } | { ok: false, error: string }
        if (result.ok) resolve(result.scores)
        else reject(new Error(result.error))
      }
      catch {
        reject(new Error(`Lighthouse è uscito senza risultato (codice ${code})`))
      }
    })
  })
}

/** Ferma il Lighthouse in corso quando il worker si spegne: il figlio chiude il suo Chrome. */
export function stopLighthouse(): void {
  child?.kill('SIGTERM')
}

export async function runAudit(db: Db, audit: Audit): Promise<Audit> {
  try {
    const site = await fetchSite(audit.url)
    const page = analyzeHtml(site.html, site.headers)
    let lh: LighthouseScores | null = null
    let lhError: string | null = null
    // Di un Comune conta solo se in home c'è già uno strumento di segnalazione: Lighthouse, un minuto a sito, no.
    const lighthouse = !isComune(getProspect(db, audit.prospectId))
    for (let run = 0; lighthouse && run < 2; run++) {
      try {
        const scores = await runLighthouse(site.finalUrl)
        if (!lh || (scores.performance ?? 0) > (lh.performance ?? 0)) lh = scores
        lhError = null
      }
      catch (err) {
        lhError = lh ? null : err instanceof Error ? err.message : String(err)
      }
      if (lh && (lh.performance ?? 0) >= RETRY_BELOW) break
    }
    return finishAudit(db, audit.id, {
      finalUrl: site.finalUrl,
      https: site.https && !site.certError,
      mobile: page.mobile,
      performance: lh?.performance ?? null,
      accessibility: lh?.accessibility ?? null,
      seo: lh?.seo ?? null,
      bestPractices: lh?.bestPractices ?? null,
      lcpMs: lh?.lcpMs ?? null,
      stack: page.stack,
      hasForm: page.hasForm,
      hasBooking: page.hasBooking,
      issues: buildIssues(site, page, lh, new Date()),
      error: lhError,
    })
  }
  catch (err) {
    return failAudit(db, audit.id, err instanceof Error ? err.message : String(err))
  }
}
