<script setup lang="ts">
interface LogEvent {
  id: number
  at: string
  kind: 'runner' | 'system' | 'text' | 'tool_use' | 'tool_result' | 'result' | 'stderr' | 'other'
  summary: string
}

const KIND_ICON: Record<LogEvent['kind'], string> = {
  runner: 'i-lucide-cog',
  system: 'i-lucide-info',
  text: 'i-lucide-message-square',
  tool_use: 'i-lucide-wrench',
  tool_result: 'i-lucide-corner-down-right',
  result: 'i-lucide-flag',
  stderr: 'i-lucide-triangle-alert',
  other: 'i-lucide-dot',
}

const KIND_CLASS: Record<LogEvent['kind'], string> = {
  runner: 'text-muted',
  system: 'text-muted',
  text: 'text-default',
  tool_use: 'text-primary',
  tool_result: 'text-dimmed',
  result: 'text-success font-medium',
  stderr: 'text-error',
  other: 'text-dimmed',
}

const route = useRoute()
const api = useApi()
const toast = useToast()
const id = Number(route.params.id)

const { data: job, error } = await useFetch(`/api/jobs/${id}`)
const events = ref<LogEvent[]>([])
const logBox = ref<HTMLElement | null>(null)
const follow = ref(true)
const live = ref(false)

const active = computed(() => job.value?.status === 'queued' || job.value?.status === 'running')

let source: EventSource | null = null

function onScroll() {
  const el = logBox.value
  if (el) follow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

onMounted(() => {
  source = new EventSource(`/api/jobs/${id}/stream`)
  source.onopen = () => (live.value = true)
  source.onerror = () => (live.value = false)
  source.addEventListener('ev', (e) => {
    const ev = JSON.parse((e as MessageEvent).data) as LogEvent
    if (events.value.length && events.value[events.value.length - 1]!.id >= ev.id) return
    events.value.push(ev)
    if (follow.value) nextTick(() => logBox.value?.scrollTo({ top: logBox.value.scrollHeight }))
  })
  source.addEventListener('job', (e) => {
    job.value = { ...job.value!, ...JSON.parse((e as MessageEvent).data) }
  })
  source.addEventListener('end', () => {
    source?.close()
    live.value = false
  })
})

onBeforeUnmount(() => source?.close())

async function cancel() {
  try {
    job.value = await api<NonNullable<typeof job.value>>(`/api/jobs/${id}/cancel`, { method: 'POST' })
  }
  catch (err) {
    toast.add({ title: 'Non annullato', description: apiErrorMessage(err), color: 'error' })
  }
}
</script>

<template>
  <UDashboardPanel id="job-detail">
    <template #header>
      <UDashboardNavbar :title="job ? `Job ${job.id}: ${job.title}` : `Job ${id}`">
        <template #leading>
          <UButton to="/job" icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Torna ai job" />
        </template>
        <template #right>
          <UButton
            v-if="active"
            color="neutral" variant="outline" icon="i-lucide-square"
            :label="job?.status === 'queued' ? 'Annulla' : 'Ferma'"
            :disabled="job?.cancelRequested"
            @click="cancel"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="subtle" :title="error.statusCode === 404 ? 'Questo job non esiste' : 'Job non caricato'" />

      <div v-else-if="job" class="flex min-h-0 flex-1 flex-col gap-4">
        <div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <UBadge :color="STATUS_COLOR[job.status]" variant="subtle" :label="STATUS_LABEL[job.status]" size="lg" />
          <span><span class="text-muted">Cartella</span> <code>{{ job.cwd }}</code></span>
          <span><span class="text-muted">Permessi</span> {{ PERMISSION_LABEL[job.permission] }}</span>
          <span v-if="job.startedAt"><span class="text-muted">Durata</span> {{ formatDuration(job.startedAt, job.finishedAt) }}</span>
          <UTooltip :text="`Input ${formatNumber(job.inputTokens)} · cache scritta ${formatNumber(job.cacheWriteTokens)} · cache letta ${formatNumber(job.cacheReadTokens)} · output ${formatNumber(job.outputTokens)}`">
            <span class="tabular-nums"><span class="text-muted">Token pesati</span> {{ formatNumber(job.weightedTokens) }}</span>
          </UTooltip>
          <span class="tabular-nums"><span class="text-muted">Costo di listino</span> {{ formatUsd(job.costUsd) }}</span>
          <span v-if="job.model" class="text-muted">{{ job.model }}</span>
        </div>

        <UAlert v-if="job.error" :color="job.status === 'stopped' || job.status === 'canceled' ? 'warning' : 'error'" variant="subtle" :description="job.error" />

        <details class="rounded-md border border-default p-3 text-sm">
          <summary class="cursor-pointer text-muted">Prompt</summary>
          <pre class="mt-2 whitespace-pre-wrap font-sans">{{ job.prompt }}</pre>
        </details>

        <div class="flex items-center justify-between">
          <h2 class="font-medium">Log</h2>
          <span class="flex items-center gap-1.5 text-xs text-muted">
            <span class="size-2 rounded-full" :class="live ? 'bg-success animate-pulse' : 'bg-neutral-400'" />
            {{ live ? 'in diretta' : active ? 'in attesa' : 'chiuso' }}
          </span>
        </div>

        <div ref="logBox" class="min-h-48 flex-1 overflow-y-auto rounded-md border border-default bg-elevated/40 p-3 font-mono text-xs" @scroll="onScroll">
          <p v-if="!events.length" class="text-muted">{{ job.status === 'queued' ? 'Il job aspetta il suo turno in coda.' : 'Nessun evento.' }}</p>
          <div v-for="ev in events" :key="ev.id" class="flex gap-2 py-0.5" :class="KIND_CLASS[ev.kind]">
            <span class="shrink-0 tabular-nums text-dimmed">{{ formatTime(ev.at) }}</span>
            <UIcon :name="KIND_ICON[ev.kind]" class="mt-0.5 size-3.5 shrink-0" />
            <span class="min-w-0 whitespace-pre-wrap break-words">{{ ev.summary }}</span>
          </div>
        </div>

        <div v-if="job.result" class="rounded-md border border-default p-4">
          <h2 class="mb-2 font-medium">Risultato</h2>
          <div class="whitespace-pre-wrap text-sm">{{ job.result }}</div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
