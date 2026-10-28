import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ComuneProfile } from '../lib/signals'

// Fase 1: le fondamenta (job, eventi, impostazioni, battito del worker, attività).
// Fase 2: il portfolio. Fase 3: segmenti, ricerche, prospect e audit.
// Fase 4: identità dei mittenti, idee, campagne e messaggi da approvare.

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'canceled', 'stopped'] as const
export type JobStatus = typeof JOB_STATUSES[number]

/** Stati da cui un job non si muove più. */
export const FINAL_JOB_STATUSES: readonly JobStatus[] = ['done', 'failed', 'canceled', 'stopped']

/**
 * Cosa può fare Claude nel job senza nessuno al terminale.
 * read: legge e cerca; edit: anche modifica file; full: modalità auto (anche Bash).
 */
export const JOB_PERMISSIONS = ['read', 'edit', 'full'] as const
export type JobPermission = typeof JOB_PERMISSIONS[number]

export const JOB_SOURCES = ['dashboard', 'mcp', 'worker'] as const
export type JobSource = typeof JOB_SOURCES[number]

export const JOB_EVENT_KINDS = ['runner', 'system', 'text', 'tool_use', 'tool_result', 'result', 'stderr', 'other'] as const
export type JobEventKind = typeof JOB_EVENT_KINDS[number]

const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())

export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull().default('free'),
  title: text('title').notNull(),
  prompt: text('prompt').notNull(),
  cwd: text('cwd').notNull(),
  permission: text('permission', { enum: JOB_PERMISSIONS }).notNull().default('read'),
  source: text('source', { enum: JOB_SOURCES }).notNull(),
  status: text('status', { enum: JOB_STATUSES }).notNull().default('queued'),
  cancelRequested: integer('cancel_requested', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  // Giorno (Europe/Rome, AAAA-MM-GG) a cui si contano i token: quello in cui il job è partito.
  day: text('day'),
  pid: integer('pid'),
  sessionId: text('session_id'),
  model: text('model'),
  numTurns: integer('num_turns'),
  durationMs: integer('duration_ms'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  weightedTokens: integer('weighted_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  result: text('result'),
  error: text('error'),
}, t => [
  index('jobs_status_idx').on(t.status),
  index('jobs_day_idx').on(t.day),
])

export const jobEvents = sqliteTable('job_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  jobId: integer('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  at: integer('at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  kind: text('kind', { enum: JOB_EVENT_KINDS }).notNull(),
  summary: text('summary').notNull(),
  // Riga grezza dello stream di Claude, troncata.
  payload: text('payload'),
}, t => [
  index('job_events_job_idx').on(t.jobId, t.id),
])

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

export const heartbeats = sqliteTable('heartbeats', {
  name: text('name').primaryKey(),
  pid: integer('pid').notNull(),
  at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
})

/** Quello che l'agente ha fatto e che William deve vedere in Oggi. */
export const activity = sqliteTable('activity', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
}, t => [
  index('activity_at_idx').on(t.at),
])

/** Prodotto didap, caso studio (lavoro fatto per un cliente) o cliente passato. */
export const PORTFOLIO_KINDS = ['product', 'case', 'client'] as const
export type PortfolioKind = typeof PORTFOLIO_KINDS[number]

/** draft: da rivedere; approved: confermato da William, si può usare come prova; archived: escluso. */
export const PORTFOLIO_STATUSES = ['draft', 'approved', 'archived'] as const
export type PortfolioStatus = typeof PORTFOLIO_STATUSES[number]

export const PORTFOLIO_SOURCE_KINDS = ['repo', 'site'] as const
export type PortfolioSourceKind = typeof PORTFOLIO_SOURCE_KINDS[number]

/** Campi di una voce che un job può proporre e William può correggere. */
export interface PortfolioFields {
  kind: PortfolioKind
  name: string
  summary: string
  sectors: string[]
  client: string | null
  problem: string
  solution: string
  results: string
  stack: string
  url: string | null
  year: number | null
  tags: string[]
  related: string[]
  citable: boolean
}

/** Aggiornamento proposto da un job su una voce già rivista: William lo applica o lo scarta. */
export interface PortfolioProposal {
  jobId: number | null
  at: string
  fields: Partial<PortfolioFields>
}

export const portfolioItems = sqliteTable('portfolio_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  kind: text('kind', { enum: PORTFOLIO_KINDS }).notNull(),
  name: text('name').notNull(),
  summary: text('summary').notNull().default(''),
  sectors: text('sectors', { mode: 'json' }).$type<string[]>().notNull().default([]),
  client: text('client'),
  problem: text('problem').notNull().default(''),
  solution: text('solution').notNull().default(''),
  results: text('results').notNull().default(''),
  stack: text('stack').notNull().default(''),
  url: text('url'),
  year: integer('year'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
  // Slug delle voci collegate: il cliente di un caso, il prodotto usato.
  related: text('related', { mode: 'json' }).$type<string[]>().notNull().default([]),
  // Il nome si può fare in un messaggio a un prospect. Senza conferma, no.
  citable: integer('citable', { mode: 'boolean' }).notNull().default(false),
  // Indicazioni di William per l'agente (cosa non dire, a chi fare riferimento).
  notes: text('notes').notNull().default(''),
  // Percorsi delle fonti da cui la voce è stata ricavata.
  sources: text('sources', { mode: 'json' }).$type<string[]>().notNull().default([]),
  status: text('status', { enum: PORTFOLIO_STATUSES }).notNull().default('draft'),
  proposal: text('proposal', { mode: 'json' }).$type<PortfolioProposal>(),
  // Ultima correzione a mano: da lì in poi un job non sovrascrive, propone.
  editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }),
  jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [
  index('portfolio_items_kind_idx').on(t.kind, t.status),
])

/** Cosa si sa delle fonti trovate sul disco: quando sono state importate, o perché si ignorano. */
export const portfolioSources = sqliteTable('portfolio_sources', {
  path: text('path').primaryKey(),
  kind: text('kind', { enum: PORTFOLIO_SOURCE_KINDS }).notNull(),
  importedAt: integer('imported_at', { mode: 'timestamp_ms' }),
  // Impronta dei file al momento dell'import: se cambia, la fonte va riletta.
  fingerprint: text('fingerprint'),
  ignoredReason: text('ignored_reason'),
  jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
})

/** Mercati in cui cerca l'agente, con il codice ISO del paese. */
export const MARKETS = ['IT', 'ES', 'FR', 'US', 'CA', 'CH', 'DE', 'AT'] as const
export type Market = typeof MARKETS[number]

/** Da dove arriva un prospect. it_comuni: i Comuni italiani dai dati aperti. manual: scritto a mano. */
export const PROSPECT_SOURCES = ['places', 'it_registry', 'fr_registry', 'it_comuni', 'manual'] as const
export type ProspectSource = typeof PROSPECT_SOURCES[number]

/** Cosa offre oggi il sito di un Comune a chi vuole segnalare: piattaforma con mappa, modulo generico, niente. */
export const REPORTING_KINDS = ['piattaforma', 'modulo', 'nessuno'] as const
export type ReportingKind = typeof REPORTING_KINDS[number]

/** Orientamento della giunta di un Comune, per sommi capi: civica quando le liste non lo dicono. */
export const POLITICAL_SIDES = ['centrodestra', 'centrosinistra', 'civica'] as const
export type PoliticalSide = typeof POLITICAL_SIDES[number]

/** Base legale del contatto: la matrice della Fase 4 decide, per paese e canale, cosa è ammesso. */
// public_office: un amministratore pubblico al suo indirizzo istituzionale, pubblicato per il ruolo.
export const LEGAL_BASES = ['consent', 'existing_customer', 'b2b_optout', 'public_office', 'inbound_only'] as const
export type LegalBasis = typeof LEGAL_BASES[number]

/** new: da guardare; qualified: buono per idee e messaggi; discarded: escluso. */
export const PROSPECT_STATUSES = ['new', 'qualified', 'discarded'] as const
export type ProspectStatus = typeof PROSPECT_STATUSES[number]

/** proposed: proposto da un job, da accendere; active: si cerca; paused: fermo. */
export const SEGMENT_STATUSES = ['proposed', 'active', 'paused'] as const
export type SegmentStatus = typeof SEGMENT_STATUSES[number]

/** Stati di una ricerca o di un audit: lavoro meccanico del worker, senza LLM. */
export const WORK_STATUSES = ['queued', 'running', 'done', 'failed'] as const
export type WorkStatus = typeof WORK_STATUSES[number]

/** Una ricerca di un segmento su una fonte. */
export type SegmentQuery =
  | { source: 'places', text: string, limit: number }
  | { source: 'it_registry', atecoCode: string, province?: string, minEmployees?: number, maxEmployees?: number, limit: number }
  | { source: 'fr_registry', naf: string, departement?: string, minEmployees?: number, maxEmployees?: number, limit: number }
  | { source: 'it_comuni', region?: string, province?: string, minPopulation?: number, maxPopulation?: number, limit: number }

/** Difetto trovato dall'audit: il testo è già l'aggancio di un messaggio. 3 pesa di più. */
export interface AuditIssue {
  code: string
  severity: 1 | 2 | 3
  text: string
}

export interface StackItem {
  name: string
  version: string | null
  outdated: boolean
}

export const segments = sqliteTable('segments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  market: text('market', { enum: MARKETS }).notNull(),
  // Settore in italiano, come quelli del portfolio (es. consulenza del lavoro).
  sector: text('sector').notNull(),
  description: text('description').notNull().default(''),
  queries: text('queries', { mode: 'json' }).$type<SegmentQuery[]>().notNull().default([]),
  status: text('status', { enum: SEGMENT_STATUSES }).notNull().default('active'),
  // Indicazioni di William per l'agente.
  notes: text('notes').notNull().default(''),
  jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

export const searches = sqliteTable('searches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  segmentId: integer('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  query: text('query', { mode: 'json' }).$type<SegmentQuery>().notNull(),
  status: text('status', { enum: WORK_STATUSES }).notNull().default('queued'),
  // Risultati letti dalla fonte e prospect nuovi tra questi.
  found: integer('found').notNull().default(0),
  added: integer('added').notNull().default(0),
  // Chiamate a pagamento fatte (Places, OpenAPI.it): per tenere d'occhio il costo.
  paidCalls: integer('paid_calls').notNull().default(0),
  error: text('error'),
  createdAt: createdAt(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
}, t => [
  index('searches_status_idx').on(t.status),
  index('searches_segment_idx').on(t.segmentId),
])

export const prospects = sqliteTable('prospects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  // Il segmento che l'ha trovato per primo.
  segmentId: integer('segment_id').references(() => segments.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  country: text('country').notNull(),
  city: text('city'),
  region: text('region'),
  address: text('address'),
  // Origine del sito (https://dominio), senza percorso.
  website: text('website'),
  phone: text('phone'),
  // Chiavi delle fonti, per non contare due volte la stessa azienda.
  registryId: text('registry_id').unique(),
  placeId: text('place_id').unique(),
  sectorCode: text('sector_code'),
  sectorLabel: text('sector_label'),
  employeesMin: integer('employees_min'),
  employeesMax: integer('employees_max'),
  // Data di nascita dell'azienda (AAAA-MM-GG): fa la freschezza.
  foundedAt: text('founded_at'),
  // Indirizzo email pubblico dell'ente o dell'azienda (per i Comuni, la PEC di IndicePA).
  email: text('email'),
  // Solo per i Comuni: abitanti, data di elezione della giunta (AAAA-MM-GG, fa la freschezza)
  // e orientamento letto dalle liste del sindaco.
  population: integer('population'),
  electedAt: text('elected_at'),
  politicalSide: text('political_side', { enum: POLITICAL_SIDES }),
  // Solo per i Comuni: i segnali raccolti dai dati aperti (scripts/segnali_comuni.py), che fanno il fit.
  profile: text('profile', { mode: 'json' }).$type<ComuneProfile>(),
  source: text('source', { enum: PROSPECT_SOURCES }).notNull(),
  legalBasis: text('legal_basis', { enum: LEGAL_BASES }).notNull().default('b2b_optout'),
  status: text('status', { enum: PROSPECT_STATUSES }).notNull().default('new'),
  notes: text('notes').notNull().default(''),
  fitScore: integer('fit_score'),
  needScore: integer('need_score'),
  freshScore: integer('fresh_score'),
  score: integer('score'),
  scoredAt: integer('scored_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, t => [
  index('prospects_segment_idx').on(t.segmentId, t.score),
  index('prospects_score_idx').on(t.score),
  index('prospects_website_idx').on(t.website),
])

/** attivo: post o attività recenti; poco_attivo: solo il profilo; assente: nessun profilo sicuramente suo. */
export const LINKEDIN_ACTIVITY = ['attivo', 'poco_attivo', 'assente'] as const

/** Le persone a cui si scrive: per un Comune sindaco, vicesindaco e assessori. Ogni ricerca le riscrive. */
export const prospectContacts = sqliteTable('prospect_contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  prospectId: integer('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  role: text('role').notNull(),
  // Le liste collegate, per il sindaco.
  lists: text('lists'),
  // In carica dal (AAAA-MM-GG).
  since: text('since'),
  // Dal sito del Comune (pnpm contatti): email istituzionale, deleghe e la pagina da cui vengono.
  email: text('email'),
  delegations: text('delegations'),
  sourceUrl: text('source_url'),
  // LinkedIn, guardato dal job della strategia con una ricerca web: c'è un profilo, e lo usa?
  linkedinUrl: text('linkedin_url'),
  linkedinActivity: text('linkedin_activity', { enum: LINKEDIN_ACTIVITY }),
  linkedinNote: text('linkedin_note'),
  linkedinCheckedAt: integer('linkedin_checked_at', { mode: 'timestamp_ms' }),
  source: text('source', { enum: PROSPECT_SOURCES }).notNull(),
  createdAt: createdAt(),
}, t => [
  index('prospect_contacts_prospect_idx').on(t.prospectId),
])

export const audits = sqliteTable('audits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  prospectId: integer('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  finalUrl: text('final_url'),
  status: text('status', { enum: WORK_STATUSES }).notNull().default('queued'),
  https: integer('https', { mode: 'boolean' }),
  // Il sito dichiara il viewport per il telefono.
  mobile: integer('mobile', { mode: 'boolean' }),
  // Punteggi Lighthouse su mobile, da 0 a 100.
  performance: integer('performance'),
  accessibility: integer('accessibility'),
  seo: integer('seo'),
  bestPractices: integer('best_practices'),
  lcpMs: integer('lcp_ms'),
  stack: text('stack', { mode: 'json' }).$type<StackItem[]>().notNull().default([]),
  hasForm: integer('has_form', { mode: 'boolean' }),
  hasBooking: integer('has_booking', { mode: 'boolean' }),
  issues: text('issues', { mode: 'json' }).$type<AuditIssue[]>().notNull().default([]),
  error: text('error'),
  createdAt: createdAt(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
}, t => [
  index('audits_prospect_idx').on(t.prospectId, t.id),
  index('audits_status_idx').on(t.status),
])

/** Canali dei messaggi. LinkedIn, telefono e WhatsApp li fa a mano il mittente; l'email parte dal worker (Fase 5). */
export const CHANNELS = ['email', 'linkedin', 'phone', 'whatsapp'] as const
export type Channel = typeof CHANNELS[number]

/** Lingue dei messaggi. */
export const LANGUAGES = ['it', 'en', 'fr', 'es', 'de'] as const
export type Language = typeof LANGUAGES[number]

/** product: un prodotto didap adattato; custom: sviluppo o AI su misura; quick: un lavoro veloce dall'audit. */
export const IDEA_KINDS = ['product', 'custom', 'quick'] as const
export type IdeaKind = typeof IDEA_KINDS[number]

export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused'] as const
export type CampaignStatus = typeof CAMPAIGN_STATUSES[number]

/** pending: da approvare; approved: approvato, aspetta l'invio; discarded: scartato; sent: partito. */
export const MESSAGE_STATUSES = ['pending', 'approved', 'discarded', 'sent'] as const
export type MessageStatus = typeof MESSAGE_STATUSES[number]

/** Un passo della sequenza di una campagna: il giorno conta dal primo contatto. */
export interface CampaignStep {
  day: number
  channel: Channel
}

/** Chi firma i messaggi: una persona didap con le sue lingue e, dalla Fase 5, le sue caselle. */
export const identities = sqliteTable('identities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  role: text('role').notNull().default(''),
  languages: text('languages', { mode: 'json' }).$type<Language[]>().notNull().default([]),
  email: text('email'),
  linkedinUrl: text('linkedin_url'),
  phone: text('phone'),
  // Firma in fondo ai messaggi, una riga per voce.
  signature: text('signature').notNull().default(''),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: createdAt(),
})

export const ideas = sqliteTable('ideas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  prospectId: integer('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: IDEA_KINDS }).notNull(),
  title: text('title').notNull(),
  pitch: text('pitch').notNull(),
  // Sforzo e prezzo come li direbbe William: «due settimane», «3-6 mila euro».
  effort: text('effort').notNull().default(''),
  priceBand: text('price_band').notNull().default(''),
  // La voce del portfolio più vicina, che fa da prova.
  portfolioSlug: text('portfolio_slug'),
  jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [
  index('ideas_prospect_idx').on(t.prospectId),
])

/** draft: da rivedere; approved: William la segue; archived: superata. */
export const STRATEGY_STATUSES = ['draft', 'approved', 'archived'] as const
export type StrategyStatus = typeof STRATEGY_STATUSES[number]

/** Chi contattare per primo in una strategia, e perché. */
export interface StrategyContact {
  prospectId: number
  name: string
  role: string
  why: string
}

/**
 * La strategia di contatto per un target (un prospect) o per un gruppo: la scrive un job di Opus da
 * tutti i dati del prospect, William la rivede. Il corpo è markdown.
 */
export const strategies = sqliteTable('strategies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  prospectIds: text('prospect_ids', { mode: 'json' }).$type<number[]>().notNull(),
  status: text('status', { enum: STRATEGY_STATUSES }).notNull().default('draft'),
  // Vuoti finché il job non l'ha scritta.
  summary: text('summary').notNull().default(''),
  body: text('body').notNull().default(''),
  firstContacts: text('first_contacts', { mode: 'json' }).$type<StrategyContact[]>().notNull().default([]),
  // Il primo messaggio: per un gruppo, quello di base da adattare a ognuno.
  openingSubject: text('opening_subject'),
  openingBody: text('opening_body'),
  // Indicazioni di William per l'agente, che le rilegge quando la riscrive.
  notes: text('notes').notNull().default(''),
  jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

export const campaigns = sqliteTable('campaigns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  segmentId: integer('segment_id').notNull().references(() => segments.id, { onDelete: 'cascade' }),
  identityId: integer('identity_id').notNull().references(() => identities.id),
  language: text('language', { enum: LANGUAGES }).notNull(),
  steps: text('steps', { mode: 'json' }).$type<CampaignStep[]>().notNull().default([]),
  status: text('status', { enum: CAMPAIGN_STATUSES }).notNull().default('draft'),
  // Indicazioni di William per chi scrive: tono, cosa evitare, cosa offrire.
  notes: text('notes').notNull().default(''),
  createdAt: createdAt(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
})

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  campaignId: integer('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
  prospectId: integer('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
  identityId: integer('identity_id').notNull().references(() => identities.id),
  // Indice del passo nella sequenza della campagna.
  step: integer('step').notNull().default(0),
  channel: text('channel', { enum: CHANNELS }).notNull(),
  language: text('language', { enum: LANGUAGES }).notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  ideaId: integer('idea_id').references(() => ideas.id, { onDelete: 'set null' }),
  status: text('status', { enum: MESSAGE_STATUSES }).notNull().default('pending'),
  // La base legale al momento della bozza: la matrice l'ha ammessa per questo paese e canale.
  legalBasis: text('legal_basis', { enum: LEGAL_BASES }).notNull(),
  // Il messaggio Telegram con i bottoni, per aggiornarlo quando William decide.
  telegramMessageId: integer('telegram_message_id'),
  notifiedAt: integer('notified_at', { mode: 'timestamp_ms' }),
  editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
  decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
  jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, t => [
  index('messages_status_idx').on(t.status, t.id),
  index('messages_prospect_idx').on(t.prospectId),
  index('messages_campaign_idx').on(t.campaignId, t.prospectId, t.step),
])

export type Job = typeof jobs.$inferSelect
export type JobEvent = typeof jobEvents.$inferSelect
export type PortfolioItem = typeof portfolioItems.$inferSelect
export type PortfolioSourceRow = typeof portfolioSources.$inferSelect
export type Segment = typeof segments.$inferSelect
export type Search = typeof searches.$inferSelect
export type Prospect = typeof prospects.$inferSelect
export type ProspectContact = typeof prospectContacts.$inferSelect
export type Audit = typeof audits.$inferSelect
export type Identity = typeof identities.$inferSelect
export type Idea = typeof ideas.$inferSelect
export type Campaign = typeof campaigns.$inferSelect
export type Message = typeof messages.$inferSelect
export type Strategy = typeof strategies.$inferSelect
