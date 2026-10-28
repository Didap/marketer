import { z } from 'zod'
import { useDb } from '../db/client'
import type { MessageStatus, PortfolioKind, PortfolioStatus, ProspectStatus } from '../db/schema'
import { JOB_STATUSES, MESSAGE_STATUSES, PORTFOLIO_KINDS, PORTFOLIO_STATUSES, PROSPECT_STATUSES } from '../db/schema'
import { cancelJob, enqueueJob, getJob, jobInput, lastJobEvents, listJobs, logActivity, overview } from '../lib/jobs'
import { enqueuePortfolioImport, getPortfolioItem, ignoreSource, listPortfolio, listSources, portfolioBrief, portfolioUpsertInput, upsertFromAgent } from '../lib/portfolio'
import { draftInput, draftMessage, ideaInput, listIdeas, listMessages, messageContext, saveIdeas } from '../lib/outreach'
import type { ProspectRow } from '../lib/prospects'
import { enqueueStrategy, getStrategy, MAX_TARGETS, saveStrategy, strategiesFor, strategySaveInput, strategyTargets, strategyWriteInput } from '../lib/strategies'
import { createSegment, enqueueSearch, linkedinInput, listProspects, listSegments, prospectDetail, saveLinkedin, segmentFields } from '../lib/prospects'

// I tool di Marketer. Li usa Claude Code da terminale e li usano i job lanciati dal runner.

export interface McpToolContext {
  /** Il job da cui arriva la chiamata, se arriva da un job del runner. */
  jobId: number | null
}

export interface McpTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodObject
  readonly handler: (ctx: McpToolContext, args: any) => unknown
}

export class McpToolError extends Error {}

function jobView(job: ReturnType<typeof getJob>) {
  return {
    id: job.id,
    title: job.title,
    status: job.status,
    cwd: job.cwd,
    permission: job.permission,
    source: job.source,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    weightedTokens: job.weightedTokens,
    costUsd: job.costUsd,
    error: job.error,
  }
}

function noJobs(ctx: McpToolContext): void {
  if (ctx.jobId !== null) {
    throw new McpToolError('Un job non può accodare altri job: scrivi nel risultato finale cosa andrebbe fatto.')
  }
}

function prospectBrief(p: ProspectRow) {
  return {
    id: p.id,
    name: p.name,
    country: p.country,
    city: p.city,
    website: p.website,
    segment: p.segmentName,
    sector: p.sectorLabel ?? p.sectorCode,
    employees: p.employeesMin === null && p.employeesMax === null ? null : `${p.employeesMin ?? '?'}-${p.employeesMax ?? '?'}`,
    foundedAt: p.foundedAt,
    population: p.population,
    electedAt: p.electedAt,
    politicalSide: p.politicalSide,
    status: p.status,
    score: p.score,
    fit: p.fitScore,
    need: p.needScore,
    fresh: p.freshScore,
    audit: p.auditStatus,
    issues: p.issues,
  }
}

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: 'marketer_status',
    description: 'Stato di Marketer: worker vivo o fermo, job in coda e in corso, token pesati spesi oggi contro il tetto giornaliero.',
    inputSchema: z.object({}),
    handler: () => overview(useDb()),
  },
  {
    name: 'job_enqueue',
    description: 'Mette in coda un job: il worker lancia Claude Code (Opus) nella cartella indicata con questo prompt, senza nessuno al terminale. Permessi: read (legge e cerca) o edit (anche modifica file). Parte quando la coda è libera e il tetto dei token lo permette.',
    inputSchema: jobInput.extend({
      permission: z.enum(['read', 'edit']).default('read'),
    }),
    handler: (ctx, args) => {
      noJobs(ctx)
      return jobView(enqueueJob(useDb(), args, 'mcp'))
    },
  },
  {
    name: 'job_list',
    description: 'Ultimi job, dal più recente, con stato, token pesati e costo di listino.',
    inputSchema: z.object({
      status: z.enum(JOB_STATUSES).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    handler: (_ctx, args: { status?: typeof JOB_STATUSES[number], limit: number }) =>
      listJobs(useDb(), args).map(jobView),
  },
  {
    name: 'job_get',
    description: 'Un job con prompt, risultato e le ultime righe del suo log.',
    inputSchema: z.object({
      id: z.number().int().positive(),
      events: z.number().int().min(0).max(200).default(30),
    }),
    handler: (_ctx, args: { id: number, events: number }) => {
      const db = useDb()
      const job = getJob(db, args.id)
      return {
        ...jobView(job),
        prompt: job.prompt,
        result: job.result,
        log: lastJobEvents(db, job.id, args.events).map(e => `[${e.kind}] ${e.summary}`),
      }
    },
  },
  {
    name: 'job_cancel',
    description: 'Annulla un job in coda, o ferma un job in corso.',
    inputSchema: z.object({ id: z.number().int().positive() }),
    handler: (_ctx, args: { id: number }) => jobView(cancelJob(useDb(), args.id)),
  },
  {
    name: 'activity_log',
    description: 'Registra una cosa fatta dall\'agente, in una frase: compare nella pagina Oggi della dashboard.',
    inputSchema: z.object({ text: z.string().trim().min(1).max(500) }),
    handler: (ctx, args: { text: string }) => {
      logActivity(useDb(), args.text, ctx.jobId)
      return { ok: true }
    },
  },
  {
    name: 'portfolio_list',
    description: 'Voci del portfolio didap in breve: prodotti, casi studio, clienti passati. Come prova in un messaggio valgono solo le voci approved, e il nome si fa solo se citable.',
    inputSchema: z.object({
      kind: z.enum(PORTFOLIO_KINDS).optional(),
      status: z.enum(PORTFOLIO_STATUSES).optional(),
      q: z.string().trim().max(100).optional().describe('Cerca in nome, sintesi, settori e cliente'),
    }),
    handler: (_ctx, args: { kind?: PortfolioKind, status?: PortfolioStatus, q?: string }) =>
      listPortfolio(useDb(), args).map(portfolioBrief),
  },
  {
    name: 'portfolio_get',
    description: 'Una voce del portfolio per intero, con le note di William e l\'eventuale aggiornamento proposto.',
    inputSchema: z.object({ slug: z.string().trim().min(1).max(80) }),
    handler: (_ctx, args: { slug: string }) => {
      const { proposal, notes, ...item } = getPortfolioItem(useDb(), args.slug)
      return { ...item, notes, proposal: proposal?.fields ?? null }
    },
  },
  {
    name: 'portfolio_upsert',
    description: 'Crea o aggiorna una voce del portfolio cercandola per slug. Una voce nuova nasce da rivedere. Se William l\'ha già rivista o corretta, i campi diversi diventano una proposta che lui applica o scarta. Le fonti si sommano a quelle che la voce ha già. Risponde con outcome: created, updated, proposed o unchanged.',
    inputSchema: portfolioUpsertInput,
    handler: (ctx, args) => upsertFromAgent(useDb(), args, ctx.jobId),
  },
  {
    name: 'portfolio_sources',
    description: 'Fonti del portfolio trovate sul disco (repo e schede del sito didap) con lo stato: new, changed, imported, ignored.',
    inputSchema: z.object({}),
    handler: () => listSources(useDb()).map(s => ({
      path: s.path,
      kind: s.kind,
      name: s.name,
      files: s.files,
      state: s.state,
      ignoredReason: s.ignoredReason,
      items: s.items.map(i => i.slug),
    })),
  },
  {
    name: 'portfolio_skip_source',
    description: 'Segna una fonte come non da portfolio (strumento interno, esperimento, copia di un altro repo) con il motivo in una frase. Gli import la saltano finché William non la riprende.',
    inputSchema: z.object({
      path: z.string().trim().min(1).max(1024),
      reason: z.string().trim().min(1).max(300),
    }),
    handler: (ctx, args: { path: string, reason: string }) => {
      ignoreSource(useDb(), args.path, args.reason, ctx.jobId)
      return { ok: true }
    },
  },
  {
    name: 'portfolio_import',
    description: 'Mette in coda i job che leggono le fonti del portfolio e scrivono le voci da rivedere: quelle indicate, oppure tutte le nuove e le cambiate. Un job ogni 8 fonti circa.',
    inputSchema: z.object({ paths: z.array(z.string().trim().min(1).max(1024)).max(100).optional() }),
    handler: (ctx, args: { paths?: string[] }) => {
      noJobs(ctx)
      return enqueuePortfolioImport(useDb(), args.paths, 'mcp').map(jobView)
    },
  },
  {
    name: 'segment_list',
    description: 'Segmenti di mercato in cui Marketer cerca prospect, dal punteggio più alto: mercato, settore, ricerche, stato (proposed, active, paused) e numeri dei prospect.',
    inputSchema: z.object({}),
    handler: () => listSegments(useDb()).map(s => ({
      id: s.id,
      name: s.name,
      market: s.market,
      sector: s.sector,
      description: s.description,
      status: s.status,
      queries: s.queries,
      prospects: s.prospects,
      audited: s.audited,
      qualified: s.qualified,
      score: s.score,
    })),
  },
  {
    name: 'segment_propose',
    description: 'Propone un segmento nuovo: nasce proposed, e lo accende William dalla dashboard. Ogni ricerca ha una fonte: places (Google Maps, testo con la zona), it_registry (Registro Imprese: ATECO e provincia), fr_registry (registro francese: NAF e dipartimento).',
    inputSchema: segmentFields,
    handler: (ctx, args) => {
      const segment = createSegment(useDb(), args, { status: 'proposed', jobId: ctx.jobId })
      return { id: segment.id, status: segment.status }
    },
  },
  {
    name: 'segment_search',
    description: 'Mette in coda le ricerche di un segmento: il worker legge le fonti, salva i prospect, analizza i siti e calcola i punteggi. Google Maps e Registro Imprese sono a pagamento.',
    inputSchema: z.object({ segmentId: z.number().int().positive() }),
    handler: (ctx, args: { segmentId: number }) => {
      noJobs(ctx)
      return enqueueSearch(useDb(), args.segmentId).map(s => ({ id: s.id, source: s.query.source, status: s.status }))
    },
  },
  {
    name: 'prospect_list',
    description: 'Prospect dal punteggio più alto, con fit, bisogno (dai difetti del sito), freschezza e stato dell\'audit. Filtri per segmento, stato e punteggio minimo.',
    inputSchema: z.object({
      segmentId: z.number().int().positive().optional(),
      status: z.enum(PROSPECT_STATUSES).optional(),
      minScore: z.number().int().min(0).max(100).optional(),
      q: z.string().trim().max(100).optional().describe('Cerca in nome, città e sito'),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    handler: (_ctx, args: { segmentId?: number, status?: ProspectStatus, minScore?: number, q?: string, limit: number }) =>
      listProspects(useDb(), args).map(prospectBrief),
  },
  {
    name: 'prospect_get',
    description: 'Un prospect per intero: dati dell\'azienda o del Comune, persone da contattare (per un Comune sindaco e giunta, più i segnali dai dati aperti da citare con la fonte: rigenerazione urbana, digitale, strumenti di segnalazione, manutenzione), base legale, punteggi, segmento e ultimo audit del sito con stack e difetti (i difetti sono gli agganci per i messaggi).',
    inputSchema: z.object({ id: z.number().int().positive() }),
    handler: (_ctx, args: { id: number }) => {
      const db = useDb()
      const { prospect, segment, contacts, comune, audit } = prospectDetail(db, args.id)
      return {
        ...prospect,
        // Email istituzionali e deleghe dal sito del Comune (pnpm contatti); angles: perché conta per CityFix.
        // Tutto tranne le chiavi interne, e senza i campi vuoti: sono token per l'agente.
        contacts: contacts.map(({ id: _id, prospectId: _p, source: _s, createdAt: _c, ...c }) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== null))),
        // Per un Comune: il fit reale e i fatti da citare, ognuno con la sua fonte.
        comune: comune && { fit: comune.fit, max: comune.max, signals: comune.signals },
        ideas: listIdeas(db, prospect.id).map(({ id, kind, title, pitch, effort, priceBand, portfolioSlug }) => ({ id, kind, title, pitch, effort, priceBand, portfolioSlug })),
        messages: listMessages(db, { prospectId: prospect.id }).map(m => ({ id: m.id, campaignId: m.campaignId, step: m.step, channel: m.channel, status: m.status })),
        segment: segment ? { id: segment.id, name: segment.name, sector: segment.sector, market: segment.market } : null,
        audit: audit && {
          at: audit.finishedAt,
          url: audit.finalUrl ?? audit.url,
          https: audit.https,
          mobile: audit.mobile,
          performance: audit.performance,
          accessibility: audit.accessibility,
          seo: audit.seo,
          bestPractices: audit.bestPractices,
          lcpMs: audit.lcpMs,
          stack: audit.stack,
          hasForm: audit.hasForm,
          hasBooking: audit.hasBooking,
          issues: audit.issues,
        },
      }
    },
  },
  {
    name: 'idea_save',
    description: 'Salva da 1 a 3 idee su misura per un prospect: prendono il posto di quelle che aveva. Ogni idea ha tipo, titolo, pitch, sforzo, fascia di prezzo e la voce del portfolio più vicina.',
    inputSchema: z.object({
      prospectId: z.number().int().positive(),
      ideas: z.array(ideaInput).min(1).max(3),
    }),
    handler: (ctx, args: { prospectId: number, ideas: z.input<typeof ideaInput>[] }) =>
      saveIdeas(useDb(), args.prospectId, args.ideas, ctx.jobId).map(i => ({ id: i.id, kind: i.kind, title: i.title })),
  },
  {
    name: 'contact_linkedin_save',
    description: 'Salva quello che hai visto di una persona (prospectId e nome come in prospect_get) su LinkedIn: il profilo, se è attiva (post o attività recenti), poco attiva (solo il profilo) o assente (allora url null), e la prova in una frase.',
    inputSchema: linkedinInput,
    handler: (_ctx, args) => {
      const c = saveLinkedin(useDb(), args)
      return { name: c.name, activity: c.linkedinActivity }
    },
  },
  {
    name: 'strategy_save',
    description: 'Salva la strategia di contatto che stai scrivendo (strategyId dal prompt): titolo, sintesi, corpo in markdown, persone da contattare per prime e primo messaggio. William la rivede prima di usarla.',
    inputSchema: strategySaveInput,
    handler: (ctx, args) => {
      const s = saveStrategy(useDb(), args, ctx.jobId)
      return { id: s.id, title: s.title, status: s.status }
    },
  },
  {
    name: 'strategy_get',
    description: 'Le strategie di contatto da seguire per un prospect (prospectId: prima l\'approvata, niente archiviate, al massimo due) o una per id: sintesi, corpo, persone da contattare per prime e primo messaggio. Da leggere prima di scrivere bozze per quel prospect.',
    inputSchema: z.object({ id: z.number().int().positive().optional(), prospectId: z.number().int().positive().optional() }),
    handler: (_ctx, args: { id?: number, prospectId?: number }) => {
      const db = useDb()
      if (args.prospectId) return strategiesFor(db, args.prospectId)
      if (!args.id) throw new McpToolError('INVALID_INPUT: serve id o prospectId')
      const s = getStrategy(db, args.id)
      return { ...s, targets: strategyTargets(db, s).map(t => t.name) }
    },
  },
  {
    name: 'strategy_write',
    description: `Mette in coda un job di Opus che scrive la strategia di contatto per un target o per un gruppo (fino a ${MAX_TARGETS} prospect), da tutti i loro dati e dal portfolio, nel rispetto della matrice legale.`,
    inputSchema: strategyWriteInput,
    handler: (ctx, args: z.output<typeof strategyWriteInput>) => {
      noJobs(ctx)
      const { strategy, job } = enqueueStrategy(useDb(), args.prospectIds, 'mcp', { title: args.title, notes: args.notes })
      return { strategyId: strategy.id, jobId: job.id }
    },
  },
  {
    name: 'message_draft',
    description: 'Scrive la bozza di un passo di una campagna per un prospect. Canale, lingua e mittente vengono dalla campagna; la matrice legale può rifiutarla (NOT_ALLOWED). La bozza va in coda di approvazione: non parte niente senza William. Una bozza ancora da approvare per lo stesso passo si riscrive.',
    inputSchema: draftInput,
    handler: (ctx, args) => {
      const m = draftMessage(useDb(), args, ctx.jobId)
      return { id: m.id, channel: m.channel, status: m.status }
    },
  },
  {
    name: 'message_list',
    description: 'Messaggi con il loro contesto (prospect, difetti principali, idee, campagna): di default quelli da approvare.',
    inputSchema: z.object({
      status: z.enum(MESSAGE_STATUSES).default('pending'),
      campaignId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    handler: (_ctx, args: { status: MessageStatus, campaignId?: number, limit: number }) => {
      const db = useDb()
      return listMessages(db, args).map(m => messageContext(db, m))
    },
  },
]
