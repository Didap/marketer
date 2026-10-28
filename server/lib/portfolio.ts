import { resolve } from 'node:path'
import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db/client'
import type { Job, JobSource, PortfolioFields, PortfolioItem, PortfolioKind, PortfolioStatus } from '../db/schema'
import { jobs, PORTFOLIO_KINDS, PORTFOLIO_STATUSES, portfolioItems, portfolioSources } from '../db/schema'
import { reposDir, siteDir } from './env'
import { enqueueJob } from './jobs'
import type { DiscoveredSource } from './portfolio-sources'
import { discoverSources, matchSource, splitIntoLots } from './portfolio-sources'

// Il portfolio: prodotti, casi studio e clienti passati che fanno da prova nei messaggi.
// I job di import propongono, William rivede: solo le voci confermate valgono come prova.

export class PortfolioError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'INVALID_INPUT' | 'SLUG_TAKEN' | 'UNKNOWN_SOURCE' | 'NOTHING_TO_IMPORT' | 'IMPORT_RUNNING' | 'NO_PROPOSAL', message: string) {
    super(message)
  }
}

export const IMPORT_JOB_KIND = 'portfolio_import'
/** Fonti per job: lotti piccoli tengono corto il contesto, e un job fermato dal tetto perde poco. */
export const IMPORT_LOT_SIZE = 8

const slug = z.string().trim().toLowerCase().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'solo minuscole, cifre e trattini')
const longText = z.string().trim().max(3000)
const labels = z.array(z.string().trim().min(1).max(80)).max(20)

// Niente transform né refine: lo schema passa così com'è al server MCP, che lo converte in JSON Schema.
export const portfolioFields = z.object({
  kind: z.enum(PORTFOLIO_KINDS).describe('product: prodotto didap; case: lavoro fatto per un cliente; client: cliente o partner passato'),
  name: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(400).default('').describe('Una frase: cos\'è e per chi'),
  sectors: labels.default([]).describe('Settori dei clienti a cui serve o per cui è stato fatto, in italiano (es. pubblica amministrazione, consulenza del lavoro)'),
  client: z.string().trim().max(120).nullable().default(null).describe('Nome del cliente, per i casi studio'),
  problem: longText.default('').describe('Il problema del cliente o del mercato'),
  solution: longText.default('').describe('Cosa ha fatto didap'),
  results: longText.default('').describe('Solo risultati scritti nelle fonti, mai stimati né inventati'),
  stack: z.string().trim().max(400).default(''),
  url: z.string().trim().max(400).nullable().default(null),
  year: z.number().int().min(1990).max(2100).nullable().default(null),
  tags: labels.default([]),
  related: z.array(slug).max(20).default([]).describe('Slug delle voci collegate: il cliente di un caso, il prodotto usato'),
  citable: z.boolean().default(false).describe('Il nome si può fare con un prospect: true solo se compare sul sito didap'),
})
const FIELD_KEYS = Object.keys(portfolioFields.shape) as (keyof PortfolioFields)[]

export const portfolioUpsertInput = portfolioFields.extend({
  slug: slug.describe('Chiave stabile in minuscolo con trattini (es. quadra, comune-di-brindisi): riusa quella che esiste già'),
  sources: z.array(z.string().trim().min(1).max(1024)).max(20).default([]).describe('Percorsi delle fonti da cui è ricavata la voce'),
})

/** Quello che corregge William: i campi più le note per l'agente. */
export const portfolioEditInput = portfolioFields.extend({
  notes: z.string().trim().max(4000).default(''),
})

export const portfolioCreateInput = portfolioEditInput.extend({
  slug: slug.optional(),
})

function unique(list: string[]): string[] {
  return [...new Set(list)]
}

function normalize<T extends PortfolioFields>(fields: T): T {
  const url = fields.url?.trim() || null
  if (url && !URL.canParse(url)) throw new PortfolioError('INVALID_INPUT', `URL non valido: ${url}`)
  return {
    ...fields,
    url,
    client: fields.client?.trim() || null,
    sectors: unique(fields.sectors.map(s => s.toLowerCase())),
    tags: unique(fields.tags),
    related: unique(fields.related),
  }
}

function pickFields(item: PortfolioItem): PortfolioFields {
  return Object.fromEntries(FIELD_KEYS.map(k => [k, item[k]])) as unknown as PortfolioFields
}

/** I campi di `next` diversi da quelli della voce. */
export function changedFields(item: PortfolioFields, next: PortfolioFields): Partial<PortfolioFields> {
  const diff: Record<string, unknown> = {}
  for (const key of FIELD_KEYS) {
    if (JSON.stringify(item[key]) !== JSON.stringify(next[key])) diff[key] = next[key]
  }
  return diff as Partial<PortfolioFields>
}

export function slugify(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'voce'
}

export function getPortfolioItem(db: Db, ref: number | string): PortfolioItem {
  const item = db.select().from(portfolioItems)
    .where(typeof ref === 'number' ? eq(portfolioItems.id, ref) : eq(portfolioItems.slug, ref))
    .get()
  if (!item) throw new PortfolioError('NOT_FOUND', `La voce ${ref} non esiste nel portfolio`)
  return item
}

export function listPortfolio(db: Db, opts: { kind?: PortfolioKind, status?: PortfolioStatus, q?: string } = {}): PortfolioItem[] {
  const q = opts.q?.trim()
  return db.select().from(portfolioItems)
    .where(and(
      opts.kind ? eq(portfolioItems.kind, opts.kind) : undefined,
      opts.status ? eq(portfolioItems.status, opts.status) : undefined,
      q ? or(like(portfolioItems.name, `%${q}%`), like(portfolioItems.summary, `%${q}%`), like(portfolioItems.sectors, `%${q.toLowerCase()}%`), like(portfolioItems.client, `%${q}%`)) : undefined,
    ))
    .orderBy(sql`case ${portfolioItems.status} when 'draft' then 0 when 'approved' then 1 else 2 end`, asc(portfolioItems.name))
    .all()
}

/** Forma breve per i tool MCP: quanto basta per scegliere quale voce aprire. */
export function portfolioBrief(item: PortfolioItem) {
  return {
    slug: item.slug,
    kind: item.kind,
    name: item.name,
    summary: item.summary,
    sectors: item.sectors,
    client: item.client,
    status: item.status,
    citable: item.citable,
    hasProposal: item.proposal !== null,
  }
}

function sourceOptions() {
  return { reposDir: reposDir(), siteDir: siteDir(), exclude: [process.cwd()] }
}

function markImported(db: Db, source: DiscoveredSource, jobId: number | null): void {
  const values = { importedAt: new Date(), fingerprint: source.fingerprint, ignoredReason: null, jobId }
  db.insert(portfolioSources).values({ path: source.path, kind: source.kind, ...values })
    .onConflictDoUpdate({ target: portfolioSources.path, set: values })
    .run()
}

export type UpsertOutcome = 'created' | 'updated' | 'proposed' | 'unchanged'

/**
 * Scrittura di un job (o di Claude da terminale). Una voce nuova o ancora intatta si scrive;
 * su una voce che William ha già rivisto o corretto, i campi diversi diventano una proposta.
 */
export function upsertFromAgent(db: Db, raw: z.input<typeof portfolioUpsertInput>, jobId: number | null): { id: number, slug: string, outcome: UpsertOutcome } {
  const { slug: key, sources: rawSources, ...rest } = portfolioUpsertInput.parse(raw)
  const fields = normalize(rest)
  const discovered = discoverSources(sourceOptions())
  const matched = rawSources.map(p => ({ raw: p, source: matchSource(discovered, p) }))
  const sources = unique(matched.map(m => m.source?.path ?? m.raw))
  const now = new Date()

  const existing = db.select().from(portfolioItems).where(eq(portfolioItems.slug, key)).get()
  let result: { id: number, slug: string, outcome: UpsertOutcome }
  if (!existing) {
    const row = db.insert(portfolioItems).values({ ...fields, slug: key, sources, jobId, updatedAt: now }).returning().get()
    result = { id: row.id, slug: key, outcome: 'created' }
  }
  else {
    const allSources = unique([...existing.sources, ...sources])
    const diff = changedFields(pickFields(existing), fields)
    const untouched = existing.status === 'draft' && existing.editedAt === null
    let outcome: UpsertOutcome = Object.keys(diff).length ? (untouched ? 'updated' : 'proposed') : 'unchanged'
    const set: Partial<typeof portfolioItems.$inferInsert> = { sources: allSources }
    if (outcome === 'updated') Object.assign(set, fields, { jobId, updatedAt: now })
    if (outcome === 'proposed') set.proposal = { jobId, at: now.toISOString(), fields: diff }
    if (outcome === 'unchanged' && allSources.length !== existing.sources.length) set.updatedAt = now
    db.update(portfolioItems).set(set).where(eq(portfolioItems.id, existing.id)).run()
    result = { id: existing.id, slug: key, outcome }
  }

  for (const { source } of matched) {
    if (source) markImported(db, source, jobId)
  }
  return result
}

function freeSlug(db: Db, base: string): string {
  const taken = new Set(db.select({ slug: portfolioItems.slug }).from(portfolioItems)
    .where(like(portfolioItems.slug, `${base}%`)).all().map(r => r.slug))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/** Voce scritta a mano da William: nasce già confermata. */
export function createPortfolioItem(db: Db, raw: z.input<typeof portfolioCreateInput>): PortfolioItem {
  const { slug: wanted, ...rest } = portfolioCreateInput.parse(raw)
  const fields = normalize(rest)
  if (wanted && db.select({ id: portfolioItems.id }).from(portfolioItems).where(eq(portfolioItems.slug, wanted)).get()) {
    throw new PortfolioError('SLUG_TAKEN', `Lo slug ${wanted} è già di un'altra voce`)
  }
  const now = new Date()
  return db.insert(portfolioItems).values({
    ...fields,
    slug: wanted ?? freeSlug(db, slugify(fields.name)),
    status: 'approved',
    editedAt: now,
    reviewedAt: now,
    updatedAt: now,
  }).returning().get()
}

/** Correzione di William: da qui in poi i job propongono invece di scrivere. */
export function updatePortfolioItem(db: Db, id: number, raw: z.input<typeof portfolioEditInput>): PortfolioItem {
  getPortfolioItem(db, id)
  const fields = normalize(portfolioEditInput.parse(raw))
  const now = new Date()
  return db.update(portfolioItems).set({ ...fields, editedAt: now, updatedAt: now })
    .where(eq(portfolioItems.id, id)).returning().get()!
}

export function setPortfolioStatus(db: Db, id: number, status: PortfolioStatus): PortfolioItem {
  getPortfolioItem(db, id)
  const now = new Date()
  return db.update(portfolioItems)
    .set({ status, reviewedAt: status === 'draft' ? null : now, updatedAt: now })
    .where(eq(portfolioItems.id, id)).returning().get()!
}

/** Applica o scarta l'aggiornamento proposto da un job. */
export function resolveProposal(db: Db, id: number, action: 'apply' | 'discard'): PortfolioItem {
  const item = getPortfolioItem(db, id)
  if (!item.proposal) throw new PortfolioError('NO_PROPOSAL', 'Questa voce non ha aggiornamenti proposti')
  const now = new Date()
  const set: Partial<typeof portfolioItems.$inferInsert> = { proposal: null, updatedAt: now }
  if (action === 'apply') Object.assign(set, normalize({ ...pickFields(item), ...item.proposal.fields }), { editedAt: now })
  return db.update(portfolioItems).set(set).where(eq(portfolioItems.id, id)).returning().get()!
}

export type SourceState = 'new' | 'changed' | 'imported' | 'ignored'

export interface PortfolioSource extends DiscoveredSource {
  state: SourceState
  importedAt: Date | null
  ignoredReason: string | null
  jobId: number | null
  /** Le voci ricavate da questa fonte. */
  items: { id: number, slug: string, name: string }[]
}

/** Le fonti sul disco con lo stato del loro import. */
export function listSources(db: Db): PortfolioSource[] {
  const rows = new Map(db.select().from(portfolioSources).all().map(r => [r.path, r]))
  const items = db.select({ id: portfolioItems.id, slug: portfolioItems.slug, name: portfolioItems.name, sources: portfolioItems.sources })
    .from(portfolioItems).all()
  return discoverSources(sourceOptions()).map((source) => {
    const row = rows.get(source.path)
    const state: SourceState = row?.ignoredReason
      ? 'ignored'
      : !row?.importedAt ? 'new' : row.fingerprint !== source.fingerprint ? 'changed' : 'imported'
    return {
      ...source,
      state,
      importedAt: row?.importedAt ?? null,
      ignoredReason: row?.ignoredReason ?? null,
      jobId: row?.jobId ?? null,
      items: items.filter(i => i.sources.includes(source.path)).map(({ id, slug, name }) => ({ id, slug, name })),
    }
  })
}

function findSource(path: string): DiscoveredSource {
  const source = discoverSources(sourceOptions()).find(s => s.path === resolve(path))
  if (!source) throw new PortfolioError('UNKNOWN_SOURCE', `Non è una fonte del portfolio: ${path}`)
  return source
}

/** Fonte che non è materiale da portfolio: gli import la saltano finché William non la riprende. */
export function ignoreSource(db: Db, path: string, reason: string, jobId: number | null): void {
  const source = findSource(path)
  const values = { ignoredReason: reason.trim() || 'Ignorata', importedAt: new Date(), fingerprint: source.fingerprint, jobId }
  db.insert(portfolioSources).values({ path: source.path, kind: source.kind, ...values })
    .onConflictDoUpdate({ target: portfolioSources.path, set: values })
    .run()
}

/** Ripresa da William: torna nuova, così il prossimo import la legge. */
export function restoreSource(db: Db, path: string): void {
  const source = findSource(path)
  db.update(portfolioSources).set({ ignoredReason: null, importedAt: null, fingerprint: null })
    .where(eq(portfolioSources.path, source.path)).run()
}

export function runningImport(db: Db): Pick<Job, 'id' | 'status'> | undefined {
  return db.select({ id: jobs.id, status: jobs.status }).from(jobs)
    .where(and(eq(jobs.kind, IMPORT_JOB_KIND), inArray(jobs.status, ['queued', 'running'])))
    .orderBy(asc(jobs.id)).get()
}

export function importPrompt(lot: PortfolioSource[]): string {
  const lines = lot.map((s) => {
    const where = s.kind === 'repo' ? `repo, leggi ${s.files.map(f => f.slice(s.path.length + 1)).join(' e ')}` : 'scheda del sito didap'
    const note = s.state === 'changed' ? ', cambiata dall\'ultimo import' : ''
    return `- ${s.path} (${where}${note})`
  })
  return [
    'Importa nel portfolio di Marketer le fonti qui sotto. Il portfolio raccoglie prodotti didap, casi studio (lavori fatti per un cliente) e clienti passati, e serve come prova nei messaggi ai prospect.',
    '',
    'Fonti:',
    ...lines,
    '',
    'Come lavorare:',
    '1. Chiama portfolio_list per vedere le voci che esistono già. Una cosa sola (per esempio CityFix dal sito e dal repo) è una voce sola: riusa lo slug che c\'è.',
    '2. Leggi i file indicati, tutti insieme in un giro. Per lo stack puoi aprire anche il package.json del repo. Nient\'altro: ogni lettura costa token.',
    '3. Per ogni prodotto, caso studio o cliente chiama portfolio_upsert con tutti i campi e con sources uguale ai percorsi delle fonti da cui l\'hai ricavato. Se lo slug esiste già, leggi la voce con portfolio_get e manda la versione unita, senza perdere quello che c\'era.',
    '4. Un cliente o partner nominato in una fonte merita una voce client a sé, collegata con related al caso o al prodotto.',
    '5. Una fonte che non è materiale da portfolio (strumento interno, esperimento personale, copia di un altro repo) va chiusa con portfolio_skip_source e il motivo in una frase.',
    '6. Solo fatti scritti nelle fonti. Niente risultati, numeri, clienti o date inventati: se un campo non si ricava, lascialo vuoto e lo completa William.',
    '7. citable è true solo per nomi che compaiono sulle schede del sito didap; tutto il resto false, lo decide William.',
    '8. Alla fine registra con activity_log una frase sola: quante voci hai creato, aggiornato o proposto e quante fonti hai saltato.',
  ].join('\n')
}

/** Mette in coda i job di import: le fonti indicate, oppure tutte le nuove e le cambiate. */
export function enqueuePortfolioImport(db: Db, paths: string[] | undefined, source: JobSource): Job[] {
  const running = runningImport(db)
  if (running) throw new PortfolioError('IMPORT_RUNNING', `C'è già un import ${running.status === 'running' ? 'in corso' : 'in coda'}: job ${running.id}`)
  const all = listSources(db)
  let chosen: PortfolioSource[]
  if (paths?.length) {
    const wanted = new Set(paths.map(p => resolve(p)))
    chosen = all.filter(s => wanted.has(s.path))
    const missing = [...wanted].filter(p => !chosen.some(s => s.path === p))
    if (missing.length) throw new PortfolioError('UNKNOWN_SOURCE', `Non sono fonti del portfolio: ${missing.join(', ')}`)
  }
  else {
    chosen = all.filter(s => s.state === 'new' || s.state === 'changed')
  }
  if (!chosen.length) throw new PortfolioError('NOTHING_TO_IMPORT', 'Nessuna fonte nuova o cambiata da importare')

  const lots = splitIntoLots(chosen, IMPORT_LOT_SIZE)
  return lots.map((lot, i) => enqueueJob(db, {
    title: lots.length > 1 ? `Portfolio: import ${i + 1} di ${lots.length}` : 'Portfolio: import',
    prompt: importPrompt(lot),
    cwd: reposDir(),
    permission: 'read',
  }, source, IMPORT_JOB_KIND))
}
