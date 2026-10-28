import * as chromeLauncher from 'chrome-launcher'
import lighthouse from 'lighthouse'
import type { LighthouseScores } from '../server/lib/audit'
import { chromePath } from '../server/lib/env'

// Processo figlio del worker: un Lighthouse su mobile con il Chrome del Mac, senza finestre.
// Sta da solo perché Lighthouse può lasciare errori non gestiti che farebbero cadere il worker,
// e con lui i job in corso. Scrive una riga JSON su stdout ed esce.

const CATEGORIES = ['performance', 'accessibility', 'seo', 'best-practices']

let chrome: chromeLauncher.LaunchedChrome | undefined

function finish(out: { ok: true, scores: LighthouseScores } | { ok: false, error: string }): never {
  process.stdout.write(`${JSON.stringify(out)}\n`)
  chrome?.kill()
  process.exit(0)
}

const fail = (err: unknown) => finish({ ok: false, error: err instanceof Error ? err.message : String(err) })
process.on('unhandledRejection', fail)
process.on('uncaughtException', fail)
process.on('SIGTERM', () => fail('Lighthouse fermato dal worker'))

async function main(url: string): Promise<void> {
  chrome = await chromeLauncher.launch({
    chromePath: chromePath(),
    chromeFlags: ['--headless=new', '--no-first-run', '--disable-gpu', '--disable-extensions', '--mute-audio'],
    logLevel: 'silent',
  })
  const result = await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: CATEGORIES })
  const lhr = result?.lhr
  if (!lhr) throw new Error('Lighthouse non ha prodotto un rapporto')
  if (lhr.runtimeError) throw new Error(`Lighthouse: ${lhr.runtimeError.message}`)
  const score = (key: string) => {
    const value = lhr.categories[key]?.score
    return typeof value === 'number' ? Math.round(value * 100) : null
  }
  const lcp = lhr.audits['largest-contentful-paint']?.numericValue
  finish({
    ok: true,
    scores: {
      performance: score('performance'),
      accessibility: score('accessibility'),
      seo: score('seo'),
      bestPractices: score('best-practices'),
      lcpMs: typeof lcp === 'number' ? Math.round(lcp) : null,
    },
  })
}

main(process.argv[2] ?? '').catch(fail)
