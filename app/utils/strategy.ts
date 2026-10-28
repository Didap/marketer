// Etichette delle strategie di contatto.

export type StrategyStatus = 'draft' | 'approved' | 'archived'

export const STRATEGY_STATUS_LABEL: Record<StrategyStatus, string> = {
  draft: 'Da rivedere',
  approved: 'Approvata',
  archived: 'Archiviata',
}

export type StrategyState = 'writing' | 'failed' | 'ready'

/** La riga di una strategia in elenco: in scrittura, non riuscita o la sua sintesi. */
export function strategyLine(s: { summary: string, state: StrategyState }): string {
  if (s.state === 'writing') return 'In scrittura...'
  return s.state === 'failed' ? 'Non riuscita: aprila e riscrivila.' : s.summary
}

export const STRATEGY_STATUS_COLOR: Record<StrategyStatus, 'neutral' | 'success' | 'info'> = {
  draft: 'info',
  approved: 'success',
  archived: 'neutral',
}
