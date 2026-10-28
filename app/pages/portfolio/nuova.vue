<script setup lang="ts">
const api = useApi()
const toast = useToast()

const form = ref<PortfolioForm>(emptyPortfolioForm())
const sending = ref(false)

async function submit() {
  sending.value = true
  try {
    const item = await api<{ id: number }>('/api/portfolio', { method: 'POST', body: fromPortfolioForm(form.value) })
    await refreshNuxtData('portfolio-all')
    await navigateTo(`/portfolio/${item.id}`, { replace: true })
  }
  catch (err) {
    toast.add({ title: 'Voce non creata', description: apiErrorMessage(err), color: 'error' })
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="portfolio-nuova">
    <template #header>
      <UDashboardNavbar title="Nuova voce">
        <template #leading>
          <UButton to="/portfolio" icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Torna al portfolio" />
        </template>
        <template #right>
          <UButton icon="i-lucide-check" label="Crea" :loading="sending" :disabled="!form.name.trim()" @click="submit" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <p class="text-sm text-muted">Una voce scritta a mano nasce già confermata: per esempio un cliente passato che non ha un repo.</p>
      <UCard>
        <PortfolioFormFields v-model="form" />
      </UCard>
    </template>
  </UDashboardPanel>
</template>
