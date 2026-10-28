/** Ricarica i dati a intervalli finché la pagina è aperta e visibile. */
export function useIntervalRefresh(refresh: () => Promise<unknown>, ms: number) {
  if (import.meta.server) return
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh()
  }, ms)
  onBeforeUnmount(() => clearInterval(timer))
}
