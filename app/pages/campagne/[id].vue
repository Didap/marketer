<script setup lang="ts">
const route = useRoute()
const api = useApi()
const toast = useToast()
const id = Number(route.params.id)

const { data, error, refresh } = await useFetch(`/api/campaigns/${id}`)
useIntervalRefresh(refresh, 5000)
const campaign = computed(() => data.value?.campaign)

const form = ref<CampaignForm>(emptyCampaignForm())
const savedSnapshot = ref('')
const dirty = computed(() => JSON.stringify(form.value) !== savedSnapshot.value)
const busy = ref(false)
const filter = ref<MessageStatus | 'all'>('pending')

function load() {
  const c = campaign.value
  if (!c) return
  form.value = { name: c.name, segmentId: c.segmentId, identityId: c.identityId, language: c.language, steps: c.steps.map(s => ({ ...s })), notes: c.notes }
  savedSnapshot.value = JSON.stringify(form.value)
}
watch(() => campaign.value?.updatedAt, load, { immediate: true })

async function act(request: () => Promise<unknown>, failTitle: string) {
  busy.value = true
  try {
    const result = await request()
    await refresh()
    return result ?? true
  }
  catch (err) {
    toast.add({ title: failTitle, description: apiErrorMessage(err), color: 'error' })
    return false
  }
  finally {
    busy.value = false
  }
}

const save = () => act(() => api(`/api/campaigns/${id}`, { method: 'PUT', body: form.value }), 'Campagna non salvata')

async function setStatus(status: CampaignStatus) {
  if (dirty.value && !(await save())) return
  await act(() => api(`/api/campaigns/${id}/status`, { method: 'POST', body: { status } }), 'Stato non cambiato')
}

async function drafts() {
  if (dirty.value && !(await save())) return
  const jobs = await act(() => api<{ id: number }[]>(`/api/campaigns/${id}/drafts`, { method: 'POST' }), 'Bozze non partite')
  if (Array.isArray(jobs)) {
    toast.add({
      title: jobs.length === 1 ? 'Bozze in preparazione' : `${jobs.length} job di bozze in coda`,
      description: 'Arrivano in Approvazioni man mano che il job le scrive.',
      actions: [{ label: 'Apri il job', to: `/job/${jobs[0]!.id}` }],
    })
  }
}

const filterItems = [{ value: 'all', label: 'Tutti' }, ...optionsOf(MESSAGE_STATUS_LABEL)]
const shown = computed(() => (data.value?.messages ?? []).filter(m => filter.value === 'all' || m.status === filter.value))
</script>

<template>
  <UDashboardPanel id="campagna">
    <template #header>
      <UDashboardNavbar :title="campaign?.name ?? 'Campagna'">
        <template #leading>
          <UButton to="/campagne" icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Torna alle campagne" />
        </template>
        <template v-if="campaign" #right>
          <UBadge :color="CAMPAIGN_STATUS_COLOR[campaign.status]" variant="subtle" :label="CAMPAIGN_STATUS_LABEL[campaign.status]" />
          <UButton v-if="campaign.status === 'active'" color="neutral" variant="outline" icon="i-lucide-pause" label="Metti in pausa" :disabled="busy" @click="setStatus('paused')" />
          <UButton v-else color="neutral" variant="outline" icon="i-lucide-play" label="Attiva" :disabled="busy" @click="setStatus('active')" />
          <UButton color="neutral" variant="outline" icon="i-lucide-save" label="Salva" :disabled="!dirty || busy" @click="save" />
          <UButton
            icon="i-lucide-pen-line" :label="`Prepara bozze (${data?.qualified ?? 0} qualificati)`"
            :loading="!!data?.drafting" :disabled="busy || !!data?.drafting || campaign.status === 'paused'" @click="drafts"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="subtle" :title="error.statusCode === 404 ? 'Questa campagna non esiste' : 'Campagna non caricata'" />

      <template v-if="campaign">
        <UAlert
          v-if="data?.drafting" icon="i-lucide-loader" color="info" variant="subtle"
          :title="data.drafting.status === 'running' ? 'Bozze in preparazione' : 'Bozze in coda'"
          :actions="[{ label: `Job ${data.drafting.id}`, to: `/job/${data.drafting.id}`, color: 'neutral', variant: 'outline' }]"
        />
        <p class="text-sm text-muted">
          Le bozze si scrivono per i prospect qualificati del segmento che non ne hanno ancora. L'invio arriva con la Fase 5:
          per ora un messaggio approvato aspetta.
        </p>

        <UCard>
          <CampaignFormFields v-model="form" />
        </UCard>

        <div class="flex items-center justify-between">
          <h2 class="font-medium">Messaggi</h2>
          <USelect v-model="filter" :items="filterItems" class="w-44" />
        </div>
        <MessageCard v-for="m in shown" :key="m.id" :message="m" @changed="refresh" />
        <p v-if="!shown.length" class="text-sm text-muted">Nessun messaggio{{ filter === 'all' ? '' : ' in questo stato' }}.</p>
      </template>
    </template>
  </UDashboardPanel>
</template>
