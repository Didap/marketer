<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const route = useRoute()
const api = useApi()
const toast = useToast()
const id = Number(route.params.id)

const { data, error, refresh } = await useFetch(`/api/segments/${id}`)
const { data: top, refresh: refreshTop } = await useFetch('/api/prospects', { query: { segmentId: id } })
const segment = computed(() => data.value?.segment)
const searching = computed(() => (data.value?.searches ?? []).some(s => s.status === 'queued' || s.status === 'running'))
useIntervalRefresh(() => Promise.all([refresh(), refreshTop()]), 4000)

type SearchRow = NonNullable<typeof data.value>['searches'][number]

const form = ref<SegmentForm>(emptySegmentForm())
const savedSnapshot = ref('')
const dirty = computed(() => JSON.stringify(form.value) !== savedSnapshot.value)
const busy = ref(false)

function load() {
  if (!segment.value) return
  form.value = toSegmentForm(segment.value)
  savedSnapshot.value = JSON.stringify(form.value)
}
watch(() => segment.value?.updatedAt, load, { immediate: true })

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

const save = () => act(() => api(`/api/segments/${id}`, { method: 'PUT', body: fromSegmentForm(form.value) }), 'Segmento non salvato')

async function setStatus(status: SegmentStatus) {
  if (dirty.value && !(await save())) return
  await act(() => api(`/api/segments/${id}/status`, { method: 'POST', body: { status } }), 'Stato non cambiato')
}

async function search() {
  if (dirty.value && !(await save())) return
  await act(() => api(`/api/segments/${id}/search`, { method: 'POST' }), 'Ricerca non partita')
}

const searchColumns: TableColumn<SearchRow>[] = [
  { accessorKey: 'query', header: 'Ricerca' },
  { accessorKey: 'status', header: 'Stato' },
  { accessorKey: 'found', header: 'Trovate' },
  { accessorKey: 'paidCalls', header: 'Chiamate a pagamento' },
  { accessorKey: 'createdAt', header: 'Quando' },
]
</script>

<template>
  <UDashboardPanel id="segmento">
    <template #header>
      <UDashboardNavbar :title="segment?.name ?? 'Segmento'">
        <template #leading>
          <UButton to="/segmenti" icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Torna ai segmenti" />
        </template>
        <template v-if="segment" #right>
          <UBadge :color="SEGMENT_STATUS_COLOR[segment.status]" variant="subtle" :label="SEGMENT_STATUS_LABEL[segment.status]" />
          <UButton v-if="segment.status === 'active'" color="neutral" variant="outline" icon="i-lucide-pause" label="Metti in pausa" :disabled="busy" @click="setStatus('paused')" />
          <UButton color="neutral" variant="outline" icon="i-lucide-save" label="Salva" :disabled="!dirty || busy" @click="save" />
          <UButton v-if="segment.status !== 'active'" icon="i-lucide-power" :label="dirty ? 'Salva e accendi' : 'Accendi'" :disabled="busy" @click="setStatus('active')" />
          <UButton v-else icon="i-lucide-search" label="Cerca ora" :loading="searching" :disabled="busy || searching || !form.queries.length" @click="search" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="subtle" :title="error.statusCode === 404 ? 'Questo segmento non esiste' : 'Segmento non caricato'" />

      <template v-if="segment">
        <p class="text-sm text-muted">
          Creato {{ formatDateTime(segment.createdAt) }}
          <template v-if="segment.jobId"> dal <NuxtLink :to="`/job/${segment.jobId}`" class="hover:underline">job {{ segment.jobId }}</NuxtLink></template>
          · le ricerche salvano i prospect, il worker analizza i siti e calcola i punteggi.
        </p>

        <UCard>
          <SegmentFormFields v-model="form" :sources="data?.sources" />
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-medium">Prospect migliori</h2>
              <UButton :to="`/prospect?segmento=${id}`" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" :label="`Tutti (${top?.length ?? 0})`" />
            </div>
          </template>
          <p v-if="top?.some(p => p.politicalSide)" class="mb-2 flex flex-wrap gap-4 text-xs text-muted">
            <PoliticalSideDot v-for="side in (Object.keys(POLITICAL_SIDE_LABEL) as PoliticalSide[])" :key="side" :side="side" label />
          </p>
          <ul v-if="top?.length" class="divide-y divide-default">
            <li v-for="p in top.slice(0, 8)" :key="p.id" class="flex items-center justify-between gap-4 py-2">
              <div class="flex min-w-0 items-center gap-2">
                <PoliticalSideDot :side="p.politicalSide" />
                <NuxtLink :to="`/prospect/${p.id}`" class="font-medium hover:underline">{{ p.name }}</NuxtLink>
                <span class="text-sm text-muted"> · {{ prospectSubtitle(p) }}</span>
              </div>
              <UBadge :color="scoreColor(p.score)" variant="subtle" :label="p.score === null ? '-' : String(p.score)" />
            </li>
          </ul>
          <p v-else class="text-sm text-muted">Ancora nessun prospect: lancia una ricerca.</p>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-medium">Ricerche fatte</h2>
          </template>
          <UTable :data="data?.searches ?? []" :columns="searchColumns" empty="Nessuna ricerca ancora.">
            <template #query-cell="{ row }">
              <span class="font-medium">{{ QUERY_SOURCE_LABEL[row.original.query.source] }}</span>
              <span class="text-sm text-muted"> {{ queryText(row.original.query) }}</span>
              <p v-if="row.original.error" class="max-w-md text-xs text-error">{{ row.original.error }}</p>
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="WORK_STATUS_COLOR[row.original.status]" variant="subtle" :label="WORK_STATUS_LABEL[row.original.status]" />
            </template>
            <template #found-cell="{ row }">
              {{ row.original.found }} <span class="text-sm text-muted">({{ row.original.added }} nuove)</span>
            </template>
            <template #createdAt-cell="{ row }">
              {{ formatDateTime(row.original.createdAt) }}
            </template>
          </UTable>
        </UCard>
      </template>
    </template>
  </UDashboardPanel>
</template>
