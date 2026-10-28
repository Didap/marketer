/** Avvia una strategia per uno o più prospect e apre la sua pagina, dove si vede Opus che la scrive. */
export function useStartStrategy() {
  const api = useApi()
  const toast = useToast()
  const starting = ref(false)
  async function start(prospectIds: number[]) {
    starting.value = true
    try {
      const { strategy } = await api<{ strategy: { id: number } }>('/api/strategies', { method: 'POST', body: { prospectIds } })
      await navigateTo(`/strategie/${strategy.id}`)
    }
    catch (err) {
      toast.add({ title: 'Strategia non partita', description: apiErrorMessage(err), color: 'error' })
    }
    finally {
      starting.value = false
    }
  }
  return { start, starting }
}
