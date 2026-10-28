import { and, asc, desc, eq, inArray, notExists, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db/client'
import type { Campaign, CampaignStatus, Identity, Idea, Job, JobSource, Message, MessageStatus, Prospect } from '../db/schema'
import { audits, campaigns, CHANNELS, identities, IDEA_KINDS, ideas, jobs, LANGUAGES, messages, portfolioItems, prospects, segments } from '../db/schema'
import { enqueueJob, logActivity } from './jobs'
import { checkChannel } from './legal'

// Idee e messaggi. I job di Opus scrivono idee e bozze; ogni bozza passa la matrice legale,
// va in coda di approvazione e parte solo quando William la approva.

export class OutreachError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'INVALID_INPUT' | 'NOT_ALLOWED' | 'NOT_PENDING' | 'JOB_RUNNING' | 'NOTHING_TO_DO', message: string) {
    super(message)
  }
}

export const IDEAS_JOB_KIND = 'ideas'
export const DRAFTS_JOB_KIND = 'drafts'
/** Prospect per job: le idee costano poco contesto, le bozze di più. */
const IDEAS_LOT = 10
const DRAFTS_LOT = 5

export const CHANNEL_LABEL = { email: 'email', linkedin: 'LinkedIn', phone: 'telefono', whatsapp: 'WhatsApp' } as const
const LANGUAGE_NAME = { it: 'italiano', en: 'inglese', fr: 'francese', es: 'spagnolo', de: 'tedesco' } as const

// Identità.

export const identityInput = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(120).default(''),
  languages: z.array(z.enum(LANGUAGES)).max(5).default([]),
  email: z.string().trim().max(200).nullable().default(null),
  linkedinUrl: z.string().trim().max(400).nullable().default(null),
  phone: z.string().trim().max(60).nullable().default(null),
  signature: z.string().trim().max(1000).default(''),
  active: z.boolean().default(true),
})

export function listIdentities(db: Db): Identity[] {
  return db.select().from(identities).orderBy(desc(identities.active), asc(identities.name)).all()
}

export function getIdentity(db: Db, id: number): Identity {
  const row = db.select().from(identities).where(eq(identities.id, id)).get()
  if (!row) throw new OutreachError('NOT_FOUND', `L'identità ${id} non esiste`)
  return row
}

export function saveIdentity(db: Db, id: number | null, raw: z.input<typeof identityInput>): Identity {
  const input = identityInput.parse(raw)
  const values = { ...input, email: input.email || null, linkedinUrl: input.linkedinUrl || null, phone: input.phone || null }
  if (id === null) return db.insert(identities).values(values).returning().get()
  getIdentity(db, id)
  return db.update(identities).set(values).where(eq(identities.id, id)).returning().get()!
}

// Idee.

// Niente transform né refine: lo schema passa così com'è al server MCP, che lo converte in JSON Schema.
export const ideaInput = z.object({
  kind: z.enum(IDEA_KINDS).describe('product: un prodotto didap adattato al suo settore; custom: sviluppo o AI su misura; quick: un lavoro veloce che sistema un difetto dell\'audit'),
  title: z.string().trim().min(1).max(120),
  pitch: z.string().trim().min(1).max(800).describe('Cosa gli cambia, in due o tre frasi, con le sue parole e non con quelle tecniche'),
  effort: z.string().trim().max(60).default('').describe('Sforzo per didap, es. tre giorni, due settimane'),
  priceBand: z.string().trim().max(60).default('').describe('Fascia di prezzo indicativa, es. 1.500-3.000 euro'),
  portfolioSlug: z.string().trim().max(80).nullable().default(null).describe('Slug della voce del portfolio più vicina, che fa da prova'),
})

export function listIdeas(db: Db, prospectId: number): Idea[] {
  return db.select().from(ideas).where(eq(ideas.prospectId, prospectId)).orderBy(asc(ideas.id)).all()
}

function getProspectRow(db: Db, id: number): Prospect {
  const row = db.select().from(prospects).where(eq(prospects.id, id)).get()
  if (!row) throw new OutreachError('NOT_FOUND', `Il prospect ${id} non esiste`)
  return row
}

/** Le idee nuove prendono il posto delle vecchie: ne restano da 1 a 3, le ultime scritte. */
export function saveIdeas(db: Db, prospectId: number, raw: z.input<typeof ideaInput>[], jobId: number | null): Idea[] {
  getProspectRow(db, prospectId)
  const list = z.array(ideaInput).min(1).max(3).parse(raw)
  const slugs = list.map(i => i.portfolioSlug).filter((s): s is string => !!s)
  if (slugs.length) {
    const known = new Set(db.select({ slug: portfolioItems.slug }).from(portfolioItems).where(inArray(portfolioItems.slug, slugs)).all().map(r => r.slug))
    const missing = slugs.filter(s => !known.has(s))
    if (missing.length) throw new OutreachError('INVALID_INPUT', `Voci del portfolio che non esistono: ${missing.join(', ')}`)
  }
  return db.transaction((tx) => {
    tx.delete(ideas).where(eq(ideas.prospectId, prospectId)).run()
    return list.map(i => tx.insert(ideas).values({ ...i, prospectId, jobId }).returning().get())
  })
}

// Campagne.

export const campaignInput = z.object({
  name: z.string().trim().min(1).max(120),
  segmentId: z.number().int().positive(),
  identityId: z.number().int().positive(),
  language: z.enum(LANGUAGES),
  steps: z.array(z.object({ day: z.number().int().min(0).max(90), channel: z.enum(CHANNELS) })).min(1).max(8),
  notes: z.string().trim().max(4000).default(''),
})

export function getCampaign(db: Db, id: number): Campaign {
  const row = db.select().from(campaigns).where(eq(campaigns.id, id)).get()
  if (!row) throw new OutreachError('NOT_FOUND', `La campagna ${id} non esiste`)
  return row
}

export function saveCampaign(db: Db, id: number | null, raw: z.input<typeof campaignInput>): Campaign {
  const input = campaignInput.parse(raw)
  if (!db.select({ id: segments.id }).from(segments).where(eq(segments.id, input.segmentId)).get()) {
    throw new OutreachError('INVALID_INPUT', `Il segmento ${input.segmentId} non esiste`)
  }
  getIdentity(db, input.identityId)
  const values = { ...input, steps: [...input.steps].sort((a, b) => a.day - b.day), updatedAt: new Date() }
  if (id === null) return db.insert(campaigns).values(values).returning().get()
  getCampaign(db, id)
  return db.update(campaigns).set(values).where(eq(campaigns.id, id)).returning().get()!
}

export function setCampaignStatus(db: Db, id: number, status: CampaignStatus): Campaign {
  getCampaign(db, id)
  return db.update(campaigns).set({ status, updatedAt: new Date() }).where(eq(campaigns.id, id)).returning().get()!
}

/** Per ogni passo, se la matrice lo ammette per un'azienda trovata dall'agente nel mercato del segmento. */
export function campaignLegalPreview(db: Db, campaign: Pick<Campaign, 'segmentId' | 'steps'>) {
  const segment = db.select({ market: segments.market }).from(segments).where(eq(segments.id, campaign.segmentId)).get()
  return campaign.steps.map(step => ({ ...step, ...checkChannel('b2b_optout', segment?.market ?? '', step.channel) }))
}

export function listCampaigns(db: Db) {
  const rows = db.select({ campaign: campaigns, segmentName: segments.name, market: segments.market, identityName: identities.name })
    .from(campaigns)
    .innerJoin(segments, eq(segments.id, campaigns.segmentId))
    .innerJoin(identities, eq(identities.id, campaigns.identityId))
    .orderBy(desc(campaigns.id)).all()
  const counts = db.select({ campaignId: messages.campaignId, status: messages.status, n: sql<number>`count(*)` })
    .from(messages).groupBy(messages.campaignId, messages.status).all()
  return rows.map(r => ({
    ...r.campaign,
    segmentName: r.segmentName,
    market: r.market,
    identityName: r.identityName,
    messages: Object.fromEntries(counts.filter(c => c.campaignId === r.campaign.id).map(c => [c.status, c.n])) as Partial<Record<MessageStatus, number>>,
  }))
}

// Messaggi.

export const draftInput = z.object({
  campaignId: z.number().int().positive(),
  prospectId: z.number().int().positive(),
  step: z.number().int().min(0).max(7).describe('Indice del passo nella sequenza della campagna, da 0'),
  subject: z.string().trim().max(200).nullable().default(null).describe('Oggetto, solo per le email'),
  body: z.string().trim().min(1).max(5000),
  ideaId: z.number().int().positive().nullable().default(null).describe('L\'idea su cui si appoggia il messaggio'),
})

/**
 * Bozza scritta da un job. Il canale e la lingua vengono dalla campagna, la matrice legale
 * decide se si può. Una bozza ancora da approvare per lo stesso passo si riscrive.
 */
export function draftMessage(db: Db, raw: z.input<typeof draftInput>, jobId: number | null): Message {
  const input = draftInput.parse(raw)
  const campaign = getCampaign(db, input.campaignId)
  const prospect = getProspectRow(db, input.prospectId)
  if (prospect.segmentId !== campaign.segmentId) throw new OutreachError('INVALID_INPUT', `Il prospect ${prospect.id} non è nel segmento della campagna`)
  const step = campaign.steps[input.step]
  if (!step) throw new OutreachError('INVALID_INPUT', `La campagna ha ${campaign.steps.length} passi: il passo ${input.step} non c'è`)
  const verdict = checkChannel(prospect.legalBasis, prospect.country, step.channel)
  if (!verdict.allowed) throw new OutreachError('NOT_ALLOWED', verdict.reason)
  if (step.channel === 'email' && !input.subject) throw new OutreachError('INVALID_INPUT', 'Un\'email ha bisogno dell\'oggetto')
  if (input.ideaId && !db.select({ id: ideas.id }).from(ideas).where(and(eq(ideas.id, input.ideaId), eq(ideas.prospectId, prospect.id))).get()) {
    throw new OutreachError('INVALID_INPUT', `L'idea ${input.ideaId} non è di questo prospect`)
  }

  const existing = db.select().from(messages)
    .where(and(eq(messages.campaignId, campaign.id), eq(messages.prospectId, prospect.id), eq(messages.step, input.step))).get()
  if (existing && existing.status !== 'pending') throw new OutreachError('NOT_PENDING', `Il passo ${input.step} per questo prospect è già deciso (${existing.status})`)
  const values = {
    campaignId: campaign.id,
    prospectId: prospect.id,
    identityId: campaign.identityId,
    step: input.step,
    channel: step.channel,
    language: campaign.language,
    subject: step.channel === 'email' ? input.subject : null,
    body: input.body,
    ideaId: input.ideaId,
    legalBasis: prospect.legalBasis,
    jobId,
  }
  if (existing) {
    return db.update(messages).set({ ...values, telegramMessageId: null, notifiedAt: null, editedAt: null }).where(eq(messages.id, existing.id)).returning().get()!
  }
  return db.insert(messages).values(values).returning().get()
}

export function getMessage(db: Db, id: number): Message {
  const row = db.select().from(messages).where(eq(messages.id, id)).get()
  if (!row) throw new OutreachError('NOT_FOUND', `Il messaggio ${id} non esiste`)
  return row
}

export const messageEditInput = z.object({
  subject: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().min(1).max(5000),
})

/** Correzione di William: si può solo finché il messaggio aspetta l'approvazione. */
export function editMessage(db: Db, id: number, raw: z.input<typeof messageEditInput>): Message {
  const message = getMessage(db, id)
  if (message.status !== 'pending') throw new OutreachError('NOT_PENDING', 'Il messaggio è già stato deciso')
  const input = messageEditInput.parse(raw)
  const subject = message.channel === 'email' ? (input.subject === undefined ? message.subject : input.subject || null) : null
  if (message.channel === 'email' && !subject) throw new OutreachError('INVALID_INPUT', 'Un\'email ha bisogno dell\'oggetto')
  return db.update(messages).set({ subject, body: input.body, editedAt: new Date() }).where(eq(messages.id, id)).returning().get()!
}

/** Approva o scarta. Prima di approvare la matrice si ricontrolla: la base legale può essere cambiata. */
export function decideMessage(db: Db, id: number, decision: 'approve' | 'discard', via: 'dashboard' | 'telegram'): Message {
  const message = getMessage(db, id)
  if (message.status !== 'pending') throw new OutreachError('NOT_PENDING', 'Il messaggio è già stato deciso')
  const prospect = getProspectRow(db, message.prospectId)
  if (decision === 'approve') {
    const verdict = checkChannel(prospect.legalBasis, prospect.country, message.channel)
    if (!verdict.allowed) throw new OutreachError('NOT_ALLOWED', verdict.reason)
  }
  const row = db.update(messages)
    .set({ status: decision === 'approve' ? 'approved' : 'discarded', decidedAt: new Date() })
    .where(and(eq(messages.id, id), eq(messages.status, 'pending'))).returning().get()
  if (!row) throw new OutreachError('NOT_PENDING', 'Il messaggio è già stato deciso')
  logActivity(db, `${decision === 'approve' ? 'Approvato' : 'Scartato'} ${via === 'telegram' ? 'da Telegram ' : ''}il messaggio ${CHANNEL_LABEL[row.channel]} per ${prospect.name}`)
  return row
}

/** Il messaggio con quello che serve per deciderlo: prospect, difetti principali, idee, campagna, mittente. */
export function messageContext(db: Db, message: Message) {
  const prospect = getProspectRow(db, message.prospectId)
  const audit = db.select({ issues: audits.issues, performance: audits.performance }).from(audits)
    .where(and(eq(audits.prospectId, prospect.id), eq(audits.status, 'done'))).orderBy(desc(audits.id)).limit(1).get()
  const campaign = message.campaignId ? db.select({ id: campaigns.id, name: campaigns.name, steps: campaigns.steps }).from(campaigns).where(eq(campaigns.id, message.campaignId)).get() : undefined
  const identity = db.select({ name: identities.name }).from(identities).where(eq(identities.id, message.identityId)).get()
  return {
    ...message,
    prospect: { id: prospect.id, name: prospect.name, city: prospect.city, country: prospect.country, website: prospect.website, score: prospect.score, legalBasis: prospect.legalBasis },
    issues: (audit?.issues ?? []).slice(0, 3),
    ideas: listIdeas(db, prospect.id).map(i => ({ id: i.id, kind: i.kind, title: i.title, priceBand: i.priceBand })),
    campaign: campaign ? { id: campaign.id, name: campaign.name, day: campaign.steps[message.step]?.day ?? null } : null,
    identityName: identity?.name ?? '',
  }
}

export type MessageWithContext = ReturnType<typeof messageContext>

export function listMessages(db: Db, opts: { status?: MessageStatus, campaignId?: number, prospectId?: number, limit?: number } = {}): Message[] {
  return db.select().from(messages)
    .where(and(
      opts.status ? eq(messages.status, opts.status) : undefined,
      opts.campaignId ? eq(messages.campaignId, opts.campaignId) : undefined,
      opts.prospectId ? eq(messages.prospectId, opts.prospectId) : undefined,
    ))
    .orderBy(asc(messages.id))
    .limit(opts.limit ?? 200)
    .all()
}

/** La coda di approvazione, dalla bozza più vecchia. */
export function approvalQueue(db: Db): MessageWithContext[] {
  return listMessages(db, { status: 'pending' }).map(m => messageContext(db, m))
}

export function pendingCount(db: Db): number {
  return db.select({ n: sql<number>`count(*)` }).from(messages).where(eq(messages.status, 'pending')).get()?.n ?? 0
}

// Job di idee e bozze.

function lots<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export const WRITING_RULES = [
  'Solo fatti veri: quelli del prospect (prospect_get) e quelli del portfolio. Niente numeri, clienti o risultati inventati.',
  'Come prova vale solo una voce del portfolio con status approved; il nome del cliente o del prodotto si fa solo se citable è true, altrimenti si descrive il lavoro senza nomi.',
]

export function ideasPrompt(ids: number[]): string {
  return [
    `Scrivi le idee su misura per questi prospect di Marketer: ${ids.join(', ')}.`,
    '',
    'Come lavorare:',
    '1. Chiama portfolio_list con status approved (e, se servono indizi, senza filtro): sono i prodotti e i lavori di didap da adattare.',
    '2. Per ogni prospect chiama prospect_get: settore, dimensione, sito e difetti trovati dall\'audit.',
    '3. Per ogni prospect chiama idea_save con 2 o 3 idee concrete, di tipo diverso: un prodotto didap adattato al suo settore (product), uno sviluppo o un\'idea AI su misura (custom), un lavoro veloce che sistema il difetto più grave dell\'audit (quick, solo se l\'audit c\'è).',
    '4. Ogni idea ha un pitch con le parole del cliente, lo sforzo per didap, una fascia di prezzo realistica per una PMI e lo slug della voce del portfolio più vicina.',
    ...WRITING_RULES.map(r => `- ${r}`),
    '5. Alla fine registra con activity_log una frase sola: per quanti prospect hai scritto le idee.',
  ].join('\n')
}

/** Job di idee per i prospect indicati, a lotti. */
export function enqueueIdeas(db: Db, prospectIds: number[], source: JobSource): Job[] {
  const ids = [...new Set(prospectIds)]
  if (!ids.length) throw new OutreachError('NOTHING_TO_DO', 'Nessun prospect indicato')
  const found = db.select({ id: prospects.id }).from(prospects).where(inArray(prospects.id, ids)).all().map(r => r.id)
  const missing = ids.filter(id => !found.includes(id))
  if (missing.length) throw new OutreachError('NOT_FOUND', `Prospect che non esistono: ${missing.join(', ')}`)
  const parts = lots(ids, IDEAS_LOT)
  return parts.map((part, i) => enqueueJob(db, {
    title: parts.length > 1 ? `Idee: ${part.length} prospect (${i + 1} di ${parts.length})` : `Idee: ${part.length === 1 ? `prospect ${part[0]}` : `${part.length} prospect`}`,
    prompt: ideasPrompt(part),
    cwd: process.cwd(),
    permission: 'read',
  }, source, IDEAS_JOB_KIND))
}

const CHANNEL_RULES: Record<(typeof CHANNELS)[number], string> = {
  email: 'email: oggetto corto e specifico (niente maiuscole né punti esclamativi), corpo sotto le 120 parole, una sola domanda finale facile (es. se ha senso sentirsi 15 minuti). Niente opt-out: lo aggiunge l\'invio.',
  linkedin: 'LinkedIn: se è il primo passo è la nota di collegamento, massimo 280 caratteri; dopo, un messaggio breve che riprende il primo contatto.',
  phone: 'telefono: è lo script per chi chiama, in punti: apertura in una frase, il motivo (il difetto o l\'idea), due domande per capire, la proposta di un incontro. Chi chiama non legge, segue.',
  whatsapp: 'WhatsApp: massimo 500 caratteri, tono diretto, una domanda.',
}

export function draftsPrompt(campaign: Campaign, identity: Identity, market: string, targets: { id: number, steps: number[] }[]): string {
  const stepLines = campaign.steps.map((s, i) => `- passo ${i}: giorno ${s.day}, ${CHANNEL_LABEL[s.channel]}`)
  const channels = [...new Set(campaign.steps.map(s => s.channel))]
  return [
    `Prepara le bozze della campagna «${campaign.name}» (id ${campaign.id}) di Marketer. Ogni bozza va in coda di approvazione: William la legge prima che parta.`,
    '',
    `Mercato ${market}, lingua dei messaggi: ${LANGUAGE_NAME[campaign.language]}.`,
    `Firma: ${identity.name}${identity.role ? `, ${identity.role}` : ''}, didap.${identity.signature ? ` Firma completa da mettere in fondo alle email:\n${identity.signature}` : ''}`,
    'Sequenza:',
    ...stepLines,
    campaign.notes ? `Indicazioni di William per questa campagna: ${campaign.notes}` : '',
    '',
    'Prospect e passi da scrivere (gli altri passi la matrice legale non li ammette):',
    ...targets.map(t => `- prospect ${t.id}: passi ${t.steps.join(', ')}`),
    '',
    'Come lavorare:',
    '1. Chiama portfolio_list con status approved: sono le prove che puoi usare.',
    '2. Per ogni prospect chiama prospect_get e strategy_get con il suo prospectId: se ha una strategia (meglio se approved), seguila per chi contattare, agganci e tono; il suo primo messaggio è un punto di partenza, senza la riga per non ricevere altro, che aggiunge l\'invio. Se non ha idee, scrivile prima con idea_save (2 o 3, come in un job di idee) e rileggi il prospect per avere gli id.',
    '3. Per ogni passo indicato chiama message_draft con campaignId, prospectId, step, il testo e l\'idea su cui si appoggia. I passi dopo il primo sono follow-up: brevi, riprendono il primo messaggio senza ripeterlo, aggiungono una cosa nuova.',
    '4. L\'aggancio è il fatto più concreto che riguarda lui: il difetto più grave del sito, la sua novità, il suo settore. Poi l\'idea, poi la prova dal portfolio. Mai un elenco di servizi didap.',
    '5. Regole per canale:',
    ...channels.map(c => `   - ${CHANNEL_RULES[c]}`),
    ...WRITING_RULES.map(r => `- ${r}`),
    '- Niente toni da agenzia, niente complimenti generici, niente trattini lunghi né medi.',
    '6. Se message_draft rifiuta un passo per la matrice legale, saltalo e vai avanti.',
    '7. Alla fine registra con activity_log una frase sola: quante bozze hai scritto e per quanti prospect.',
  ].filter(l => l !== '').join('\n')
}

/**
 * Bozze di una campagna per i prospect qualificati del suo segmento che non ne hanno ancora,
 * a lotti. Solo i passi che la matrice ammette per ciascuno.
 */
export function enqueueDrafts(db: Db, campaignId: number, source: JobSource): Job[] {
  const campaign = getCampaign(db, campaignId)
  if (campaign.status === 'paused') throw new OutreachError('INVALID_INPUT', 'La campagna è in pausa')
  const title = `Bozze: ${campaign.name}`
  const running = db.select({ id: jobs.id }).from(jobs)
    .where(and(eq(jobs.kind, DRAFTS_JOB_KIND), sql`${jobs.title} like ${`${title}%`}`, inArray(jobs.status, ['queued', 'running']))).get()
  if (running) throw new OutreachError('JOB_RUNNING', `Ci sono già bozze in preparazione per questa campagna: job ${running.id}`)
  const identity = getIdentity(db, campaign.identityId)
  const segment = db.select({ market: segments.market }).from(segments).where(eq(segments.id, campaign.segmentId)).get()!

  const candidates = db.select().from(prospects)
    .where(and(
      eq(prospects.segmentId, campaign.segmentId),
      eq(prospects.status, 'qualified'),
      notExists(db.select({ id: messages.id }).from(messages).where(and(eq(messages.campaignId, campaign.id), eq(messages.prospectId, prospects.id)))),
    ))
    .orderBy(desc(prospects.score)).all()
  const targets = candidates
    .map(p => ({ id: p.id, steps: campaign.steps.map((s, i) => (checkChannel(p.legalBasis, p.country, s.channel).allowed ? i : -1)).filter(i => i >= 0) }))
    .filter(t => t.steps.length)
  if (!targets.length) {
    throw new OutreachError('NOTHING_TO_DO', candidates.length
      ? 'La matrice legale non ammette nessun passo per i prospect qualificati di questo segmento'
      : 'Nessun prospect qualificato senza bozze in questo segmento: qualificane qualcuno dalla sua scheda')
  }
  const parts = lots(targets, DRAFTS_LOT)
  return parts.map((part, i) => enqueueJob(db, {
    title: parts.length > 1 ? `${title} (${i + 1} di ${parts.length})` : title,
    prompt: draftsPrompt(campaign, identity, segment.market, part),
    cwd: process.cwd(),
    permission: 'read',
  }, source, DRAFTS_JOB_KIND))
}
