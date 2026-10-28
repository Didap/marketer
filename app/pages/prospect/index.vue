<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const route = useRoute()

const segmentId = ref(route.query.segmento ? String(route.query.segmento) : 'all')
const status = ref<ProspectStatus | 'all'>('all')
const search = ref('')
watch(segmentId, s => navigateTo({ query: { ...route.query, segmento: s === 'all' ? undefined : s } }, { replace: true }))

const { data: segmentData } = await useFetch('/api/segments', { key: 'segments' })
const { data: items, refresh } = await useFetch('/api/prospects', {
  query: computed(() => ({ segmentId: segmentId.value === 'all' ? undefined : segmentId.value })),
})
useIntervalRefresh(refresh, 5000)

type Row = NonNullable<typeof items.value>[number]

const segmentFilter = computed(() => [
  { value: 'all', label: 'Tutti i segmenti' },
  ...(segmentData.value?.segments ?? []).map(s => ({ value: String(s.id), label: s.name })),
])
const statusFilter = [{ value: 'all', label: 'Tutti gli stati' }, ...optionsOf(PROSPECT_STATUS_LABEL)]

const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return (items.value ?? []).filter(p =>
    (status.value === 'all' ? p.status !== 'discarded' : p.status === status.value)
    && (!q || [p.name, p.city ?? '', p.website ?? ''].some(t => t.toLowerCase().includes(q))))
})

// I prospect scelti per una strategia di gruppo: solo tra quelli mostrati, quindi si azzera con i filtri.
const MAX_GROUP = 30
const selected = ref(new Set<number>())
watch([segmentId, status, search], () => (selected.value = new Set()))
const allShown = computed(() => shown.value.length > 0 && shown.value.every(p => selected.value.has(p.id)))
function select(ids: number[], on: boolean) {
  const next = new Set(selected.value)
  for (const id of ids) on ? next.add(id) : next.delete(id)
  selected.value = next
}
const { start: startStrategy, starting } = useStartStrategy()

const columns: TableColumn<Row>[] = [
  { id: 'select', header: '' },
  { accessorKey: 'name', header: 'Prospect' },
  { accessorKey: 'segmentName', header: 'Segmento' },
  { accessorKey: 'score', header: 'Punteggio' },
  { accessorKey: 'website', header: 'Sito' },
  { accessorKey: 'auditStatus', header: 'Audit' },
  { accessorKey: 'status', header: 'Stato' },
]
</script>

<template>
  <UDashboardPanel id="prospect">
    <template #header>
      <UDashboardNavbar title="Prospect">
        <template #right>
          <UButton v-if="selected.size" icon="i-lucide-compass" :label="selected.size > MAX_GROUP ? `Massimo ${MAX_GROUP} per strategia (${selected.size})` : `Strategia per ${selected.size} ${selected.size === 1 ? 'prospect' : 'prospect insieme'}`" :disabled="selected.size > MAX_GROUP" :loading="starting" @click="startStrategy([...selected])" />
          <UButton to="/segmenti" color="neutral" variant="outline" icon="i-lucide-target" label="Segmenti" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-wrap gap-2">
        <UInput v-model="search" icon="i-lucide-search" placeholder="Cerca nome, città, sito" class="w-64" />
        <USelect v-model="segmentId" :items="segmentFilter" class="w-64" />
        <USelect v-model="status" :items="statusFilter" class="w-44" />
      </div>

      <UTable :data="shown" :columns="columns">
        <template #empty>
          <div class="py-6 text-center text-muted">
            <p v-if="items?.length">Nessun prospect con questi filtri.</p>
            <p v-else>Ancora nessun prospect: accendi un <NuxtLink to="/segmenti" class="underline">segmento</NuxtLink> e lancia la ricerca.</p>
          </div>
        </template>
        <template #select-header>
          <UCheckbox :model-value="allShown" aria-label="Seleziona quelli mostrati" @update:model-value="v => select(shown.map(p => p.id), !!v)" />
        </template>
        <template #select-cell="{ row }">
          <UCheckbox :model-value="selected.has(row.original.id)" :aria-label="`Seleziona ${row.original.name}`" @update:model-value="v => select([row.original.id], !!v)" />
        </template>
        <template #name-cell="{ row }">
          <div class="flex items-center gap-2">
            <PoliticalSideDot :side="row.original.politicalSide" />
            <NuxtLink :to="`/prospect/${row.original.id}`" class="font-medium hover:underline">{{ row.original.name }}</NuxtLink>
          </div>
          <p class="text-sm text-muted">{{ prospectSubtitle(row.original) }}</p>
        </template>
        <template #segmentName-cell="{ row }">
          <span class="text-sm">{{ row.original.segmentName }}</span>
        </template>
        <template #score-cell="{ row }">
          <UBadge :color="scoreColor(row.original.score)" variant="subtle" :label="row.original.score === null ? '-' : String(row.original.score)" />
          <span class="ml-2 text-xs text-muted">fit {{ row.original.fitScore ?? '-' }} · bisogno {{ row.original.needScore ?? '?' }} · fresco {{ row.original.freshScore ?? '-' }}</span>
        </template>
        <template #website-cell="{ row }">
          <a v-if="row.original.website" :href="row.original.website" target="_blank" rel="noopener" class="text-sm hover:underline">{{ row.original.website.replace(/^https?:\/\/(www\.)?/, '') }}</a>
          <span v-else class="text-sm text-dimmed">{{ row.original.placeId ? 'nessuno' : 'sconosciuto' }}</span>
        </template>
        <template #auditStatus-cell="{ row }">
          <template v-if="row.original.auditStatus">
            <UBadge :color="WORK_STATUS_COLOR[row.original.auditStatus]" variant="subtle" :label="WORK_STATUS_LABEL[row.original.auditStatus]" />
            <span v-if="row.original.issues" class="ml-2 text-sm text-muted">{{ row.original.issues }} difetti</span>
          </template>
          <span v-else class="text-dimmed">-</span>
        </template>
        <template #status-cell="{ row }">
          <UBadge :color="PROSPECT_STATUS_COLOR[row.original.status]" variant="subtle" :label="PROSPECT_STATUS_LABEL[row.original.status]" />
        </template>
      </UTable>
    </template>
  </UDashboardPanel>
</template>
