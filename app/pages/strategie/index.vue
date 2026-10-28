<script setup lang="ts">
const { data, refresh } = await useFetch('/api/strategies')
// Si aggiorna solo mentre Opus ne sta scrivendo qualcuna.
useIntervalRefresh(async () => data.value?.some(s => s.state === 'writing') && refresh(), 5000)
</script>

<template>
  <UDashboardPanel id="strategie">
    <template #header>
      <UDashboardNavbar title="Strategie">
        <template #right>
          <UButton to="/prospect" color="neutral" variant="outline" icon="i-lucide-building-2" label="Scegli i target" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <p class="text-sm text-muted">
        Una strategia di contatto per un target o per un gruppo: la scrive un job di Opus da tutti i dati dei prospect e dal portfolio, nel rispetto della matrice legale. Si avvia dalla scheda di un prospect o selezionando più prospect nella lista.
      </p>
      <ul v-if="data?.length" class="divide-y divide-default">
        <li v-for="s in data" :key="s.id" class="flex items-start justify-between gap-4 py-3">
          <div class="min-w-0">
            <NuxtLink :to="`/strategie/${s.id}`" class="font-medium hover:underline">{{ s.title }}</NuxtLink>
            <p class="text-sm text-muted">{{ strategyLine(s) }}</p>
            <p class="text-xs text-dimmed">{{ s.targets.map(t => t.name).join(', ') }} · {{ formatDateTime(s.updatedAt) }}</p>
          </div>
          <UBadge :color="STRATEGY_STATUS_COLOR[s.status]" variant="subtle" :label="STRATEGY_STATUS_LABEL[s.status]" />
        </li>
      </ul>
      <p v-else class="text-sm text-muted">Ancora nessuna strategia.</p>
    </template>
  </UDashboardPanel>
</template>
