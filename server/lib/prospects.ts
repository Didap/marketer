import { and, asc, desc, eq, getTableColumns, inArray, like, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db/client'
import type { Audit, AuditIssue, Job, JobSource, Market, Prospect, ProspectContact, ProspectSource, ProspectStatus, Search, Segment, SegmentStatus, StackItem } from '../db/schema'
import { audits, jobs, LEGAL_BASES, LINKEDIN_ACTIVITY, MARKETS, portfolioItems, prospectContacts, prospects, searches, segments } from '../db/schema'
import { isComune, istatCode, istatId, IT_REGIONS, nameKey, personKey, searchComuni } from './comuni'
import type { SitePerson } from './contacts'
import { cityfixAngle } from './contacts'
import { enqueueJob, logActivity } from './jobs'
import { COMUNE_FIT_MAX, comuneFit, scoreProspect, segmentScore } from './scoring'
import type { ComuneProfile, Reporting, SignalsFile } from './signals'
import { comuneSignals } from './signals'
import type { Fetcher, FoundCompany, FoundContact, SourceResult } from './sources'
import { enrichFromPlace, findOnPlaces, normalizeWebsite, searchFrRegistry, searchItRegistry, searchPlaces, siteDomain, sourcesAvailable } from './sources'

// Segmenti, ricerche, prospect e audit. Le ricerche e gli audit li fa il worker, senza LLM;
// un job di Opus propone i segmenti partendo dal portfolio, e William li accende.

export class ProspectError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'INVALID_INPUT' | 'SOURCE_OFF' | 'NO_QUERIES' | 'SEARCH_RUNNING' | 'NO_WEBSITE' | 'PROPOSAL_RUNNING', message: string) {
    super(message)
  }
}

export const SEGMENT_JOB_KIND = 'segment_proposal'

export const SOURCE_LABEL = { places: 'Google Maps', it_registry: 'Registro Imprese', fr_registry: 'registro francese', it_comuni: 'Comuni italiani', manual: 'a mano' } as const

// Niente transform né refine: lo schema passa così com'è al server MCP, che lo converte in JSON Schema.
export const segmentQuery = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('places'),
    text: z.string().trim().min(3).max(200).describe('Ricerca come su Google Maps, con la zona (es. studio consulenza del lavoro Lecce)'),
    limit: z.number().int().min(1).max(60).default(20).describe('Risultati al massimo: ogni 20 è una chiamata a pagamento'),
  }),
  z.object({
    source: z.literal('it_registry'),
    atecoCode: z.string().trim().regex(/^\d{2}(?:\.?\d{1,2}){0,2}$/, 'codice ATECO, es. 69.20').describe('Codice ATECO (es. 69.20)'),
    province: z.string().trim().regex(/^[A-Z]{2}$/, 'sigla in maiuscolo, es. LE').optional().describe('Sigla della provincia (es. LE)'),
    minEmployees: z.number().int().min(0).optional(),
    maxEmployees: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(200).default(25).describe('Aziende al massimo: OpenAPI.it fa pagare a record'),
  }),
  z.object({
    source: z.literal('fr_registry'),
    naf: z.string().trim().regex(/^\d{2}\.\d{2}[A-Z]$/, 'codice NAF, es. 69.20Z').describe('Codice NAF (es. 69.20Z)'),
    departement: z.string().trim().regex(/^(?:\d{2,3}|2A|2B)$/, 'dipartimento, es. 69').optional().describe('Dipartimento della sede (es. 69)'),
    minEmployees: z.number().int().min(0).optional(),
    maxEmployees: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  z.object({
    source: z.literal('it_comuni'),
    region: z.enum(IT_REGIONS).optional().describe('Regione (es. Puglia)'),
    province: z.string().trim().regex(/^[A-Z]{2}$/, 'sigla in maiuscolo, es. LE').optional().describe('Sigla della provincia (es. LE)'),
    minPopulation: z.number().int().min(0).optional(),
    maxPopulation: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(8000).default(300).describe('Comuni al massimo, dai più popolosi: la fonte è gratuita'),
  }),
])

export const segmentFields = z.object({
  name: z.string().trim().min(1).max(120),
  market: z.enum(MARKETS).describe('Paese: IT, ES, FR, US, CA, CH, DE, AT'),
  sector: z.string().trim().min(1).max(120).describe('Settore in italiano, con le parole dei settori del portfolio (es. consulenza del lavoro)'),
  description: z.string().trim().max(1000).default('').describe('Perché è un buon bersaglio per didap e quale voce del portfolio fa da prova, in due frasi'),
  queries: z.array(segmentQuery).max(10).default([]).describe('Le ricerche da fare sulle fonti'),
})

export const segmentEditInput = segmentFields.extend({
  notes: z.string().trim().max(4000).default(''),
})

export const prospectEditInput = z.object({
  website: z.string().trim().max(400).nullable(),
  phone: z.string().trim().max(60).nullable(),
  legalBasis: z.enum(LEGAL_BASES),
  notes: z.string().trim().max(4000).default(''),
})

// Segmenti.

export function getSegment(db: Db, id: number): Segment {
  const segment = db.select().from(segments).where(eq(segments.id, id)).get()
  if (!segment) throw new ProspectError('NOT_FOUND', `Il segmento ${id} non esiste`)
  return segment
}

export function createSegment(db: Db, raw: z.input<typeof segmentEditInput>, opts: { status?: SegmentStatus, jobId?: number | null } = {}): Segment {
  const fields = segmentEditInput.parse(raw)
  return db.insert(segments).values({
    ...fields,
    sector: fields.sector.toLowerCase(),
    status: opts.status ?? 'active',
    jobId: opts.jobId ?? null,
  }).returning().get()
}

export function updateSegment(db: Db, id: number, raw: z.input<typeof segmentEditInput>): Segment {
  getSegment(db, id)
  const fields = segmentEditInput.parse(raw)
  return db.update(segments).set({ ...fields, sector: fields.sector.toLowerCase(), updatedAt: new Date() })
    .where(eq(segments.id, id)).returning().get()!
}

export function setSegmentStatus(db: Db, id: number, status: SegmentStatus): Segment {
  getSegment(db, id)
  return db.update(segments).set({ status, updatedAt: new Date() }).where(eq(segments.id, id)).returning().get()!
}

export interface SegmentView extends Segment {
  prospects: number
  audited: number
  qualified: number
  score: number | null
  lastSearch: Pick<Search, 'id' | 'status' | 'createdAt' | 'finishedAt' | 'error'> | null
}

/** I segmenti con i loro numeri, dal punteggio più alto. */
export function listSegments(db: Db, opts: { status?: SegmentStatus } = {}): SegmentView[] {
  const rows = db.select().from(segments).where(opts.status ? eq(segments.status, opts.status) : undefined).all()
  const scored = db.select({ segmentId: prospects.segmentId, score: prospects.score, status: prospects.status })
    .from(prospects).where(ne(prospects.status, 'discarded')).all()
  const audited = new Map(db.all<{ segmentId: number, n: number }>(sql`
    select p.segment_id as segmentId, count(distinct a.prospect_id) as n
    from audits a join prospects p on p.id = a.prospect_id
    where a.status = 'done' group by p.segment_id`).map(r => [r.segmentId, r.n]))
  const last = new Map<number, SegmentView['lastSearch']>()
  for (const s of db.select({ id: searches.id, segmentId: searches.segmentId, status: searches.status, createdAt: searches.createdAt, finishedAt: searches.finishedAt, error: searches.error })
    .from(searches).orderBy(asc(searches.id)).all()) {
    const { segmentId, ...rest } = s
    last.set(segmentId, rest)
  }
  return rows.map((segment) => {
    const own = scored.filter(p => p.segmentId === segment.id)
    return {
      ...segment,
      prospects: own.length,
      audited: audited.get(segment.id) ?? 0,
      qualified: own.filter(p => p.status === 'qualified').length,
      score: segmentScore(own.map(p => p.score)),
      lastSearch: last.get(segment.id) ?? null,
    }
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.id - a.id)
}

// Ricerche.

export function listSearches(db: Db, segmentId: number, limit = 20): Search[] {
  return db.select().from(searches).where(eq(searches.segmentId, segmentId)).orderBy(desc(searches.id)).limit(limit).all()
}

/** Mette in coda una ricerca per ogni query del segmento. Le fonti spente si dicono subito. */
export function enqueueSearch(db: Db, segmentId: number): Search[] {
  const segment = getSegment(db, segmentId)
  if (!segment.queries.length) throw new ProspectError('NO_QUERIES', 'Il segmento non ha ricerche: aggiungine almeno una')
  const busy = db.select({ id: searches.id }).from(searches)
    .where(and(eq(searches.segmentId, segmentId), inArray(searches.status, ['queued', 'running']))).get()
  if (busy) throw new ProspectError('SEARCH_RUNNING', 'C\'è già una ricerca in corso per questo segmento')
  const available = sourcesAvailable()
  const off = [...new Set(segment.queries.filter(q => !available[q.source]).map(q => SOURCE_LABEL[q.source]))]
  if (off.length) throw new ProspectError('SOURCE_OFF', `Fonti spente, manca la chiave in .env: ${off.join(', ')}`)
  return segment.queries.map(query => db.insert(searches).values({ segmentId, query }).returning().get())
}

/** La prossima ricerca in coda, già segnata in corso. */
export function claimNextSearch(db: Db): Search | undefined {
  const next = db.select().from(searches).where(eq(searches.status, 'queued')).orderBy(asc(searches.id)).limit(1).get()
  if (!next) return undefined
  return db.update(searches).set({ status: 'running', startedAt: new Date() })
    .where(and(eq(searches.id, next.id), eq(searches.status, 'queued'))).returning().get()
}

function runSource(search: Search, market: Market, fetcher: Fetcher): Promise<SourceResult> {
  const q = search.query
  if (q.source === 'places') return searchPlaces(q, market, fetcher)
  if (q.source === 'it_registry') return searchItRegistry(q, fetcher)
  if (q.source === 'it_comuni') return searchComuni(q, fetcher)
  return searchFrRegistry(q, fetcher)
}

/**
 * Esegue una ricerca: legge la fonte, cerca su Google Maps il sito delle aziende dei registri
 * (se Places è acceso), salva i prospect, mette in coda gli audit e ricalcola i punteggi.
 */
export async function runSearch(db: Db, search: Search, fetcher: Fetcher = fetch): Promise<Search> {
  const segment = getSegment(db, search.segmentId)
  try {
    const result = await runSource(search, segment.market, fetcher)
    let paidCalls = result.paidCalls
    // I Comuni hanno già il sito da IndicePA: per loro niente chiamate a pagamento.
    let placesUsable = !['places', 'it_comuni'].includes(search.query.source) && sourcesAvailable().places
    const ids: number[] = []
    let added = 0
    for (let company of result.companies) {
      if (placesUsable && !company.website && !company.placeId && !findExisting(db, company)) {
        try {
          const place = await findOnPlaces(company, segment.market, fetcher)
          paidCalls++
          if (place) company = enrichFromPlace(company, place)
        }
        catch {
          // Places non risponde: si va avanti senza sito, e senza altre chiamate.
          placesUsable = false
        }
      }
      const { id, created } = upsertProspect(db, company, segment.id)
      ids.push(id)
      if (created) added++
    }
    enqueueMissingAudits(db, ids)
    rescoreProspects(db, ids)
    logActivity(db, `Ricerca «${segment.name}» su ${SOURCE_LABEL[search.query.source]}: ${result.companies.length} aziende, ${added} nuove`)
    return db.update(searches).set({ status: 'done', found: result.companies.length, added, paidCalls, finishedAt: new Date() })
      .where(eq(searches.id, search.id)).returning().get()!
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logActivity(db, `Ricerca «${segment.name}» su ${SOURCE_LABEL[search.query.source]} non riuscita: ${message}`)
    return db.update(searches).set({ status: 'failed', error: message.slice(0, 1000), finishedAt: new Date() })
      .where(eq(searches.id, search.id)).returning().get()!
  }
}

// Prospect.

/** La stessa azienda già salvata: per registro, per scheda di Google Maps o per dominio del sito. */
export function findExisting(db: Db, company: Pick<FoundCompany, 'registryId' | 'placeId' | 'website'>): Prospect | undefined {
  const domain = siteDomain(company.website)
  const keys = [
    company.registryId ? eq(prospects.registryId, company.registryId) : undefined,
    company.placeId ? eq(prospects.placeId, company.placeId) : undefined,
    domain ? inArray(prospects.website, [`https://${domain}`, `http://${domain}`, `https://www.${domain}`, `http://www.${domain}`]) : undefined,
  ].filter(k => k !== undefined)
  if (!keys.length) return undefined
  return db.select().from(prospects).where(or(...keys)).orderBy(asc(prospects.id)).limit(1).get()
}

const FILLABLE = ['city', 'region', 'address', 'website', 'phone', 'registryId', 'placeId', 'sectorCode', 'sectorLabel', 'employeesMin', 'employeesMax', 'foundedAt', 'email'] as const
/** Cambiano con le elezioni: la fonte dei Comuni li riscrive a ogni ricerca. */
const ELECTORAL = ['population', 'electedAt', 'politicalSide'] as const

/** Un prospect nuovo si scrive; uno che c'è già prende solo i dati che gli mancavano. */
export function upsertProspect(db: Db, found: FoundCompany, segmentId: number | null): { id: number, created: boolean } {
  const { contacts, ...company } = found
  // Un Comune si riconosce solo dal codice ISTAT: più Comuni possono avere il sito sullo stesso hosting.
  const existing = findExisting(db, isComune(company) ? { ...company, website: null } : company)
  if (!existing) {
    const row = db.insert(prospects).values({ ...company, segmentId }).returning({ id: prospects.id }).get()
    if (contacts) replaceContacts(db, row.id, company.source, contacts)
    return { id: row.id, created: true }
  }
  const set: Partial<typeof prospects.$inferInsert> = {}
  for (const key of FILLABLE) {
    if (existing[key] === null && company[key] != null) Object.assign(set, { [key]: company[key] })
  }
  if (isComune(company)) {
    for (const key of ELECTORAL) {
      if (existing[key] !== (company[key] ?? null)) Object.assign(set, { [key]: company[key] ?? null })
    }
  }
  // Una chiave che appartiene già a un altro prospect non si sposta.
  if (set.registryId && db.select({ id: prospects.id }).from(prospects).where(eq(prospects.registryId, set.registryId)).get()) delete set.registryId
  if (set.placeId && db.select({ id: prospects.id }).from(prospects).where(eq(prospects.placeId, set.placeId)).get()) delete set.placeId
  if (Object.keys(set).length) {
    db.update(prospects).set({ ...set, segmentId: existing.segmentId ?? segmentId, updatedAt: new Date() }).where(eq(prospects.id, existing.id)).run()
  }
  if (contacts) replaceContacts(db, existing.id, company.source, contacts)
  return { id: existing.id, created: false }
}

/** Le persone come le dà adesso la fonte: quelle trovate prima dalla stessa fonte si tolgono. */
function replaceContacts(db: Db, prospectId: number, source: ProspectSource, contacts: FoundContact[]) {
  db.transaction((tx) => {
    const where = and(eq(prospectContacts.prospectId, prospectId), eq(prospectContacts.source, source))
    // Email e deleghe trovate sul sito restano a chi è ancora in giunta.
    const known = new Map(tx.select().from(prospectContacts).where(where).all().map(c => [personKey(c.name), c]))
    tx.delete(prospectContacts).where(where).run()
    if (contacts.length) {
      tx.insert(prospectContacts).values(contacts.map((c) => {
        const old = known.get(personKey(c.name))
        // Quello che si è saputo dal sito e da LinkedIn resta alla persona; quello che dà la fonte è più fresco.
        const { id: _id, createdAt: _c, ...kept } = old ?? {} as Partial<ProspectContact>
        return { ...kept, ...c, prospectId, source }
      })).run()
    }
  })
}

/** Le persone di un prospect, con il perché contano per CityFix. */
export function listContacts(db: Db, prospectId: number) {
  return db.select().from(prospectContacts).where(eq(prospectContacts.prospectId, prospectId)).orderBy(asc(prospectContacts.id)).all()
    .map(c => ({ ...c, angles: cityfixAngle(c.delegations) }))
}

/** Email e deleghe trovate sul sito; chi resta senza niente si dice, e conserva quello che aveva. */
export function enrichContacts(db: Db, people: SitePerson[]): { updated: number, notFound: string[] } {
  const found = people.filter(p => p.email || p.delegations)
  db.transaction((tx) => {
    for (const p of found) {
      const set = { sourceUrl: p.sourceUrl, ...(p.email && { email: p.email }), ...(p.delegations && { delegations: p.delegations }) }
      tx.update(prospectContacts).set(set).where(eq(prospectContacts.id, p.id)).run()
    }
  })
  return { updated: found.length, notFound: people.filter(p => !found.includes(p)).map(p => p.name) }
}

export const linkedinInput = z.object({
  prospectId: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).describe('Il nome della persona come in prospect_get'),
  url: z.string().trim().regex(/^https:\/\/([a-z]{1,3}\.)?linkedin\.com\/in\/[^/?#\s]+/i, 'un profilo linkedin.com/in/...').nullable(),
  activity: z.enum(LINKEDIN_ACTIVITY),
  note: z.string().trim().min(1).max(400).describe('Cosa hai visto: il titolo del profilo, la data dei post più recenti, o perché non è suo'),
})

/** Quello che il job ha visto di una persona su LinkedIn; per nome, perché gli id cambiano a ogni ricerca. */
export function saveLinkedin(db: Db, raw: z.input<typeof linkedinInput>) {
  const { prospectId, name, url, activity, note } = linkedinInput.parse(raw)
  if ((activity === 'assente') !== (url === null)) throw new ProspectError('INVALID_INPUT', activity === 'assente' ? 'Un profilo assente non ha indirizzo' : 'Un profilo attivo o poco attivo ha il suo indirizzo')
  const contact = db.select({ id: prospectContacts.id, name: prospectContacts.name }).from(prospectContacts)
    .where(eq(prospectContacts.prospectId, prospectId)).all().find(c => personKey(c.name) === personKey(name))
  if (!contact) throw new ProspectError('NOT_FOUND', `${name} non è tra le persone del prospect ${prospectId}`)
  return db.update(prospectContacts).set({ linkedinUrl: url, linkedinActivity: activity, linkedinNote: note, linkedinCheckedAt: new Date() })
    .where(eq(prospectContacts.id, contact.id)).returning().get()!
}

/** Un Comune già trovato, per nome. */
export function findComune(db: Db, name: string): Pick<Prospect, 'id' | 'name' | 'website'> | undefined {
  return db.select({ id: prospects.id, name: prospects.name, website: prospects.website, city: prospects.city }).from(prospects)
    .where(eq(prospects.source, 'it_comuni')).all().find(p => nameKey(p.city ?? '') === nameKey(name))
}

// Le liste non portano il profilo dei Comuni: pesa, e la dashboard le rilegge ogni pochi secondi.
const { profile: _profile, ...listColumns } = getTableColumns(prospects)

export interface ProspectRow extends Omit<Prospect, 'profile'> {
  segmentName: string | null
  auditStatus: Audit['status'] | null
  issues: number
}

export function listProspects(db: Db, opts: { segmentId?: number, status?: ProspectStatus, q?: string, minScore?: number, limit?: number } = {}): ProspectRow[] {
  const q = opts.q?.trim()
  const latestAudit = sql<number | null>`(select max(a.id) from audits a where a.prospect_id = ${prospects.id})`
  const rows = db.select({
    prospect: listColumns,
    segmentName: segments.name,
    auditStatus: sql<Audit['status'] | null>`(select status from audits where id = ${latestAudit})`,
    issues: sql<number>`coalesce((select json_array_length(issues) from audits where id = (select max(a.id) from audits a where a.prospect_id = ${prospects.id} and a.status = 'done')), 0)`,
  })
    .from(prospects)
    .leftJoin(segments, eq(segments.id, prospects.segmentId))
    .where(and(
      opts.segmentId ? eq(prospects.segmentId, opts.segmentId) : undefined,
      opts.status ? eq(prospects.status, opts.status) : undefined,
      opts.minScore !== undefined ? sql`${prospects.score} >= ${opts.minScore}` : undefined,
      q ? or(like(prospects.name, `%${q}%`), like(prospects.city, `%${q}%`), like(prospects.website, `%${q}%`)) : undefined,
    ))
    .orderBy(sql`${prospects.score} is null`, desc(prospects.score), asc(prospects.name))
    .limit(opts.limit ?? 500)
    .all()
  return rows.map(r => ({ ...r.prospect, segmentName: r.segmentName, auditStatus: r.auditStatus, issues: r.issues }))
}

export function getProspect(db: Db, id: number): Prospect {
  const prospect = db.select().from(prospects).where(eq(prospects.id, id)).get()
  if (!prospect) throw new ProspectError('NOT_FOUND', `Il prospect ${id} non esiste`)
  return prospect
}

/** Il prospect con il segmento, le persone, gli ultimi audit e, per un Comune, fit e fatti da citare. */
export function prospectDetail(db: Db, id: number) {
  const { profile, ...prospect } = getProspect(db, id)
  const comune = profile && { fit: comuneFit(profile), max: COMUNE_FIT_MAX, signals: comuneSignals(profile), collectedAt: profile.collectedAt }
  const segment = prospect.segmentId ? db.select().from(segments).where(eq(segments.id, prospect.segmentId)).get() ?? null : null
  const contacts = listContacts(db, id)
  const history = db.select().from(audits).where(eq(audits.prospectId, id)).orderBy(desc(audits.id)).limit(5).all()
  return { prospect, segment, contacts, comune, audits: history, audit: history.find(a => a.status === 'done') ?? null }
}

// Segnali dei Comuni dai dati aperti (pnpm segnali).

/** I Comuni del file già tra i prospect, con il sito da leggere. */
export function signalTargets(db: Db, file: SignalsFile) {
  return db.select({ id: prospects.id, registryId: prospects.registryId, city: prospects.city, website: prospects.website, population: prospects.population })
    .from(prospects).where(inArray(prospects.registryId, Object.keys(file.comuni).map(istatId))).all()
}

/** Percentile da 0 a 1 tra i valori positivi; zero resta zero. */
function percentile(values: Map<number, number>): Map<number, number> {
  const positive = [...values.values()].filter(v => v > 0).sort((a, b) => a - b)
  return new Map([...values].map(([id, v]) => [id, v > 0 ? (positive.indexOf(v) + 1) / positive.length : 0]))
}

/**
 * Salva i segnali nei Comuni già trovati e ne rifà il punteggio. Rigenerazione e manutenzione diventano
 * un percentile tra i Comuni del file: metà per abitante (l'impegno di un borgo) e metà assoluto (la massa
 * di una città), così né i Comuni piccolissimi né le città vincono da soli.
 */
export function importSignals(db: Db, file: SignalsFile, sites: Map<number, { reporting: Reporting | null, modelSite: boolean }>): { updated: number, missing: number } {
  const targets = signalTargets(db, file)
  const data = new Map(targets.map(t => [t.id, file.comuni[istatCode(t.registryId!)]!]))
  const blended = (value: (c: SignalsFile['comuni'][string]) => number) => {
    const absolute = percentile(new Map([...data].map(([id, c]) => [id, value(c)])))
    const perHead = percentile(new Map(targets.map(t => [t.id, value(data.get(t.id)!) / Math.max(1, t.population ?? 1)])))
    return (id: number) => Math.round((absolute.get(id)! + perHead.get(id)!) * 500) / 1000
  }
  const regenRank = blended(c => c.regeneration.amount)
  // Il bisogno è quanti interventi affida, non quanto spende.
  const maintRank = blended(c => c.maintenance.contracts)
  db.transaction((tx) => {
    for (const [id, c] of data) {
      const site = sites.get(id) ?? { reporting: null, modelSite: false }
      const profile: ComuneProfile = {
        collectedAt: file.collectedAt,
        sinceYear: file.sinceYear,
        sources: file.sources,
        regeneration: { ...c.regeneration, rank: regenRank(id) },
        digital: { ...c.digital, modelSite: site.modelSite },
        reporting: site.reporting,
        maintenance: { ...c.maintenance, rank: maintRank(id) },
      }
      tx.update(prospects).set({ profile, updatedAt: new Date() }).where(eq(prospects.id, id)).run()
    }
  })
  rescoreProspects(db, [...data.keys()])
  logActivity(db, `Segnali dei Comuni (${file.region}, ${file.collectedAt}): ${data.size} aggiornati`)
  return { updated: data.size, missing: Object.keys(file.comuni).length - data.size }
}

/** Correzione di William. Se cambia il sito, l'audit si rifà. */
export function updateProspect(db: Db, id: number, raw: z.input<typeof prospectEditInput>): Prospect {
  const before = getProspect(db, id)
  const input = prospectEditInput.parse(raw)
  const website = input.website ? normalizeWebsite(input.website) : null
  if (input.website && !website) throw new ProspectError('INVALID_INPUT', `Non è l'indirizzo di un sito: ${input.website}`)
  const row = db.update(prospects).set({ ...input, website, phone: input.phone || null, updatedAt: new Date() })
    .where(eq(prospects.id, id)).returning().get()!
  if (website && website !== before.website) enqueueAudit(db, id)
  rescoreProspects(db, [id])
  return getProspect(db, row.id)
}

export function setProspectStatus(db: Db, id: number, status: ProspectStatus): Prospect {
  getProspect(db, id)
  return db.update(prospects).set({ status, updatedAt: new Date() }).where(eq(prospects.id, id)).returning().get()!
}

// Audit.

/** In coda un audit del sito; se ce n'è già uno in coda o in corso, quello. */
export function enqueueAudit(db: Db, prospectId: number): Audit {
  const prospect = getProspect(db, prospectId)
  if (!prospect.website) throw new ProspectError('NO_WEBSITE', 'Il prospect non ha un sito da analizzare')
  const pending = db.select().from(audits)
    .where(and(eq(audits.prospectId, prospectId), inArray(audits.status, ['queued', 'running']))).get()
  return pending ?? db.insert(audits).values({ prospectId, url: prospect.website }).returning().get()
}

/** Audit per i prospect con un sito e senza audit. */
export function enqueueMissingAudits(db: Db, ids: number[]): number {
  if (!ids.length) return 0
  const todo = db.select({ id: prospects.id }).from(prospects)
    .where(and(inArray(prospects.id, ids), sql`${prospects.website} is not null`, sql`not exists (select 1 from audits a where a.prospect_id = ${prospects.id})`))
    .all()
  for (const { id } of todo) enqueueAudit(db, id)
  return todo.length
}

export function claimNextAudit(db: Db): Audit | undefined {
  const next = db.select().from(audits).where(eq(audits.status, 'queued')).orderBy(asc(audits.id)).limit(1).get()
  if (!next) return undefined
  return db.update(audits).set({ status: 'running', startedAt: new Date() })
    .where(and(eq(audits.id, next.id), eq(audits.status, 'queued'))).returning().get()
}

export interface AuditResult {
  finalUrl: string
  https: boolean
  mobile: boolean
  performance: number | null
  accessibility: number | null
  seo: number | null
  bestPractices: number | null
  lcpMs: number | null
  stack: StackItem[]
  hasForm: boolean
  hasBooking: boolean
  issues: AuditIssue[]
  /** Lighthouse non è riuscito: le altre verifiche valgono lo stesso. */
  error: string | null
}

export function finishAudit(db: Db, id: number, result: AuditResult): Audit {
  const row = db.update(audits).set({ ...result, status: 'done', finishedAt: new Date() }).where(eq(audits.id, id)).returning().get()!
  rescoreProspects(db, [row.prospectId])
  return row
}

export function failAudit(db: Db, id: number, error: string): Audit {
  return db.update(audits).set({ status: 'failed', error: error.slice(0, 1000), finishedAt: new Date() }).where(eq(audits.id, id)).returning().get()!
}

/** Ricerche e audit rimasti in corso da una vita precedente del worker tornano in coda. */
export function requeueInterrupted(db: Db): { searches: number, audits: number } {
  const s = db.update(searches).set({ status: 'queued', startedAt: null }).where(eq(searches.status, 'running')).returning({ id: searches.id }).all()
  const a = db.update(audits).set({ status: 'queued', startedAt: null }).where(eq(audits.status, 'running')).returning({ id: audits.id }).all()
  return { searches: s.length, audits: a.length }
}

// Punteggi.

/** Il settore compare tra quelli delle voci confermate del portfolio: null se non ce ne sono. */
export function portfolioMatcher(db: Db): (sector: string) => boolean | null {
  const sectors = new Set(db.select({ sectors: portfolioItems.sectors }).from(portfolioItems)
    .where(eq(portfolioItems.status, 'approved')).all().flatMap(r => r.sectors))
  if (!sectors.size) return () => null
  return sector => [...sectors].some(s => s === sector || s.includes(sector) || sector.includes(s))
}

/** Ricalcola i punteggi dei prospect indicati, o di tutti. */
export function rescoreProspects(db: Db, ids?: number[]): number {
  if (ids && !ids.length) return 0
  const match = portfolioMatcher(db)
  const sectorOf = new Map(db.select({ id: segments.id, sector: segments.sector }).from(segments).all().map(s => [s.id, s.sector]))
  const rows = db.select().from(prospects).where(ids ? inArray(prospects.id, ids) : undefined).all()
  const lastAudits = new Map(db.select().from(audits)
    .where(and(eq(audits.status, 'done'), ids ? inArray(audits.prospectId, ids) : undefined))
    .orderBy(asc(audits.id)).all().map(a => [a.prospectId, a]))
  const today = new Date()
  db.transaction((tx) => {
    for (const p of rows) {
      const sector = p.segmentId ? sectorOf.get(p.segmentId) : undefined
      const s = scoreProspect({ prospect: p, audit: lastAudits.get(p.id) ?? null, portfolioMatch: sector ? match(sector) : null, today })
      tx.update(prospects).set({ fitScore: s.fit, needScore: s.need, freshScore: s.fresh, score: s.score, scoredAt: today })
        .where(eq(prospects.id, p.id)).run()
    }
  })
  return rows.length
}

// Proposta dei segmenti: un job di Opus in sola lettura.

export function runningProposal(db: Db): Pick<Job, 'id' | 'status'> | undefined {
  return db.select({ id: jobs.id, status: jobs.status }).from(jobs)
    .where(and(eq(jobs.kind, SEGMENT_JOB_KIND), inArray(jobs.status, ['queued', 'running'])))
    .orderBy(asc(jobs.id)).get()
}

const SOURCE_HELP = {
  places: 'places (Google Maps): text è una ricerca come la scriveresti su Maps, con la zona; trova anche il sito e il telefono',
  it_registry: 'it_registry (Registro Imprese, solo IT): codice ATECO, sigla della provincia, fascia di dipendenti; a pagamento per record, tieni limit basso',
  fr_registry: 'fr_registry (registro francese, solo FR, gratuito): codice NAF, dipartimento della sede e fascia di dipendenti (per le PMI, es. da 10 a 249); non ha il sito, che si cerca poi su Maps se è acceso',
  it_comuni: 'it_comuni (Comuni italiani, solo IT, gratuito): regione o sigla della provincia e fascia di abitanti; dà sindaco, giunta, sito e PEC; per i prodotti per la pubblica amministrazione, settore «pubblica amministrazione»',
} as const

export function proposalPrompt(market: Market | undefined, available: Record<keyof typeof SOURCE_HELP, boolean>): string {
  const on = (Object.keys(SOURCE_HELP) as (keyof typeof SOURCE_HELP)[]).filter(k => available[k])
  return [
    'Proponi a William i segmenti di mercato in cui Marketer cerca prospect. Un segmento è un gruppo di aziende di un mercato e di un settore a cui didap può vendere qualcosa che ha già fatto: un prodotto adattato, uno sviluppo su misura, AI per aziende, formazione.',
    '',
    market ? `Mercato: ${market}.` : 'Mercati: Italia prima di tutto, poi Spagna e Francia, USA e Canada, Svizzera e DACH.',
    'Fonti accese (usa solo queste nelle ricerche):',
    ...on.map(k => `- ${SOURCE_HELP[k]}`),
    '',
    'Come lavorare:',
    '1. Chiama portfolio_list: le voci approved sono le prove che si possono usare, le draft sono indizi ancora da confermare. Apri con portfolio_get solo le voci che ti servono.',
    '2. Chiama segment_list e non riproporre segmenti che ci sono già.',
    '3. Per ogni segmento chiama segment_propose con nome, mercato, settore (in italiano, con le parole dei settori del portfolio), descrizione (perché è un buon bersaglio e quale voce del portfolio fa da prova) e da 1 a 3 ricerche.',
    '4. Al massimo 6 segmenti, i più promettenti: PMI dove un prodotto o un caso di didap si adatta senza forzature.',
    '5. Codici ATECO e NAF solo se sei sicuro che siano giusti; nel dubbio usa Google Maps, se è acceso.',
    '6. Alla fine registra con activity_log una frase sola: quanti segmenti hai proposto e per quali mercati.',
  ].join('\n')
}

export function enqueueSegmentProposal(db: Db, market: Market | undefined, source: JobSource): Job {
  const running = runningProposal(db)
  if (running) throw new ProspectError('PROPOSAL_RUNNING', `C'è già una proposta ${running.status === 'running' ? 'in corso' : 'in coda'}: job ${running.id}`)
  return enqueueJob(db, {
    title: market ? `Segmenti: proposta per ${market}` : 'Segmenti: proposta',
    prompt: proposalPrompt(market, sourcesAvailable()),
    cwd: process.cwd(),
    permission: 'read',
  }, source, SEGMENT_JOB_KIND)
}
