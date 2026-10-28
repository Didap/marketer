import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db/client'
import type { Job, JobSource, JobStatus, Strategy } from '../db/schema'
import { CHANNELS, jobs, prospectContacts, prospects, STRATEGY_STATUSES, strategies } from '../db/schema'
import { personKey } from './comuni'
import { enqueueJob, isFinal, logActivity } from './jobs'
import type { LegalVerdict } from './legal'
import { checkChannel } from './legal'
import { CHANNEL_LABEL, WRITING_RULES } from './outreach'

// Le strategie di contatto, per un target o per un gruppo di target: un job di Opus le scrive da tutti
// i dati dei prospect (segnali, persone e deleghe, colore politico, freschezza, audit) e dal portfolio,
// rispettando la matrice legale. William le rivede, le corregge e le approva.

export const STRATEGY_JOB_KIND = 'strategy'
/** Oltre, una strategia di gruppo diventa generica: meglio dividere il gruppo. */
export const MAX_TARGETS = 30

export class StrategyError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'INVALID_INPUT' | 'BUSY', message: string) {
    super(message)
  }
}

/** Chi avvia una strategia: dashboard o MCP. */
export const strategyWriteInput = z.object({
  prospectIds: z.array(z.number().int().positive()).min(1).max(MAX_TARGETS),
  title: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(4000).optional().describe('Indicazioni di William per la prima scrittura'),
})

export const strategySaveInput = z.object({
  strategyId: z.number().int().positive(),
  summary: z.string().trim().min(1).max(600).describe('In due frasi: perché questo target, perché adesso, con quale proposta'),
  body: z.string().trim().min(200).max(20_000).describe('La strategia in markdown, con le sezioni chieste'),
  firstContacts: z.array(z.object({
    prospectId: z.number().int().positive(),
    name: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(80),
    why: z.string().trim().min(1).max(400),
  })).max(10).describe('Chi contattare per primo, in ordine, con il perché'),
  openingSubject: z.string().trim().max(120).nullable(),
  openingBody: z.string().trim().max(3000).nullable().describe('Il primo messaggio; per un gruppo il testo di base, con {Comune} e {Nome} da adattare'),
})

/** William cambia titolo, note, stato e il primo messaggio; il resto del testo è del job, e si rifà con Riscrivi. */
export const strategyEditInput = z.object({
  title: z.string().trim().min(1).max(100).optional(),
  notes: z.string().trim().max(4000).optional(),
  status: z.enum(STRATEGY_STATUSES).optional(),
  openingSubject: strategySaveInput.shape.openingSubject.unwrap().min(1).optional(),
  openingBody: strategySaveInput.shape.openingBody.unwrap().min(1).optional(),
})

export function getStrategy(db: Db, id: number): Strategy {
  const row = db.select().from(strategies).where(eq(strategies.id, id)).get()
  if (!row) throw new StrategyError('NOT_FOUND', `La strategia ${id} non esiste`)
  return row
}

/** writing: Opus la sta scrivendo; failed: il job è finito senza scriverla; ready: c'è il testo. */
export type StrategyState = 'writing' | 'failed' | 'ready'

export function strategyState(jobStatus: JobStatus | null, body: string): StrategyState {
  if (jobStatus && !isFinal({ status: jobStatus })) return 'writing'
  return body ? 'ready' : 'failed'
}

const jobStatusOf = (db: Db, strategy: Pick<Strategy, 'jobId'>) =>
  strategy.jobId ? db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, strategy.jobId)).get()?.status ?? null : null

const forProspect = (prospectId: number) => sql`exists (select 1 from json_each(${strategies.prospectIds}) where value = ${prospectId})`

/** Le strategie per gli elenchi, dalla più recente: solo quello che si mostra, con i nomi dei target e lo stato. */
export function listStrategies(db: Db, opts: { prospectId?: number } = {}) {
  const rows = db.select({
    id: strategies.id,
    title: strategies.title,
    status: strategies.status,
    summary: strategies.summary,
    prospectIds: strategies.prospectIds,
    updatedAt: strategies.updatedAt,
    jobStatus: jobs.status,
    written: sql<number>`length(${strategies.body}) > 0`,
  }).from(strategies).leftJoin(jobs, eq(jobs.id, strategies.jobId))
    .where(opts.prospectId ? forProspect(opts.prospectId) : undefined).orderBy(desc(strategies.id)).all()
  const ids = [...new Set(rows.flatMap(r => r.prospectIds))]
  const names = new Map(ids.length ? db.select({ id: prospects.id, name: prospects.name }).from(prospects).where(inArray(prospects.id, ids)).all().map(p => [p.id, p.name]) : [])
  return rows.map(({ jobStatus, written, ...r }) => ({
    ...r,
    state: strategyState(jobStatus, written ? 'x' : ''),
    targets: r.prospectIds.map(id => ({ id, name: names.get(id) ?? `prospect ${id}` })),
  }))
}

/** Le strategie da seguire per un prospect, per i job: niente archiviate, prima l'approvata, al massimo due. */
export function strategiesFor(db: Db, prospectId: number) {
  return db.select({
    id: strategies.id,
    title: strategies.title,
    status: strategies.status,
    summary: strategies.summary,
    body: strategies.body,
    firstContacts: strategies.firstContacts,
    openingSubject: strategies.openingSubject,
    openingBody: strategies.openingBody,
  }).from(strategies).where(and(forProspect(prospectId), ne(strategies.status, 'archived'), sql`length(${strategies.body}) > 0`))
    .orderBy(sql`${strategies.status} = 'approved' desc`, desc(strategies.id)).limit(2).all()
}

/** I target, per mostrare una strategia: i nomi e quello che serve alla matrice legale. */
export function strategyTargets(db: Db, strategy: Pick<Strategy, 'prospectIds'>) {
  return db.select({ id: prospects.id, name: prospects.name, city: prospects.city, legalBasis: prospects.legalBasis, country: prospects.country }).from(prospects)
    .where(inArray(prospects.id, strategy.prospectIds)).all()
}

/** Una strategia per la sua pagina: il testo, i target, lo stato, le persone da contattare con email e LinkedIn, e se il primo messaggio si apre nella posta. */
export function strategyDetail(db: Db, id: number) {
  const strategy = getStrategy(db, id)
  const targets = strategyTargets(db, strategy)
  const ids = [...new Set(strategy.firstContacts.map(c => c.prospectId))]
  const key = (prospectId: number, name: string) => `${prospectId}:${personKey(name)}`
  const people = new Map(ids.length
    ? db.select({
        prospectId: prospectContacts.prospectId,
        name: prospectContacts.name,
        email: prospectContacts.email,
        linkedinUrl: prospectContacts.linkedinUrl,
        linkedinActivity: prospectContacts.linkedinActivity,
      }).from(prospectContacts).where(inArray(prospectContacts.prospectId, ids)).all().map(p => [key(p.prospectId, p.name), p])
    : [])
  const contacts = strategy.firstContacts.map((c) => {
    const p = people.get(key(c.prospectId, c.name))
    return { ...c, email: p?.email ?? null, linkedinUrl: p?.linkedinUrl ?? null, linkedinActivity: p?.linkedinActivity ?? null }
  })
  const first = contacts[0]
  const target = first && targets.find(t => t.id === first.prospectId)
  const mail = first?.email && target ? openingMail(strategy, first.email, checkChannel(target.legalBasis, target.country, 'email')) : null
  return { strategy, targets, state: strategyState(jobStatusOf(db, strategy), strategy.body), contacts, mail }
}

/** Il primo messaggio nella posta: solo dove la matrice ammette l'email, a strategia approvata e con il testo di gruppo adattato. */
function openingMail(strategy: Strategy, to: string, verdict: LegalVerdict): { href: string | null, note: string } {
  const { openingSubject: subject, openingBody: body } = strategy
  if (!verdict.allowed) return { href: null, note: `Email non ammessa: ${verdict.reason}` }
  if (strategy.status !== 'approved') return { href: null, note: 'Si apre nella posta dopo l\'approvazione.' }
  if (/\{(Nome|Comune)\}/.test(`${subject} ${body}`)) return { href: null, note: 'Adatta {Comune} e {Nome} prima di aprirlo nella posta.' }
  return { href: `mailto:${to}?subject=${encodeURIComponent(subject ?? '')}&body=${encodeURIComponent(body ?? '')}`, note: verdict.reason }
}

/** Il job scrive la strategia nella riga creata quando è partito: solo il suo, e il testo nuovo torna da rivedere. */
export function saveStrategy(db: Db, raw: z.input<typeof strategySaveInput>, jobId: number | null): Strategy {
  const input = strategySaveInput.parse(raw)
  const strategy = getStrategy(db, input.strategyId)
  if (jobId !== null && strategy.jobId !== jobId) throw new StrategyError('INVALID_INPUT', `La strategia ${strategy.id} la sta scrivendo il job ${strategy.jobId}, non questo`)
  const outside = input.firstContacts.filter(c => !strategy.prospectIds.includes(c.prospectId))
  if (outside.length) throw new StrategyError('INVALID_INPUT', `Persone di prospect fuori dalla strategia: ${outside.map(c => c.name).join(', ')}`)
  const { strategyId, ...fields } = input
  // Il titolo ce l'hanno già la pagina e il file .md.
  const body = fields.body.replace(/^#[ \t].*\s*/, '')
  return db.update(strategies).set({ ...fields, body, status: 'draft', updatedAt: new Date() }).where(eq(strategies.id, strategyId)).returning().get()!
}

export function editStrategy(db: Db, id: number, raw: z.input<typeof strategyEditInput>): Strategy {
  const strategy = getStrategy(db, id)
  const input = strategyEditInput.parse(raw)
  const state = strategyState(jobStatusOf(db, strategy), strategy.body)
  if (input.status === 'approved' && state !== 'ready') throw new StrategyError('BUSY', 'Si approva quando Opus ha finito di scriverla')
  // Il job, salvando, riscriverebbe il messaggio sopra le modifiche.
  if ((input.openingSubject || input.openingBody) && state === 'writing') throw new StrategyError('BUSY', 'Il messaggio si ritocca quando Opus ha finito di riscriverla')
  return db.update(strategies).set({ ...input, updatedAt: new Date() }).where(eq(strategies.id, id)).returning().get()!
}

export function strategyPrompt(strategy: Strategy, targets: { id: number, name: string, verdicts: string[] }[]): string {
  const group = targets.length > 1
  return [
    `Scrivi la strategia di contatto ${group ? `per questo gruppo di ${targets.length} target` : 'per questo target'} di Marketer e salvala con strategy_save (strategyId ${strategy.id}).`,
    '',
    'Target, con quello che la matrice legale ammette per ogni canale:',
    ...targets.flatMap(t => [`- ${t.name} (prospect ${t.id})`, ...t.verdicts.map(v => `  - ${v}`)]),
    ...(strategy.notes ? ['', `Indicazioni di William: ${strategy.notes}`] : []),
    '',
    'Come lavorare:',
    '1. Per ogni target chiama prospect_get: persone (con email, deleghe e angles, cioè perché contano), segnali dai dati aperti con la fonte, colore politico, data di elezione della giunta, punteggi, audit.',
    '2. Chiama portfolio_list (prima approved, poi anche draft) e portfolio_get della voce più vicina al target (per i Comuni il prodotto per la pubblica amministrazione): offerta, risultati e note di William.',
    `3. LinkedIn: per le persone che pensi di contattare per prime (al massimo 6 ricerche in tutto, prima la prima persona di ogni target) cerca con WebSearch il profilo (nome, cognome, ente, ruolo). Non aprire linkedin.com con WebFetch: chiede l'accesso. Dai risultati decidi: attivo se trovi post o attività degli ultimi sei mesi, poco_attivo se c'è solo il profilo, assente se non c'è un profilo sicuramente suo (un omonimo non conta, e allora niente indirizzo). Salva con contact_linkedin_save (prospectId e nome come in prospect_get), con l'indirizzo del profilo e la prova in una frase. Se linkedinCheckedAt è di meno di sei mesi, non rifare la ricerca.`,
    '4. Scrivi la strategia in markdown con queste sezioni (## titolo; niente titolo #, la pagina ce l\'ha):',
    '   - In breve: chi, perché adesso, con quale proposta, in tre righe.',
    '   - Perché adesso: la freschezza (giunta eletta da quanti mesi, cosa si decide in questa fase) e i segnali che dicono che il tema è vivo.',
    '   - Chi contattare: in ordine, con nome, ruolo, deleghe, email, LinkedIn (attivo, poco attivo, assente, o da verificare per chi non hai cercato) e perché; chi mettere in copia e chi tenere per dopo.',
    '   - Gli agganci: da 3 a 5 fatti da citare, presi dai segnali, ognuno con la sua fonte.',
    '   - Il tono: rilassato e cordiale, dando del Lei ma senza formule burocratiche; la proposta e le sue condizioni sono quelle della voce del portfolio. A un Comune la proposta si porge come un regalo alla città e ai suoi cittadini, mai alla persona (un amministratore non può accettare regali personali), e semplice da attivare, con quasi nessun lavoro per gli uffici. Il colore politico serve solo a scegliere parole e priorità (per esempio centrodestra: decoro, sicurezza urbana, efficienza della spesa, imprese del territorio; centrosinistra: partecipazione, trasparenza, servizi ai cittadini, ambiente; civica: concretezza e risultati visibili). Mai nominarlo nei messaggi, mai giudizi politici.',
    '   - Canali e sequenza: i passi in ordine, con canale, momento e contenuto. Usa solo i canali che la matrice ammette per quel target: se l\'email non è ammessa dillo e proponi la strada ammessa (telefono, LinkedIn a mano, un incontro). Dove è ammessa, l\'email va all\'indirizzo della persona (email del contatto in prospect_get), mai alla PEC o al protocollo dell\'ente, alle condizioni del verdetto. Se la persona non ha un\'email, dillo (per un Comune la trova pnpm contatti) e parti dal telefono alla segreteria. LinkedIn si aggiunge solo con chi è attivo, mai al posto dell\'email. Se non risponde, un richiamo breve e poi il telefono alla segreteria. L\'obiettivo è una chiamata di 10 minuti.',
    '   - Obiezioni e risposte: le 3 o 4 più probabili (costi, bilancio, privacy, «abbiamo già un modulo», tempi), con la risposta dai fatti del portfolio.',
    '   - Prossimi passi per William: cosa fare questa settimana, concreto.',
    ...(group ? ['   - Differenze tra i target: una tabella con target, persona da contattare, aggancio principale, canale.'] : []),
    '5. Scrivi il primo messaggio (openingSubject e openingBody): per la prima persona da contattare, sul primo canale della sequenza. Nella lingua del mercato del target (italiano per l\'Italia), sotto le 120 parole, da William di didap, con il tono detto sopra: il regalo alla città in una frase, perché è semplice da attivare, uno o due fatti veri del target, e come unica domanda finale una chiamata di 10 minuti. Oggetto corto e leggero, non da circolare. Chiudi con una riga per chi non vuole altri messaggi (per esempio «Se preferisce non ricevere altre comunicazioni, me lo scriva e non la ricontatterò»).' + (group ? ' Per un gruppo è il testo di base, con {Comune} e {Nome} dove cambia.' : ''),
    '6. firstContacts: le persone da contattare per prime, in ordine, con prospectId, nome come in prospect_get (senza titoli: la pagina ci trova email e LinkedIn), ruolo e il perché in una frase.',
    '',
    'Regole:',
    ...WRITING_RULES.map(r => `- ${r}`),
    '- Le deduzioni che non vengono dai dati (per esempio la stagione turistica) si scrivono come ipotesi, non come fatti.',
    '- Niente trattini lunghi né medi.',
    '',
    `7. Alla fine registra con activity_log una frase sola: per chi hai scritto la strategia.`,
  ].join('\n')
}

/** Una strategia nuova (o riscritta, se c'è strategyId: torna da rivedere) e il job che la scrive. */
export function enqueueStrategy(db: Db, prospectIds: number[], source: JobSource, opts: { title?: string, notes?: string, strategyId?: number } = {}): { strategy: Strategy, job: Job } {
  const ids = [...new Set(prospectIds)]
  if (!ids.length) throw new StrategyError('INVALID_INPUT', 'Nessun target indicato')
  if (ids.length > MAX_TARGETS) throw new StrategyError('INVALID_INPUT', `Al massimo ${MAX_TARGETS} target per strategia: dividi il gruppo`)
  const rows = db.select({ id: prospects.id, name: prospects.name, legalBasis: prospects.legalBasis, country: prospects.country })
    .from(prospects).where(inArray(prospects.id, ids)).all()
  const missing = ids.filter(id => !rows.some(r => r.id === id))
  if (missing.length) throw new StrategyError('NOT_FOUND', `Prospect che non esistono: ${missing.join(', ')}`)
  const existing = opts.strategyId ? getStrategy(db, opts.strategyId) : null
  if (existing && strategyState(jobStatusOf(db, existing), existing.body) === 'writing') throw new StrategyError('BUSY', `Opus la sta già scrivendo (job ${existing.jobId})`)
  const title = existing?.title ?? (opts.title?.trim() || (rows.length === 1 ? rows[0]!.name : `Gruppo di ${rows.length} target`)).slice(0, 100)
  const strategy = existing ?? db.insert(strategies).values({ title, prospectIds: ids, notes: opts.notes ?? '' }).returning().get()
  const targets = rows.map(r => ({
    id: r.id,
    name: r.name,
    verdicts: CHANNELS.map((c) => {
      const v = checkChannel(r.legalBasis, r.country, c)
      return `${CHANNEL_LABEL[c]}: ${v.allowed ? 'ammesso' : 'non ammesso'} (${v.reason})`
    }),
  }))
  let job: Job
  try {
    job = enqueueJob(db, { title: `Strategia: ${title}`, prompt: strategyPrompt(strategy, targets), cwd: process.cwd(), permission: 'read' }, source, STRATEGY_JOB_KIND)
  }
  catch (err) {
    // Senza il suo job una strategia nuova resterebbe vuota per sempre.
    if (!existing) db.delete(strategies).where(eq(strategies.id, strategy.id)).run()
    throw err
  }
  logActivity(db, `Strategia «${title}»: in scrittura (job ${job.id})`)
  // Riscritta, torna da rivedere.
  const updated = db.update(strategies).set({ prospectIds: ids, jobId: job.id, status: 'draft', updatedAt: new Date() }).where(eq(strategies.id, strategy.id)).returning().get()!
  return { strategy: updated, job }
}

/** La strategia come file markdown, da salvare o condividere. */
export function strategyMarkdown(strategy: Strategy, targets: { name: string }[]): string {
  return [
    `# ${strategy.title}`,
    '',
    `Target: ${targets.map(t => t.name).join(', ')}`,
    '',
    strategy.summary,
    '',
    strategy.body,
    ...(strategy.openingBody ? ['', '## Il primo messaggio', '', `**Oggetto:** ${strategy.openingSubject ?? ''}`, '', strategy.openingBody] : []),
    '',
  ].join('\n')
}
