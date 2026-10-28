<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const api = useApi()
const toast = useToast()
const route = useRoute()

const { data: jobs, refresh } = await useFetch('/api/jobs', { query: { limit: 100 } })
useIntervalRefresh(refresh, 3000)
const { data: settings } = await useFetch('/api/settings')

type Row = NonNullable<typeof jobs.value>[number]

const columns: TableColumn<Row>[] = [
  { accessorKey: 'id', header: '#' },
  { accessorKey: 'title', header: 'Titolo' },
  { accessorKey: 'status', header: 'Stato' },
  { accessorKey: 'cwd', header: 'Cartella' },
  { accessorKey: 'weightedTokens', header: 'Token pesati' },
  { accessorKey: 'costUsd', header: 'Costo di listino' },
  { accessorKey: 'createdAt', header: 'Creato' },
  { id: 'duration', header: 'Durata' },
  { id: 'actions', header: '' },
]

const permissionItems = (Object.keys(PERMISSION_LABEL) as JobPermission[]).map(value => ({ value, label: PERMISSION_LABEL[value] }))

const open = ref(route.query.nuovo === '1')
const sending = ref(false)
const form = reactive({ title: '', cwd: '', permission: 'read' as JobPermission, prompt: '' })

watch(open, (isOpen) => {
  if (isOpen && !form.cwd) form.cwd = settings.value?.defaultCwd ?? ''
}, { immediate: true })

async function submit() {
  sending.value = true
  try {
    const job = await api<{ id: number }>('/api/jobs', { method: 'POST', body: form })
    open.value = false
    Object.assign(form, { title: '', prompt: '' })
    await navigateTo(`/job/${job.id}`)
  }
  catch (err) {
    toast.add({ title: 'Job non accodato', description: apiErrorMessage(err), color: 'error' })
  }
  finally {
    sending.value = false
  }
}

async function cancel(id: number) {
  try {
    await api(`/api/jobs/${id}/cancel`, { method: 'POST' })
    await refresh()
  }
  catch (err) {
    toast.add({ title: 'Non annullato', description: apiErrorMessage(err), color: 'error' })
  }
}
</script>

<template>
  <UDashboardPanel id="job">
    <template #header>
      <UDashboardNavbar title="Job">
        <template #right>
          <UModal v-model:open="open" title="Nuovo job" description="Claude Code (Opus) lo esegue nella cartella indicata, senza nessuno al terminale." :ui="{ content: 'sm:max-w-2xl' }">
            <UButton icon="i-lucide-plus" label="Nuovo job" />
            <template #body>
              <form class="space-y-4" @submit.prevent="submit">
                <UFormField label="Titolo" required>
                  <UInput v-model="form.title" placeholder="Per esempio: riassumi il README di Quadra" class="w-full" autofocus />
                </UFormField>
                <UFormField label="Cartella" required help="Claude parte qui e ne legge il CLAUDE.md.">
                  <UInput v-model="form.cwd" class="w-full font-mono" />
                </UFormField>
                <UFormField label="Permessi">
                  <USelect v-model="form.permission" :items="permissionItems" class="w-full" />
                </UFormField>
                <UFormField label="Prompt" required>
                  <UTextarea v-model="form.prompt" :rows="8" autoresize class="w-full" />
                </UFormField>
                <div class="flex justify-end gap-2">
                  <UButton color="neutral" variant="ghost" label="Annulla" @click="open = false" />
                  <UButton type="submit" label="Metti in coda" :loading="sending" :disabled="!form.title || !form.prompt || !form.cwd" />
                </div>
              </form>
            </template>
          </UModal>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UTable :data="jobs ?? []" :columns="columns" empty="Nessun job, per ora.">
        <template #title-cell="{ row }">
          <NuxtLink :to="`/job/${row.original.id}`" class="font-medium hover:underline">{{ row.original.title }}</NuxtLink>
        </template>
        <template #status-cell="{ row }">
          <UBadge :color="STATUS_COLOR[row.original.status]" variant="subtle" :label="STATUS_LABEL[row.original.status]" />
        </template>
        <template #cwd-cell="{ row }">
          <span class="font-mono text-xs text-muted">{{ shortPath(row.original.cwd) }}</span>
        </template>
        <template #weightedTokens-cell="{ row }">
          <span class="tabular-nums">{{ formatTokens(row.original.weightedTokens) }}</span>
        </template>
        <template #costUsd-cell="{ row }">
          <span class="tabular-nums">{{ formatUsd(row.original.costUsd) }}</span>
        </template>
        <template #createdAt-cell="{ row }">
          {{ formatDateTime(row.original.createdAt) }}
        </template>
        <template #duration-cell="{ row }">
          {{ formatDuration(row.original.startedAt, row.original.finishedAt) }}
        </template>
        <template #actions-cell="{ row }">
          <UButton
            v-if="row.original.status === 'queued' || row.original.status === 'running'"
            size="xs" color="neutral" variant="ghost" icon="i-lucide-square" :label="row.original.status === 'queued' ? 'Annulla' : 'Ferma'"
            :disabled="row.original.cancelRequested"
            @click="cancel(row.original.id)"
          />
        </template>
      </UTable>
    </template>
  </UDashboardPanel>
</template>
