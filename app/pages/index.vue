<script setup lang="ts">
const api = useApi()
const toast = useToast()

const { data, refresh } = await useFetch('/api/today', { key: 'today' })
useIntervalRefresh(refresh, 3000)

const guard = computed(() => data.value?.guard)
const usedPct = computed(() => {
  const g = guard.value
  if (!g || g.cap === 0) return 100
  return Math.min(100, Math.round((g.used / g.cap) * 100))
})
const guardColor = computed(() => (guard.value?.blocked ? 'error' : usedPct.value >= 80 ? 'warning' : 'primary'))

const editingCap = ref(false)
const capDraft = ref(0)
const savingCap = ref(false)

function startEditCap() {
  capDraft.value = guard.value?.cap ?? 0
  editingCap.value = true
}

async function saveCap() {
  savingCap.value = true
  try {
    await api('/api/settings', { method: 'PUT', body: { dailyTokenCap: capDraft.value } })
    editingCap.value = false
    await refresh()
  }
  catch (err) {
    toast.add({ title: 'Tetto non salvato', description: apiErrorMessage(err), color: 'error' })
  }
  finally {
    savingCap.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="oggi">
    <template #header>
      <UDashboardNavbar title="Oggi">
        <template #right>
          <UButton to="/job?nuovo=1" icon="i-lucide-plus" label="Nuovo job" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="data?.pendingMessages" icon="i-lucide-inbox" color="warning" variant="subtle"
        :title="data.pendingMessages === 1 ? '1 messaggio da approvare' : `${data.pendingMessages} messaggi da approvare`"
        :actions="[{ label: 'Apri le approvazioni', to: '/approvazioni', color: 'neutral', variant: 'outline' }]"
      />
      <div v-if="data" class="grid gap-4 lg:grid-cols-3">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-medium">Token di oggi</h2>
              <UButton v-if="!editingCap" size="xs" variant="ghost" color="neutral" icon="i-lucide-pencil" label="Tetto" @click="startEditCap" />
            </div>
          </template>
          <p class="text-2xl font-semibold tabular-nums">
            {{ formatTokens(guard!.used) }}
            <span class="text-base font-normal text-muted">di {{ formatTokens(guard!.cap) }} token pesati</span>
          </p>
          <UProgress :model-value="usedPct" :color="guardColor" class="mt-3" />
          <p v-if="guard!.reason" class="mt-3 text-sm text-error">{{ guard!.reason }}</p>
          <p v-else class="mt-3 text-sm text-muted">Restano {{ formatNumber(guard!.remaining) }} token pesati fino a mezzanotte.</p>

          <form v-if="editingCap" class="mt-4 flex items-end gap-2" @submit.prevent="saveCap">
            <UFormField label="Tetto giornaliero" help="Token pesati: input 1, cache scritta 1,25, cache letta 0,1, output 5." class="flex-1">
              <UInputNumber v-model="capDraft" :min="0" :step="100000" :format-options="{ maximumFractionDigits: 0 }" class="w-full" />
            </UFormField>
            <UButton type="submit" label="Salva" :loading="savingCap" />
            <UButton color="neutral" variant="ghost" label="Annulla" @click="editingCap = false" />
          </form>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-medium">Adesso</h2>
          </template>
          <div v-if="data.running.length" class="space-y-2">
            <NuxtLink v-for="job in data.running" :key="job.id" :to="`/job/${job.id}`" class="block hover:underline">
              <span class="font-medium">{{ job.title }}</span>
              <span class="block text-sm text-muted">da {{ formatDuration(job.startedAt) }} · {{ formatTokens(job.weightedTokens) }} token pesati</span>
            </NuxtLink>
          </div>
          <p v-else class="text-muted">Nessun job in corso.</p>
          <p class="mt-3 text-sm text-muted">
            {{ data.queued === 1 ? '1 job in coda' : `${data.queued} job in coda` }}
          </p>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-medium">Worker</h2>
          </template>
          <div class="flex items-center gap-2">
            <span class="size-2.5 rounded-full" :class="data.worker.alive ? 'bg-success' : 'bg-error'" />
            <span class="font-medium">{{ data.worker.alive ? 'Vivo' : 'Fermo' }}</span>
          </div>
          <p class="mt-2 text-sm text-muted">
            Ultimo battito: {{ formatAgo(data.worker.lastBeat) }}
            <template v-if="data.worker.startedAt"> · acceso da {{ formatDuration(data.worker.startedAt) }}</template>
          </p>
          <p v-if="!data.worker.alive" class="mt-2 text-sm">
            I job restano in coda finché il worker non riparte: <code>pnpm service install</code>.
          </p>
        </UCard>

        <UCard class="lg:col-span-2">
          <template #header>
            <h2 class="font-medium">Job di oggi</h2>
          </template>
          <ul v-if="data.jobsToday.length" class="divide-y divide-default">
            <li v-for="job in data.jobsToday" :key="job.id" class="flex items-center gap-3 py-2">
              <UBadge :color="STATUS_COLOR[job.status]" variant="subtle" :label="STATUS_LABEL[job.status]" class="shrink-0" />
              <NuxtLink :to="`/job/${job.id}`" class="min-w-0 flex-1 truncate hover:underline">{{ job.title }}</NuxtLink>
              <span class="shrink-0 text-sm tabular-nums text-muted">{{ formatTokens(job.weightedTokens) }} · {{ formatUsd(job.costUsd) }}</span>
            </li>
          </ul>
          <p v-else class="text-muted">Oggi non è ancora partito nessun job.</p>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-medium">Attività delle ultime 24 ore</h2>
          </template>
          <ul v-if="data.activity.length" class="space-y-2">
            <li v-for="item in data.activity" :key="item.id" class="text-sm">
              <span class="tabular-nums text-muted">{{ formatTime(item.at) }}</span>
              {{ item.text }}
              <NuxtLink v-if="item.jobId" :to="`/job/${item.jobId}`" class="text-muted hover:underline">(job {{ item.jobId }})</NuxtLink>
            </li>
          </ul>
          <p v-else class="text-sm text-muted">Niente da segnalare. I job scrivono qui con il tool activity_log.</p>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
