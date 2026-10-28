import { z } from 'zod'
import { detectStack, fetchPage, fetchSite, pageLinks, REPORTING_TOOLS } from './audit'
import type { Fetcher } from './sources'

// I segnali dei Comuni dai dati aperti. scripts/segnali_comuni.py raccoglie in un file per regione
// PNRR, coesione e contratti; qui si leggono i siti con le regole dell'audit, e tutto diventa il
// profilo del Comune e le frasi da citare, ognuna con la sua fonte.

const money = z.number()
/** Solo link http e https: arrivano da file di terzi e finiscono in un href. */
const link = z.string().regex(/^https?:\/\//i)
const contract = z.object({ subject: z.string(), amount: money, cig: z.string(), year: z.string() })
const sources = z.object({ pnrr: z.string(), opencoesione: z.string(), anac: z.string(), site: z.string() })

const fileComune = z.object({
  regeneration: z.object({
    /** Euro di progetti PNRR (la parte del Comune, se il progetto è di più Comuni) e di coesione. */
    amount: money,
    pnrr: z.array(z.object({ measure: z.string(), title: z.string(), amount: money, partners: z.number().int().min(1), cup: z.string() })),
    cohesion: z.array(z.object({ title: z.string(), amount: money, cycle: z.string(), url: link.nullable() })),
  }),
  digital: z.object({ measures: z.array(z.string()) }),
  maintenance: z.object({ contracts: z.number().int(), amount: money, kinds: z.record(z.string(), z.number()), top: z.array(contract), purchases: z.array(contract) }),
})

export const signalsFile = z.object({
  region: z.string(),
  collectedAt: z.string(),
  sinceYear: z.number().int(),
  sources,
  comuni: z.record(z.string().regex(/^\d{6}$/), fileComune),
})
export type SignalsFile = z.infer<typeof signalsFile>
type FileComune = z.infer<typeof fileComune>

/** Cosa offre oggi il sito di un Comune a chi vuole segnalare: piattaforma con mappa, modulo generico, niente. */
export interface Reporting {
  kind: 'piattaforma' | 'modulo' | 'nessuno'
  tool: string | null
  vendor: string | null
  url: string
  spid: boolean
  map: boolean
}

/** Il profilo salvato nel Comune: i dati del file, i siti letti qui e i percentili nella regione (da 0 a 1). */
export interface ComuneProfile {
  collectedAt: string
  sinceYear: number
  sources: z.infer<typeof sources>
  regeneration: FileComune['regeneration'] & { rank: number }
  digital: FileComune['digital'] & { modelSite: boolean }
  reporting: Reporting | null
  maintenance: FileComune['maintenance'] & { rank: number }
}

// Siti dei Comuni.

const NOT_A_REPORT = /scia\b|certificat|whistle|illecit|anticorruz|corruzion|privacy|cookie|condott/i

/** Il link per segnalare: prima un disservizio, poi una segnalazione o un guasto; mai notizie e avvisi. */
export function reportLink(html: string, base: string): string | null {
  let best: string | null = null
  let bestScore = 0
  for (const { url, text } of pageLinks(html, base)) {
    // Il percorso e il testo, non il dominio: «scia» è anche in brescia, pescia, cascia.
    const { pathname, search } = new URL(url)
    const hay = `${pathname}${search} ${text}`
    if (NOT_A_REPORT.test(hay) || /\/(?:news|notizie|avvisi|comunicati)\//i.test(pathname)) continue
    const score = /disserviz/i.test(hay) ? 3 : /segnala/i.test(hay) ? 2 : /guast/i.test(hay) ? 1 : 0
    if (score > bestScore) {
      best = url
      bestScore = score
    }
  }
  return best
}

/** Cosa offre il sito a chi vuole segnalare, con il link come prova; reporting null se non si è potuto vedere. */
export async function scanSite(website: string | null, fetcher: Fetcher = fetch): Promise<{ reporting: Reporting | null, modelSite: boolean }> {
  const home = website ? await fetchSite(website, fetcher).catch(() => null) : null
  if (!home) return { reporting: null, modelSite: false }
  const modelSite = /bootstrap-italia/i.test(home.html)
  const linkUrl = reportLink(home.html, home.finalUrl)
  // C'è un link ma la pagina non si apre: non si sa cosa c'è dietro.
  const target = linkUrl ? await fetchPage(linkUrl, fetcher).catch(() => null) : null
  if (linkUrl && !target) return { reporting: null, modelSite }
  const page = target?.html ?? ''
  const tool = detectStack(`${home.html}\n${page}`, new Headers()).find(s => REPORTING_TOOLS.has(s.name))?.name ?? null
  // Mappe interattive di un modulo, non la mappa del municipio incorporata nel piè di pagina.
  const map = /leaflet|openlayers|maps\.googleapis\.com\/maps\/api\/js|mapbox|geolocaliz/i.test(page)
  const mapped = !tool && map && /buche|illuminazione|rifiuti|verde pubblico|strade/i.test(page)
  const kind = tool || mapped ? 'piattaforma' : target ? 'modulo' : 'nessuno'
  const vendor = kind !== 'modulo' ? null : /vurp|halley/i.test(page) ? 'Halley' : /maggioli/i.test(page) ? 'Maggioli' : /wp-content/i.test(page) ? 'WordPress' : null
  return {
    reporting: { kind, tool: tool ?? (mapped ? 'segnalazioni con mappa' : null), vendor, url: target?.finalUrl ?? home.finalUrl, spid: /\bspid\b/i.test(page), map },
    modelSite,
  }
}

/** Le app di segnalazione che un Comune pubblica tra i dati aperti della Puglia (es. BaRisolve a Bari). */
export async function pugliaReportApps(fetcher: Fetcher = fetch): Promise<{ comune: string, tool: string, url: string }[]> {
  try {
    const res = await fetcher('https://dati.puglia.it/ckan/api/3/action/package_search?q=segnalazioni%20app&rows=50', { signal: AbortSignal.timeout(30_000) })
    const found = (await res.json()).result.results as { name: string, title: string, organization?: { title?: string } }[]
    return found.filter(p => /\bapp\b/i.test(p.title) && /segnalazion/i.test(p.title)).map(p => ({
      comune: (p.organization?.title ?? '').replace(/^Comune di /i, ''),
      tool: `app ${/\bapp\s+(\w+)/i.exec(p.title)?.[1] ?? 'del Comune'}`,
      url: `https://dati.puglia.it/ckan/dataset/${p.name}`,
    }))
  }
  catch {
    return []
  }
}

// Frasi da citare.

export const SIGNAL_KINDS = ['rigenerazione', 'digitale', 'segnalazioni', 'manutenzione'] as const
export type SignalKind = typeof SIGNAL_KINDS[number]

export interface Signal {
  kind: SignalKind
  /** Una frase che si può citare così com'è. */
  text: string
  source: string
  url: string | null
}

const euro = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 })

/** Importi leggibili: 1 milione, 1,2 milioni, 85.000 euro. */
export function formatEuro(amount: number): string {
  if (amount < 1_000_000) return `${euro.format(amount)} euro`
  const millions = Math.round(amount / 100_000) / 10
  return `${millions.toLocaleString('it-IT')} ${millions === 1 ? 'milione' : 'milioni'} di euro`
}

/**
 * Un titolo da citare. Alcuni titoli PNRR sono solo codici («CUP 1 - ID 411 Comune di Brindisi»), altri
 * ReGiS li tronca a 40 caratteri a metà parola: meglio niente che un titolo a metà.
 */
function citable(title: string): string | null {
  const t = title.replace(/\s+/g, ' ').trim()
  return t.length >= 20 && t.length !== 40 && !/^CUP\b|^\d|^ID\b/i.test(t) ? t : null
}

const opencup = (cup: string) => `https://www.opencup.gov.it/portale/progetto/-/cup/${cup}`

/** Le frasi da citare in un messaggio, dalla più forte, ognuna con la fonte e il link per verificarla. */
export function comuneSignals(p: ComuneProfile): Signal[] {
  const out: Signal[] = []
  const r = p.regeneration
  for (const project of r.pnrr.slice(0, 3)) {
    const title = citable(project.title)
    const shared = project.partners > 1 ? ` in tutto, con altri ${project.partners - 1} Comuni` : ''
    out.push({
      kind: 'rigenerazione',
      text: `PNRR, ${project.measure}: ${title ? `«${title}», ` : ''}${formatEuro(project.amount)}${shared} (CUP ${project.cup})`,
      source: p.sources.pnrr,
      url: opencup(project.cup),
    })
  }
  for (const project of r.cohesion.slice(0, 2)) {
    out.push({
      kind: 'rigenerazione',
      text: `Fondi di coesione ${project.cycle}: «${project.title.replace(/\s+/g, ' ')}», ${formatEuro(project.amount)}`,
      source: p.sources.opencoesione,
      url: project.url,
    })
  }

  const d = p.digital
  if (d.measures.length) {
    out.push({ kind: 'digitale', text: `PA digitale 2026 (PNRR): ${d.measures.length} misure adottate (${d.measures.join(', ')})`, source: p.sources.pnrr, url: null })
  }
  if (d.modelSite) out.push({ kind: 'digitale', text: 'Il sito segue il modello nazionale dei siti dei Comuni (Designers Italia)', source: p.sources.site, url: null })

  for (const buy of p.maintenance.purchases) {
    out.push({ kind: 'segnalazioni', text: `Nel ${buy.year} ha affidato «${buy.subject}», ${formatEuro(buy.amount)} (CIG ${buy.cig})`, source: p.sources.anac, url: null })
  }
  const rep = p.reporting
  if (rep?.kind === 'piattaforma') {
    out.push({ kind: 'segnalazioni', text: `Usa già uno strumento di segnalazione: ${rep.tool}`, source: p.sources.site, url: rep.url })
  }
  else if (rep?.kind === 'modulo') {
    const how = [rep.vendor && `su ${rep.vendor}`, rep.spid && 'con accesso SPID', !rep.map && 'senza mappa'].filter(Boolean).join(', ')
    out.push({ kind: 'segnalazioni', text: `Per segnalare un disservizio c'è un modulo generico${how ? ` (${how})` : ''}: niente stato della segnalazione né imprese che intervengono`, source: p.sources.site, url: rep.url })
  }
  else if (rep?.kind === 'nessuno') {
    out.push({ kind: 'segnalazioni', text: 'In home non c\'è un modo per segnalare un disservizio', source: p.sources.site, url: rep.url })
  }

  const m = p.maintenance
  if (m.contracts) {
    const kinds = Object.keys(m.kinds).join(', ')
    out.push({ kind: 'manutenzione', text: `Dal ${p.sinceYear}, ${m.contracts} affidamenti di manutenzione (${kinds}) per ${formatEuro(m.amount)}`, source: p.sources.anac, url: null })
    const top = m.top[0]
    if (top) out.push({ kind: 'manutenzione', text: `Il più grande: «${top.subject}», ${formatEuro(top.amount)} nel ${top.year} (CIG ${top.cig})`, source: p.sources.anac, url: null })
  }
  return out
}
