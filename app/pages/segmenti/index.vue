<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const api = useApi()
const toast = useToast()

const { data, refresh } = await useFetch('/api/segments', { key: 'segments' })
useIntervalRefresh(refresh, 5000)

type Row = NonNullable<typeof data.value>['segments'][number]

const proposed = computed(() => (data.value?.segments ?? []).filter(s => s.status === 'proposed'))
const others = computed(() => (data.value?.segments ?? []).filter(s => s.status !== 'proposed'))
const offSources = computed(() => (Object.entries(data.value?.sources ?? {}) as [QuerySource, boolean][])
  .filter(([, on]) => !on).map(([k]) => QUERY_SOURCE_LABEL[k]))

const columns: TableColumn<Row>[] = [
  { accessorKey: 'name', header: 'Segmento' },
  { accessorKey: 'market', header: 'Mercato' },
  { accessorKey: 'score', header: 'Punteggio' },
  { accessorKey: 'prospects', header: 'Prospect' },
  { accessorKey: 'lastSearch', header: 'Ultima ricerca' },
  { accessorKey: 'status', header: 'Stato' },
]

const proposing = ref(false)

async function propose() {
  proposing.value = true
  try {
    const job = await api<{ id: number }>('/api/segments/propose', { method: 'POST', body: {} })
    toast.add({
      title: 'Proposta in coda',
      description: 'Un job di Opus legge il portfolio e propone i segmenti: li trovi qui da accendere.',
      actions: [{ label: 'Apri il job', to: `/job/${job.id}` }],
    })
    await refresh()
  }
  catch (err) {
    toast.add({ title: 'Proposta non partita', description: apiErrorMessage(err), color: 'error' })
  }
  finally {
    proposing.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="segmenti">
    <template #header>
      <UDashboardNavbar title="Segmenti">
        <template #right>
          <UButton color="neutral" variant="outline" icon="i-lucide-sparkles" label="Proponi segmenti" :loading="proposing" :disabled="!!data?.proposal" @click="propose" />
          <UButton to="/segmenti/nuovo" icon="i-lucide-plus" label="Nuovo segmento" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="data?.proposal" icon="i-lucide-loader" color="info" variant="subtle"
        :title="data.proposal.status === 'running' ? 'Proposta in corso' : 'Proposta in coda'"
        description="I segmenti proposti compaiono qui, da accendere."
        :actions="[{ label: `Job ${data.proposal.id}`, to: `/job/${data.proposal.id}`, color: 'neutral', variant: 'outline' }]"
      />
      <UAlert
        v-if="offSources.length" icon="i-lucide-key-round" color="warning" variant="subtle"
        :title="`Spente: ${offSources.join(', ')}`"
        description="Manca la chiave in .env (GOOGLE_PLACES_API_KEY, OPENAPI_COMPANY_TOKEN). Il registro francese è gratuito e sempre acceso."
      />

      <template v-if="proposed.length">
        <h2 class="font-medium">Proposti da accendere</h2>
        <UTable :data="proposed" :columns="columns.filter(c => c.header !== 'Ultima ricerca' && c.header !== 'Punteggio')">
          <template #name-cell="{ row }">
            <NuxtLink :to="`/segmenti/${row.original.id}`" class="font-medium hover:underline">{{ row.original.name }}</NuxtLink>
            <p v-if="row.original.description" class="max-w-xl truncate text-sm text-muted">{{ row.original.description }}</p>
          </template>
          <template #market-cell="{ row }">
            {{ MARKET_LABEL[row.original.market] }}
          </template>
          <template #status-cell="{ row }">
            <UBadge :color="SEGMENT_STATUS_COLOR[row.original.status]" variant="subtle" :label="SEGMENT_STATUS_LABEL[row.original.status]" />
          </template>
        </UTable>
      </template>

      <UTable :data="others" :columns="columns">
        <template #empty>
          <div class="py-6 text-center text-muted">
            Nessun segmento. Fatteli proporre dal portfolio, o scrivine uno a mano.
          </div>
        </template>
        <template #name-cell="{ row }">
          <NuxtLink :to="`/segmenti/${row.original.id}`" class="font-medium hover:underline">{{ row.original.name }}</NuxtLink>
          <p class="text-sm text-muted">{{ row.original.sector }}</p>
        </template>
        <template #market-cell="{ row }">
          {{ MARKET_LABEL[row.original.market] }}
        </template>
        <template #score-cell="{ row }">
          <UBadge v-if="row.original.score !== null" :color="scoreColor(row.original.score)" variant="subtle" :label="String(row.original.score)" />
          <span v-else class="text-dimmed">-</span>
        </template>
        <template #prospects-cell="{ row }">
          <NuxtLink :to="`/prospect?segmento=${row.original.id}`" class="hover:underline">{{ row.original.prospects }}</NuxtLink>
          <span class="text-sm text-muted"> · {{ row.original.audited }} con audit · {{ row.original.qualified }} qualificati</span>
        </template>
        <template #lastSearch-cell="{ row }">
          <template v-if="row.original.lastSearch">
            <UBadge :color="WORK_STATUS_COLOR[row.original.lastSearch.status]" variant="subtle" :label="WORK_STATUS_LABEL[row.original.lastSearch.status]" />
            <span class="ml-2 text-sm text-muted">{{ formatDateTime(row.original.lastSearch.finishedAt ?? row.original.lastSearch.createdAt) }}</span>
          </template>
          <span v-else class="text-dimmed">mai</span>
        </template>
        <template #status-cell="{ row }">
          <UBadge :color="SEGMENT_STATUS_COLOR[row.original.status]" variant="subtle" :label="SEGMENT_STATUS_LABEL[row.original.status]" />
        </template>
      </UTable>
    </template>
  </UDashboardPanel>
</template>
