// Le scritture verso l'API portano x-marketer: il server rifiuta quelle senza (difesa CSRF).
// L'URL è una stringa semplice: le rotte tipizzate di $fetch fanno esplodere il typecheck.
type ApiFetch = <T = unknown>(url: string, opts?: { method?: 'GET' | 'POST' | 'PUT', body?: object }) => Promise<T>

export function useApi(): ApiFetch {
  return $fetch.create({ headers: { 'x-marketer': '1' } }) as unknown as ApiFetch
}

/** Messaggio leggibile da un errore di $fetch. */
export function apiErrorMessage(err: unknown): string {
  const data = (err as { data?: { message?: string } })?.data
  return data?.message || (err instanceof Error ? err.message : 'Errore sconosciuto')
}
