<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const api = useApi()
const toast = useToast()
const route = useRoute()

const tab = ref(route.query.vista === 'fonti' ? 'fonti' : 'voci')
watch(tab, vista => navigateTo({ query: { ...route.query, vista: vista === 'fonti' ? 'fonti' : undefined } }, { replace: true }))

const { data: items, refresh: refreshItems } = await useFetch('/api/portfolio', { key: 'portfolio-all' })
const { data: sourceData, refresh: refreshSources } = await useFetch('/api/portfolio/sources')
useIntervalRefresh(() => Promise.all([refreshItems(), refreshSources()]), 5000)

type Item = NonNullable<typeof items.value>[number]
type Source = NonNullable<typeof sourceData.value>['sources'][number]

const kind = ref<PortfolioKind | 'all'>('all')
const status = ref<PortfolioStatus | 'all'>('all')
const search = ref('')

const kindFilter = [{ value: 'all', label: 'Tutti i tipi' }, ...(Object.keys(KIND_LABEL) as PortfolioKind[]).map(value => ({ value, label: KIND_LABEL[value] }))]
const statusFilter = [{ value: 'all', label: 'Tutti gli stati' }, ...(Object.keys(PORTFOLIO_STATUS_LABEL) as PortfolioStatus[]).map(value => ({ value, label: PORTFOLIO_STATUS_LABEL[value] }))]

const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return (items.value ?? []).filter(i =>
    (kind.value === 'all' || i.kind === kind.value)
    && (status.value === 'all' || i.status === status.value)
    && (!q || [i.name, i.summary, i.client ?? '', ...i.sectors].some(t => t.toLowerCase().includes(q))))
})

const toReview = computed(() => (items.value ?? []).filter(i => i.status === 'draft' || i.proposal).length)
const toImport = computed(() => (sourceData.value?.sources ?? []).filter(s => s.state === 'new' || s.state === 'changed').length)
const running = computed(() => sourceData.value?.running ?? null)

const tabs = computed(() => [
  { value: 'voci', label: 'Voci', icon: 'i-lucide-briefcase', badge: toReview.value ? { label: String(toReview.value), color: 'warning' as const, variant: 'subtle' as const } : undefined },
  { value: 'fonti', label: 'Fonti', icon: 'i-lucide-folder-git-2', badge: toImport.value ? { label: String(toImport.value), color: 'info' as const, variant: 'subtle' as const } : undefined },
])

const itemColumns: TableColumn<Item>[] = [
  { accessorKey: 'name', header: 'Voce' },
  { accessorKey: 'kind', header: 'Tipo' },
  { accessorKey: 'sectors', header: 'Settori' },
  { accessorKey: 'status', header: 'Stato' },
  { accessorKey: 'citable', header: 'Citabile' },
  { accessorKey: 'updatedAt', header: 'Aggiornata' },
]

const sourceColumns: TableColumn<Source>[] = [
  { accessorKey: 'name', header: 'Fonte' },
  { accessorKey: 'kind', header: 'Tipo' },
  { accessorKey: 'state', header: 'Stato' },
  { accessorKey: 'items', header: 'Voci' },
  { accessorKey: 'modifiedAt', header: 'Modificata' },
  { id: 'actions', header: '' },
]

const importing = ref(false)

async function startImport(paths?: string[]) {
  importing.value = true
  try {
    const jobs = await api<{ id: number, title: string }[]>('/api/portfolio/import', { method: 'POST', body: { paths } })
    toast.add({
      title: jobs.length === 1 ? 'Import in coda' : `${jobs.length} job di import in coda`,
      description: 'Le voci arrivano qui da rivedere, man mano che i job finiscono.',
      actions: [{ label: 'Apri il job', to: `/job/${jobs[0]!.id}` }],
    })
    await refreshSources()
  }
  catch (err) {
    toast.add({ title: 'Import non partito', description: apiErrorMessage(err), color: 'error' })
  }
  finally {
    importing.value = false
  }
}

const ignoring = ref<Source | null>(null)
const ignoreReason = ref('')

function askIgnore(source: Source) {
  ignoring.value = source
  ignoreReason.value = ''
}

async function confirmIgnore() {
  if (!ignoring.value) return
  try {
    await api('/api/portfolio/sources/ignore', { method: 'POST', body: { path: ignoring.value.path, reason: ignoreReason.value } })
    ignoring.value = null
    await refreshSources()
  }
  catch (err) {
    toast.add({ title: 'Fonte non ignorata', description: apiErrorMessage(err), color: 'error' })
  }
}

async function restore(source: Source) {
  try {
    await api('/api/portfolio/sources/restore', { method: 'POST', body: { path: source.path } })
    await refreshSources()
  }
  catch (err) {
    toast.add({ title: 'Fonte non ripresa', description: apiErrorMessage(err), color: 'error' })
  }
}
</script>

<template>
  <UDashboardPanel id="portfolio">
    <template #header>
      <UDashboardNavbar title="Portfolio">
        <template #right>
          <UButton
            color="neutral" variant="outline" icon="i-lucide-download"
            :label="toImport ? `Importa ${toImport === 1 ? '1 fonte' : `${toImport} fonti`}` : 'Importa'"
            :disabled="!toImport || !!running" :loading="importing"
            @click="startImport()"
          />
          <UButton to="/portfolio/nuova" icon="i-lucide-plus" label="Nuova voce" />
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar>
        <UTabs v-model="tab" :items="tabs" :content="false" variant="link" />
      </UDashboardToolbar>
    </template>

    <template #body>
      <UAlert
        v-if="running" icon="i-lucide-loader" color="info" variant="subtle"
        :title="running.status === 'running' ? 'Import in corso' : 'Import in coda'"
        description="Le voci compaiono qui da rivedere man mano che i job finiscono."
        :actions="[{ label: `Job ${running.id}`, to: `/job/${running.id}`, color: 'neutral', variant: 'outline' }]"
      />

      <template v-if="tab === 'voci'">
        <div class="flex flex-wrap gap-2">
          <UInput v-model="search" icon="i-lucide-search" placeholder="Cerca nome, settore, cliente" class="w-64" />
          <USelect v-model="kind" :items="kindFilter" class="w-44" />
          <USelect v-model="status" :items="statusFilter" class="w-44" />
        </div>

        <UTable :data="shown" :columns="itemColumns">
          <template #empty>
            <div class="py-6 text-center text-muted">
              <p v-if="items?.length">Nessuna voce con questi filtri.</p>
              <p v-else>
                Il portfolio è vuoto. Lancia l'import dalle <button type="button" class="underline" @click="tab = 'fonti'">fonti</button>
                o scrivi una voce a mano.
              </p>
            </div>
          </template>
          <template #name-cell="{ row }">
            <NuxtLink :to="`/portfolio/${row.original.id}`" class="font-medium hover:underline">{{ row.original.name }}</NuxtLink>
            <p v-if="row.original.summary" class="max-w-md truncate text-sm text-muted">{{ row.original.summary }}</p>
          </template>
          <template #kind-cell="{ row }">
            {{ KIND_LABEL[row.original.kind] }}
          </template>
          <template #sectors-cell="{ row }">
            <span class="text-sm text-muted">{{ row.original.sectors.join(', ') }}</span>
          </template>
          <template #status-cell="{ row }">
            <div class="flex gap-1">
              <UBadge :color="PORTFOLIO_STATUS_COLOR[row.original.status]" variant="subtle" :label="PORTFOLIO_STATUS_LABEL[row.original.status]" />
              <UBadge v-if="row.original.proposal" color="info" variant="subtle" label="Proposta" />
            </div>
          </template>
          <template #citable-cell="{ row }">
            <UIcon v-if="row.original.citable" name="i-lucide-check" class="size-4 text-success" />
            <span v-else class="text-dimmed">No</span>
          </template>
          <template #updatedAt-cell="{ row }">
            {{ formatDateTime(row.original.updatedAt) }}
          </template>
        </UTable>
      </template>

      <template v-else>
        <p class="text-sm text-muted">
          Repo con README o PRODUCT.md e schede del sito didap. Un job di Opus in sola lettura le legge a lotti
          e scrive le voci da rivedere. Una voce che hai già rivisto non viene sovrascritta: il job lascia una proposta.
        </p>

        <UTable :data="sourceData?.sources ?? []" :columns="sourceColumns" empty="Nessuna fonte trovata.">
          <template #name-cell="{ row }">
            <span class="font-medium">{{ row.original.name }}</span>
            <p class="font-mono text-xs text-muted">{{ shortPath(row.original.path) }}</p>
          </template>
          <template #kind-cell="{ row }">
            {{ row.original.kind === 'repo' ? 'Repo' : 'Sito' }}
          </template>
          <template #state-cell="{ row }">
            <UBadge :color="SOURCE_STATE_COLOR[row.original.state]" variant="subtle" :label="SOURCE_STATE_LABEL[row.original.state]" />
            <p v-if="row.original.ignoredReason" class="mt-1 max-w-xs text-xs text-muted">{{ row.original.ignoredReason }}</p>
          </template>
          <template #items-cell="{ row }">
            <div class="flex max-w-xs flex-wrap gap-x-2 text-sm">
              <NuxtLink v-for="item in row.original.items" :key="item.id" :to="`/portfolio/${item.id}`" class="hover:underline">{{ item.name }}</NuxtLink>
            </div>
          </template>
          <template #modifiedAt-cell="{ row }">
            {{ formatDateTime(row.original.modifiedAt) }}
          </template>
          <template #actions-cell="{ row }">
            <div class="flex justify-end gap-1">
              <UButton
                v-if="row.original.state !== 'ignored'"
                size="xs" color="neutral" variant="ghost" icon="i-lucide-refresh-cw"
                :label="row.original.state === 'imported' ? 'Rileggi' : 'Importa'" :disabled="!!running"
                @click="startImport([row.original.path])"
              />
              <UButton v-if="row.original.state === 'ignored'" size="xs" color="neutral" variant="ghost" icon="i-lucide-undo-2" label="Riprendi" @click="restore(row.original)" />
              <UButton v-else size="xs" color="neutral" variant="ghost" icon="i-lucide-eye-off" label="Ignora" @click="askIgnore(row.original)" />
            </div>
          </template>
        </UTable>
      </template>

      <UModal :open="!!ignoring" title="Ignora la fonte" :description="ignoring ? `Gli import salteranno ${ignoring.name} finché non la riprendi.` : ''" @update:open="v => { if (!v) ignoring = null }">
        <template #body>
          <form class="space-y-4" @submit.prevent="confirmIgnore">
            <UFormField label="Motivo">
              <UInput v-model="ignoreReason" placeholder="Per esempio: strumento interno" class="w-full" autofocus />
            </UFormField>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="ghost" label="Annulla" @click="ignoring = null" />
              <UButton type="submit" label="Ignora" />
            </div>
          </form>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
