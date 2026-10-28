<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

const { data, refresh } = await useFetch('/api/campaigns', { key: 'campaigns' })
useIntervalRefresh(refresh, 5000)

type Row = NonNullable<typeof data.value>[number]

const columns: TableColumn<Row>[] = [
  { accessorKey: 'name', header: 'Campagna' },
  { accessorKey: 'steps', header: 'Sequenza' },
  { accessorKey: 'messages', header: 'Messaggi' },
  { accessorKey: 'status', header: 'Stato' },
]
</script>

<template>
  <UDashboardPanel id="campagne">
    <template #header>
      <UDashboardNavbar title="Campagne">
        <template #right>
          <UButton to="/campagne/nuova" icon="i-lucide-plus" label="Nuova campagna" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UTable :data="data ?? []" :columns="columns">
        <template #empty>
          <div class="py-6 text-center text-muted">Nessuna campagna. Una campagna prende un segmento, un mittente e una sequenza di passi.</div>
        </template>
        <template #name-cell="{ row }">
          <NuxtLink :to="`/campagne/${row.original.id}`" class="font-medium hover:underline">{{ row.original.name }}</NuxtLink>
          <p class="text-sm text-muted">{{ row.original.segmentName }} · {{ MARKET_LABEL[row.original.market] }} · {{ LANGUAGE_LABEL[row.original.language] }} · {{ row.original.identityName }}</p>
        </template>
        <template #steps-cell="{ row }">
          <div class="flex flex-wrap gap-1">
            <UBadge v-for="(s, i) in row.original.steps" :key="i" color="neutral" variant="outline" :icon="CHANNEL_ICON[s.channel]" :label="`g${s.day}`" />
          </div>
        </template>
        <template #messages-cell="{ row }">
          <span class="text-sm">
            <template v-for="status in (['pending', 'approved', 'sent', 'discarded'] as const)" :key="status">
              <span v-if="row.original.messages[status]" class="mr-3">{{ row.original.messages[status] }} {{ MESSAGE_STATUS_LABEL[status].toLowerCase() }}</span>
            </template>
          </span>
        </template>
        <template #status-cell="{ row }">
          <UBadge :color="CAMPAIGN_STATUS_COLOR[row.original.status]" variant="subtle" :label="CAMPAIGN_STATUS_LABEL[row.original.status]" />
        </template>
      </UTable>
    </template>
  </UDashboardPanel>
</template>
