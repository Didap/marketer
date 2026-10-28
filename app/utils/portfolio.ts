// Etichette e modulo del portfolio.

export type PortfolioKind = 'product' | 'case' | 'client'
export type PortfolioStatus = 'draft' | 'approved' | 'archived'
export type SourceState = 'new' | 'changed' | 'imported' | 'ignored'
type BadgeColor = 'neutral' | 'info' | 'success' | 'error' | 'warning' | 'primary'

export const KIND_LABEL: Record<PortfolioKind, string> = {
  product: 'Prodotto',
  case: 'Caso studio',
  client: 'Cliente',
}

export const PORTFOLIO_STATUS_LABEL: Record<PortfolioStatus, string> = {
  draft: 'Da rivedere',
  approved: 'Confermato',
  archived: 'Escluso',
}

export const PORTFOLIO_STATUS_COLOR: Record<PortfolioStatus, BadgeColor> = {
  draft: 'warning',
  approved: 'success',
  archived: 'neutral',
}

export const SOURCE_STATE_LABEL: Record<SourceState, string> = {
  new: 'Nuova',
  changed: 'Cambiata',
  imported: 'Importata',
  ignored: 'Ignorata',
}

export const SOURCE_STATE_COLOR: Record<SourceState, BadgeColor> = {
  new: 'info',
  changed: 'warning',
  imported: 'success',
  ignored: 'neutral',
}

/** Il modulo di una voce, con stringhe vuote al posto dei null per i campi di testo. */
export interface PortfolioForm {
  kind: PortfolioKind
  name: string
  summary: string
  sectors: string[]
  client: string
  problem: string
  solution: string
  results: string
  stack: string
  url: string
  year: number | null
  tags: string[]
  related: string[]
  citable: boolean
  notes: string
}

export type PortfolioFieldKey = Exclude<keyof PortfolioForm, 'notes'>

export const FIELD_LABEL: Record<PortfolioFieldKey, string> = {
  kind: 'Tipo',
  name: 'Nome',
  summary: 'Sintesi',
  sectors: 'Settori',
  client: 'Cliente',
  problem: 'Problema',
  solution: 'Soluzione',
  results: 'Risultati',
  stack: 'Stack',
  url: 'Sito',
  year: 'Anno',
  tags: 'Tag',
  related: 'Voci collegate',
  citable: 'Citabile',
}

export function emptyPortfolioForm(): PortfolioForm {
  return {
    kind: 'product',
    name: '',
    summary: '',
    sectors: [],
    client: '',
    problem: '',
    solution: '',
    results: '',
    stack: '',
    url: '',
    year: null,
    tags: [],
    related: [],
    citable: false,
    notes: '',
  }
}

type FormSource = Omit<PortfolioForm, 'client' | 'url'> & { client: string | null, url: string | null }

export function toPortfolioForm(item: FormSource): PortfolioForm {
  const form = emptyPortfolioForm()
  for (const key of Object.keys(form) as (keyof PortfolioForm)[]) {
    (form as unknown as Record<string, unknown>)[key] = structuredClone(item[key]) ?? form[key]
  }
  return form
}

/** Il modulo come lo vuole l'API: null per i campi facoltativi vuoti. */
export function fromPortfolioForm(form: PortfolioForm) {
  const year = form.year === null || String(form.year) === '' ? null : Number(form.year)
  return { ...form, client: form.client.trim() || null, url: form.url.trim() || null, year }
}

/** Un valore proposto o corrente in una riga di testo. */
export function formatFieldValue(key: PortfolioFieldKey, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(vuoto)'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(vuoto)'
  if (key === 'kind') return KIND_LABEL[value as PortfolioKind] ?? String(value)
  if (key === 'citable') return value ? 'Sì' : 'No'
  return String(value)
}

export function shortPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~')
}
