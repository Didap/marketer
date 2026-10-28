import type { Audit, Prospect } from '../db/schema'
import { REPORTING_TOOLS } from './audit'
import { isComune } from './comuni'
import type { ComuneProfile } from './signals'

// Il punteggio di un prospect, da 0 a 100: fit (chi è), bisogno (cosa non va nel suo sito),
// freschezza (da quanto è nato il segnale). Come in Explee, i segmenti si ordinano per punteggio.
// I Comuni hanno metri loro: abitanti, uno strumento di segnalazione già in casa, giunta appena eletta.

export interface ScoreInput {
  prospect: Pick<Prospect, 'employeesMin' | 'employeesMax' | 'website' | 'phone' | 'placeId' | 'foundedAt' | 'source' | 'population' | 'electedAt' | 'profile'>
  /** L'ultimo audit chiuso, se c'è. */
  audit: Pick<Audit, 'status' | 'issues' | 'stack'> | null
  /** Il settore del segmento compare tra quelli del portfolio confermato: null se il portfolio è ancora vuoto. */
  portfolioMatch: boolean | null
  today: Date
}

export interface Score {
  fit: number
  need: number | null
  fresh: number
  score: number
}

/** Bisogno che si assume quando non si sa ancora nulla del sito. */
const UNKNOWN_NEED = 30
const SEVERITY_WEIGHT = { 1: 5, 2: 12, 3: 25 } as const

function sizePoints(min: number | null, max: number | null): number {
  if (min === null && max === null) return 20
  // Le PMI sono il bersaglio: le grandi aziende comprano con gare e fornitori già scelti.
  if ((min ?? 0) >= 250) return 10
  if ((min ?? 0) >= 10) return 40
  const size = max ?? min ?? 0
  if (size >= 10) return 35
  if (size >= 3) return 30
  if (size >= 1) return 15
  return 5
}

/** Settore già lavorato e un modo per raggiungerlo: vale per aziende e Comuni. */
function portfolioAndReach(input: ScoreInput): number {
  const { prospect, portfolioMatch } = input
  const portfolio = portfolioMatch === null ? 15 : portfolioMatch ? 30 : 0
  const reach = prospect.website ? 30 : prospect.phone ? 15 : 0
  return portfolio + reach
}

export function fitScore(input: ScoreInput): number {
  return sizePoints(input.prospect.employeesMin, input.prospect.employeesMax) + portfolioAndReach(input)
}

/** Senza audit il bisogno è sconosciuto, salvo quando Google Maps conosce l'azienda e non ha un sito. */
export function needScore(input: ScoreInput): number | null {
  const { prospect, audit } = input
  if (!prospect.website) return prospect.placeId ? 70 : null
  if (audit?.status !== 'done') return null
  const sum = audit.issues.reduce((acc, i) => acc + SEVERITY_WEIGHT[i.severity], 0)
  return Math.min(100, sum)
}

/** Gli anni passati da una data AAAA-MM-GG, o null se non c'è. */
function yearsSince(date: string | null, today: Date): number | null {
  if (!date || Number.isNaN(Date.parse(date))) return null
  return (today.getTime() - Date.parse(date)) / (365.25 * 24 * 3600 * 1000)
}

export function freshScore(input: ScoreInput): number {
  const years = yearsSince(input.prospect.foundedAt, input.today)
  if (years === null) return 20
  if (years < 1) return 100
  if (years < 2) return 70
  if (years < 3) return 40
  return 10
}

/** I Comuni piccolissimi hanno poche segnalazioni e poco bilancio, le città comprano con gare lunghe. */
function populationPoints(population: number | null): number {
  if (population === null) return 20
  if (population >= 50_000) return 30
  if (population >= 15_000) return 40
  if (population >= 5_000) return 35
  if (population >= 3_000) return 25
  if (population >= 1_000) return 15
  return 5
}

/** Una giunta appena eletta cerca progetti da fare nel mandato. */
function electionPoints(years: number | null): number {
  if (years === null) return 20
  if (years < 0.5) return 100
  if (years < 1) return 80
  if (years < 2) return 50
  if (years < 3) return 30
  return 10
}

export interface ComuneFit {
  /** Proattività sulla rigenerazione urbana, da 0 a 40. */
  regeneration: number
  /** Propensione al digitale, da 0 a 30. */
  digital: number
  /** Spazio per CityFix: nessuno strumento di segnalazione vale 30, una piattaforma già in casa 6. */
  space: number
  /** Il bisogno: quanta manutenzione affida, da 10 a 100. */
  maintenance: number
}

/** I massimi delle parti, per chi le mostra. */
export const COMUNE_FIT_MAX: ComuneFit = { regeneration: 40, digital: 30, space: 30, maintenance: 100 }

/** Il fit reale di un Comune per CityFix, dai segnali dei dati aperti. */
export function comuneFit(p: ComuneProfile): ComuneFit {
  // Chi ha già progetti di rigenerazione è proattivo; poi conta quanto, per abitante, rispetto alla regione.
  const regeneration = p.regeneration.amount > 0 ? 10 + Math.round(30 * p.regeneration.rank) : 0
  // Quasi tutti hanno almeno 4 misure di PA digitale 2026: conta chi ne ha di più, e il sito sul modello nazionale.
  const digital = Math.min(25, Math.max(0, (p.digital.measures.length - 3) * 5)) + (p.digital.modelSite ? 5 : 0)
  const taken = p.reporting?.kind === 'piattaforma' || p.maintenance.purchases.length > 0
  const space = taken ? 6 : p.reporting?.kind === 'modulo' ? 22 : p.reporting?.kind === 'nessuno' ? 30 : 20
  const maintenance = p.maintenance.contracts ? 20 + Math.round(80 * p.maintenance.rank) : 10
  return { regeneration, digital, space, maintenance }
}

/**
 * Un Comune: con i segnali dei dati aperti, fit reale (rigenerazione, digitale, spazio libero) e bisogno
 * dalla manutenzione che affida; senza, abitanti e strumenti di segnalazione in home. La giunta appena
 * eletta pesa di più.
 */
function scoreComune(input: ScoreInput): Score {
  const { prospect, audit } = input
  let fit: number
  let need: number | null
  if (prospect.profile) {
    const parts = comuneFit(prospect.profile)
    fit = parts.regeneration + parts.digital + parts.space
    need = parts.maintenance
  }
  else {
    fit = populationPoints(prospect.population) + portfolioAndReach(input)
    // Il bisogno sono le segnalazioni, non i difetti del sito.
    const reporting = audit?.status === 'done' && audit.stack.some(s => REPORTING_TOOLS.has(s.name))
    need = prospect.website && audit?.status === 'done' ? (reporting ? 20 : 70) : null
  }
  const fresh = electionPoints(yearsSince(prospect.electedAt, input.today))
  return { fit, need, fresh, score: Math.round(0.3 * fit + 0.3 * (need ?? UNKNOWN_NEED) + 0.4 * fresh) }
}

export function scoreProspect(input: ScoreInput): Score {
  if (isComune(input.prospect)) return scoreComune(input)
  const fit = fitScore(input)
  const need = needScore(input)
  const fresh = freshScore(input)
  return { fit, need, fresh, score: Math.round(0.4 * fit + 0.4 * (need ?? UNKNOWN_NEED) + 0.2 * fresh) }
}

/** Il punteggio di un segmento: la media dei suoi dieci prospect migliori. */
export function segmentScore(scores: (number | null)[]): number | null {
  const top = scores.filter((s): s is number => s !== null).sort((a, b) => b - a).slice(0, 10)
  return top.length ? Math.round(top.reduce((a, b) => a + b, 0) / top.length) : null
}
