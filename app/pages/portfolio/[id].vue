<script setup lang="ts">
const route = useRoute()
const api = useApi()
const toast = useToast()
const id = Number(route.params.id)

const { data, error, refresh } = await useFetch(`/api/portfolio/${id}`)
const item = computed(() => data.value?.item)

const form = ref<PortfolioForm>(emptyPortfolioForm())
const savedSnapshot = ref('')
const dirty = computed(() => JSON.stringify(form.value) !== savedSnapshot.value)
const busy = ref(false)

function load() {
  if (!item.value) return
  form.value = toPortfolioForm(item.value)
  savedSnapshot.value = JSON.stringify(form.value)
}
watch(item, load, { immediate: true })

async function act(request: () => Promise<unknown>, failTitle: string) {
  busy.value = true
  try {
    await request()
    await refresh()
    return true
  }
  catch (err) {
    toast.add({ title: failTitle, description: apiErrorMessage(err), color: 'error' })
    return false
  }
  finally {
    busy.value = false
  }
}

const save = () => act(() => api(`/api/portfolio/${id}`, { method: 'PUT', body: fromPortfolioForm(form.value) }), 'Voce non salvata')

async function setStatus(status: PortfolioStatus) {
  if (dirty.value && !(await save())) return
  await act(() => api(`/api/portfolio/${id}/status`, { method: 'POST', body: { status } }), 'Stato non cambiato')
}

const proposal = (action: 'apply' | 'discard') =>
  act(() => api(`/api/portfolio/${id}/proposal`, { method: 'POST', body: { action } }), action === 'apply' ? 'Proposta non applicata' : 'Proposta non scartata')

const proposalRows = computed(() => {
  const current = item.value
  if (!current?.proposal) return []
  return (Object.keys(current.proposal.fields) as PortfolioFieldKey[]).map(key => ({
    key,
    label: FIELD_LABEL[key],
    before: formatFieldValue(key, current[key]),
    after: formatFieldValue(key, current.proposal!.fields[key]),
  }))
})
</script>

<template>
  <UDashboardPanel id="portfolio-voce">
    <template #header>
      <UDashboardNavbar :title="item?.name ?? 'Voce del portfolio'">
        <template #leading>
          <UButton to="/portfolio" icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Torna al portfolio" />
        </template>
        <template v-if="item" #right>
          <UBadge :color="PORTFOLIO_STATUS_COLOR[item.status]" variant="subtle" :label="PORTFOLIO_STATUS_LABEL[item.status]" />
          <UButton v-if="item.status === 'archived'" color="neutral" variant="outline" icon="i-lucide-undo-2" label="Ripristina" :disabled="busy" @click="setStatus('draft')" />
          <UButton v-else color="neutral" variant="outline" icon="i-lucide-archive" label="Escludi" :disabled="busy" @click="setStatus('archived')" />
          <UButton color="neutral" :variant="item.status === 'draft' ? 'outline' : 'solid'" icon="i-lucide-save" label="Salva" :disabled="!dirty || busy" @click="save" />
          <UButton v-if="item.status === 'draft'" icon="i-lucide-check" :label="dirty ? 'Salva e conferma' : 'Conferma'" :disabled="busy" @click="setStatus('approved')" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="subtle" :title="error.statusCode === 404 ? 'Questa voce non esiste' : 'Voce non caricata'" />

      <template v-if="item">
        <UAlert
          v-if="item.proposal" color="info" variant="subtle" icon="i-lucide-git-pull-request"
          :title="item.proposal.jobId ? `Il job ${item.proposal.jobId} propone un aggiornamento` : 'C\'è un aggiornamento proposto'"
        >
          <template #description>
            <dl class="mt-2 space-y-2">
              <div v-for="row in proposalRows" :key="row.key">
                <dt class="font-medium">{{ row.label }}</dt>
                <dd class="text-muted line-through">{{ row.before }}</dd>
                <dd>{{ row.after }}</dd>
              </div>
            </dl>
            <p v-if="dirty" class="mt-2 text-sm">Salva prima le tue modifiche.</p>
            <div class="mt-3 flex gap-2">
              <UButton size="sm" label="Applica" :disabled="dirty || busy" @click="proposal('apply')" />
              <UButton size="sm" color="neutral" variant="outline" label="Scarta" :disabled="busy" @click="proposal('discard')" />
            </div>
          </template>
        </UAlert>

        <p class="text-sm text-muted">
          <span class="font-mono">{{ item.slug }}</span>
          · creata {{ formatDateTime(item.createdAt) }}
          <template v-if="item.jobId"> dal <NuxtLink :to="`/job/${item.jobId}`" class="hover:underline">job {{ item.jobId }}</NuxtLink></template>
          <template v-if="item.editedAt"> · corretta a mano {{ formatDateTime(item.editedAt) }}</template>
          <template v-if="item.reviewedAt"> · rivista {{ formatDateTime(item.reviewedAt) }}</template>
        </p>

        <UCard>
          <PortfolioFormFields v-model="form" :slug="item.slug" />
        </UCard>

        <div class="grid gap-4 md:grid-cols-2">
          <UCard>
            <template #header>
              <h2 class="font-medium">Fonti</h2>
            </template>
            <ul v-if="item.sources.length" class="space-y-1 font-mono text-xs text-muted">
              <li v-for="source in item.sources" :key="source">{{ shortPath(source) }}</li>
            </ul>
            <p v-else class="text-sm text-muted">Scritta a mano.</p>
          </UCard>
          <UCard>
            <template #header>
              <h2 class="font-medium">Collegate</h2>
            </template>
            <ul v-if="data?.related.length" class="space-y-1 text-sm">
              <li v-for="rel in data.related" :key="rel.id">
                <NuxtLink :to="`/portfolio/${rel.id}`" class="hover:underline">{{ rel.name }}</NuxtLink>
                <span class="text-muted"> · {{ KIND_LABEL[rel.kind] }}</span>
              </li>
            </ul>
            <p v-else class="text-sm text-muted">Nessuna voce collegata.</p>
          </UCard>
        </div>
      </template>
    </template>
  </UDashboardPanel>
</template>
