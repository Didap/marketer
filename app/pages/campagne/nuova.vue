<script setup lang="ts">
const api = useApi()
const toast = useToast()
const route = useRoute()

const form = ref<CampaignForm>({ ...emptyCampaignForm(), segmentId: route.query.segmento ? Number(route.query.segmento) : undefined })
const sending = ref(false)

async function submit() {
  sending.value = true
  try {
    const campaign = await api<{ id: number }>('/api/campaigns', { method: 'POST', body: form.value })
    await refreshNuxtData('campaigns')
    await navigateTo(`/campagne/${campaign.id}`, { replace: true })
  }
  catch (err) {
    toast.add({ title: 'Campagna non creata', description: apiErrorMessage(err), color: 'error' })
  }
  finally {
    sending.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="campagna-nuova">
    <template #header>
      <UDashboardNavbar title="Nuova campagna">
        <template #leading>
          <UButton to="/campagne" icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Torna alle campagne" />
        </template>
        <template #right>
          <UButton icon="i-lucide-check" label="Crea" :loading="sending" :disabled="!form.name.trim() || !form.segmentId || !form.identityId" @click="submit" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <p class="text-sm text-muted">Le bozze si scrivono solo per i prospect che hai qualificato. Ogni bozza passa dalla coda di approvazione.</p>
      <UCard>
        <CampaignFormFields v-model="form" />
      </UCard>
    </template>
  </UDashboardPanel>
</template>
