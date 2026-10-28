// Etichette e moduli di segmenti e prospect.

export type Market = 'IT' | 'ES' | 'FR' | 'US' | 'CA' | 'CH' | 'DE' | 'AT'
export type QuerySource = 'places' | 'it_registry' | 'fr_registry' | 'it_comuni'
export type ProspectSource = QuerySource | 'manual'
export type SegmentStatus = 'proposed' | 'active' | 'paused'
export type ProspectStatus = 'new' | 'qualified' | 'discarded'
export type WorkStatus = 'queued' | 'running' | 'done' | 'failed'
export type LegalBasis = 'consent' | 'existing_customer' | 'b2b_optout' | 'public_office' | 'inbound_only'
export type PoliticalSide = 'centrodestra' | 'centrosinistra' | 'civica'
type BadgeColor = 'neutral' | 'info' | 'success' | 'error' | 'warning' | 'primary'

export const MARKET_LABEL: Record<Market, string> = {
  IT: 'Italia',
  ES: 'Spagna',
  FR: 'Francia',
  US: 'USA',
  CA: 'Canada',
  CH: 'Svizzera',
  DE: 'Germania',
  AT: 'Austria',
}

export const QUERY_SOURCE_LABEL: Record<ProspectSource, string> = {
  places: 'Google Maps',
  it_registry: 'Registro Imprese',
  fr_registry: 'Registro francese',
  it_comuni: 'Comuni italiani',
  manual: 'A mano',
}

export const IT_REGIONS = [
  'Piemonte', 'Valle d\'Aosta', 'Lombardia', 'Trentino-Alto Adige', 'Veneto', 'Friuli-Venezia Giulia',
  'Liguria', 'Emilia-Romagna', 'Toscana', 'Umbria', 'Marche', 'Lazio', 'Abruzzo', 'Molise', 'Campania',
  'Puglia', 'Basilicata', 'Calabria', 'Sicilia', 'Sardegna',
]

export const POLITICAL_SIDE_LABEL: Record<PoliticalSide, string> = {
  centrodestra: 'Centrodestra',
  centrosinistra: 'Centrosinistra',
  civica: 'Civica o non chiara',
}

export type LinkedinActivity = 'attivo' | 'poco_attivo' | 'assente'

export const LINKEDIN_LABEL: Record<LinkedinActivity, string> = {
  attivo: 'attivo',
  poco_attivo: 'poco attivo',
  assente: 'nessun profilo trovato',
}

export type SignalKind = 'rigenerazione' | 'digitale' | 'segnalazioni' | 'manutenzione'

export const SIGNAL_KIND_LABEL: Record<SignalKind, string> = {
  rigenerazione: 'Rigenerazione urbana',
  digitale: 'Digitale',
  segnalazioni: 'Segnalazioni oggi',
  manutenzione: 'Manutenzione affidata',
}

/** Centrodestra in nero, centrosinistra in rosso, civica in grigio. */
export const POLITICAL_SIDE_DOT: Record<PoliticalSide, string> = {
  centrodestra: 'bg-black ring-1 ring-neutral-400',
  centrosinistra: 'bg-red-600',
  civica: 'bg-neutral-400',
}

export const isComune = (p: { source: ProspectSource }) => p.source === 'it_comuni'

interface SubtitleFields {
  source: ProspectSource
  city: string | null
  region: string | null
  population: number | null
  electedAt: string | null
  employeesMin: number | null
  employeesMax: number | null
}

/** La seconda riga nelle liste: provincia, abitanti e giunta di un Comune, città e dipendenti di un'azienda. */
export function prospectSubtitle(p: SubtitleFields): string {
  if (isComune(p)) {
    return [
      p.region,
      p.population === null ? null : `${formatNumber(p.population)} abitanti`,
      p.electedAt ? `giunta eletta a ${formatMonth(p.electedAt)}` : 'senza giunta eletta',
    ].filter(Boolean).join(' · ')
  }
  const staff = employeesText(p.employeesMin, p.employeesMax)
  return [[p.city, p.region].filter(Boolean).join(', '), staff && `${staff} dip.`].filter(Boolean).join(' · ')
}

export const SEGMENT_STATUS_LABEL: Record<SegmentStatus, string> = {
  proposed: 'Proposto',
  active: 'Attivo',
  paused: 'In pausa',
}

export const SEGMENT_STATUS_COLOR: Record<SegmentStatus, BadgeColor> = {
  proposed: 'info',
  active: 'success',
  paused: 'neutral',
}

export const PROSPECT_STATUS_LABEL: Record<ProspectStatus, string> = {
  new: 'Da guardare',
  qualified: 'Qualificato',
  discarded: 'Scartato',
}

export const PROSPECT_STATUS_COLOR: Record<ProspectStatus, BadgeColor> = {
  new: 'neutral',
  qualified: 'success',
  discarded: 'neutral',
}

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  queued: 'In coda',
  running: 'In corso',
  done: 'Fatto',
  failed: 'Non riuscito',
}

export const WORK_STATUS_COLOR: Record<WorkStatus, BadgeColor> = {
  queued: 'neutral',
  running: 'info',
  done: 'success',
  failed: 'error',
}

export const LEGAL_BASIS_LABEL: Record<LegalBasis, string> = {
  consent: 'Consenso',
  existing_customer: 'Cliente (soft spam)',
  b2b_optout: 'B2B con opt-out, dove ammesso',
  public_office: 'Amministratore pubblico, indirizzo istituzionale',
  inbound_only: 'Solo inbound',
}

export const SEVERITY_COLOR: Record<1 | 2 | 3, BadgeColor> = { 1: 'neutral', 2: 'warning', 3: 'error' }

export function scoreColor(score: number | null): BadgeColor {
  if (score === null) return 'neutral'
  return score >= 60 ? 'success' : score >= 40 ? 'warning' : 'neutral'
}

export function employeesText(min: number | null, max: number | null): string {
  if (min === null && max === null) return ''
  if (min !== null && max === null) return `${min}+`
  if (min === null) return `fino a ${max}`
  return min === max ? String(min) : `${min}-${max}`
}

export const optionsOf = <K extends string>(labels: Record<K, string>) =>
  (Object.keys(labels) as K[]).map(value => ({ value, label: labels[value] }))

/** Una ricerca nel modulo: tutti i campi di tutte le fonti, si tengono quelli della fonte scelta. */
export interface QueryForm {
  source: QuerySource
  text: string
  atecoCode: string
  province: string
  minEmployees: number | null
  maxEmployees: number | null
  naf: string
  departement: string
  /** all: tutta Italia. */
  region: string
  minPopulation: number | null
  maxPopulation: number | null
  limit: number
}

export interface SegmentForm {
  name: string
  market: Market
  sector: string
  description: string
  notes: string
  queries: QueryForm[]
}

const DEFAULT_LIMIT: Record<QuerySource, number> = { places: 20, it_registry: 25, fr_registry: 50, it_comuni: 300 }
export const QUERY_LIMIT_MAX: Record<QuerySource, number> = {
  places: 60,
  it_registry: 200,
  fr_registry: 200,
  it_comuni: 8000,
}

export function emptyQuery(source: QuerySource = 'places'): QueryForm {
  return { source, text: '', atecoCode: '', province: '', minEmployees: null, maxEmployees: null, naf: '', departement: '', region: 'all', minPopulation: null, maxPopulation: null, limit: DEFAULT_LIMIT[source] }
}

export function emptySegmentForm(): SegmentForm {
  return { name: '', market: 'IT', sector: '', description: '', notes: '', queries: [emptyQuery()] }
}

type ApiQuery = { source: QuerySource, limit: number } & Record<string, string | number | undefined>

export function toSegmentForm(s: { name: string, market: Market, sector: string, description: string, notes: string, queries: ApiQuery[] }): SegmentForm {
  return {
    name: s.name,
    market: s.market,
    sector: s.sector,
    description: s.description,
    notes: s.notes,
    queries: s.queries.map(q => ({ ...emptyQuery(q.source), ...q }) as QueryForm),
  }
}

export function fromSegmentForm(form: SegmentForm) {
  const text = (v: string) => v.trim() || undefined
  const num = (v: number | null) => (v === null || Number.isNaN(v) ? undefined : v)
  return {
    ...form,
    queries: form.queries.map((q) => {
      if (q.source === 'places') return { source: q.source, text: q.text.trim(), limit: q.limit }
      if (q.source === 'it_registry') {
        return { source: q.source, atecoCode: q.atecoCode.trim(), province: text(q.province.toUpperCase()), minEmployees: num(q.minEmployees), maxEmployees: num(q.maxEmployees), limit: q.limit }
      }
      if (q.source === 'it_comuni') {
        return { source: q.source, region: q.region === 'all' ? undefined : q.region, province: text(q.province.toUpperCase()), minPopulation: num(q.minPopulation), maxPopulation: num(q.maxPopulation), limit: q.limit }
      }
      return { source: q.source, naf: q.naf.trim().toUpperCase(), departement: text(q.departement.toUpperCase()), minEmployees: num(q.minEmployees), maxEmployees: num(q.maxEmployees), limit: q.limit }
    }),
  }
}

/** Una riga leggibile per una ricerca. */
export function queryText(q: ApiQuery): string {
  if (q.source === 'places') return `«${q.text}»`
  if (q.source === 'it_comuni') {
    const people = q.minPopulation !== undefined || q.maxPopulation !== undefined ? `, ${q.minPopulation ?? 0}-${q.maxPopulation ?? '?'} abitanti` : ''
    return `${[q.region, q.province].filter(Boolean).join(' ') || 'tutta Italia'}${people}`
  }
  const staff = q.minEmployees !== undefined || q.maxEmployees !== undefined ? `, ${q.minEmployees ?? 0}-${q.maxEmployees ?? '?'} dipendenti` : ''
  if (q.source === 'it_registry') return `ATECO ${q.atecoCode}${q.province ? ` in ${q.province}` : ''}${staff}`
  return `NAF ${q.naf}${q.departement ? ` nel ${q.departement}` : ''}${staff}`
}
