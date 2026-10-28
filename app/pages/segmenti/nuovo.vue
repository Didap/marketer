<script setup lang="ts">
const api = useApi()
const toast = useToast()

const { data } = await useFetch('/api/segments', { key: 'segments' })
const form = ref<SegmentForm>(emptySegmentForm())
const sending = ref(false)

async function submit() {
  sending.value = true
  try {
    const segment = await api<{ id: number }>('/api/segments', { method: 'POST', body: fromSegmentForm(form.value) })
    await refreshNuxtData('segments')
    await navigateTo(`/segmenti/${segment.id}`, { replace: true })
  }
  catch (err) {
    toast.add({ title: 'Segmento non creato', description: apiErrorMessage(err), color: 'error' })
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="segmento-nuovo">
    <template #header>
      <UDashboardNavbar title="Nuovo segmento">
        <template #leading>
          <UButton to="/segmenti" icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Torna ai segmenti" />
        </template>
        <template #right>
          <UButton icon="i-lucide-check" label="Crea" :loading="sending" :disabled="!form.name.trim() || !form.sector.trim()" @click="submit" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <p class="text-sm text-muted">Un segmento scritto a mano nasce attivo. Le ricerche partono quando premi Cerca nella sua scheda.</p>
      <UCard>
        <SegmentFormFields v-model="form" :sources="data?.sources" />
      </UCard>
    </template>
  </UDashboardPanel>
</template>
