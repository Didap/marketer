<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()

const { data, refresh } = await useFetch('/api/today', { key: 'worker-pill', pick: ['worker'] })
useIntervalRefresh(refresh, 5000)
</script>

<template>
  <div class="flex items-center gap-2 text-sm text-muted" :title="data?.worker.alive ? 'Worker vivo' : 'Worker fermo'">
    <span class="size-2 rounded-full shrink-0" :class="data?.worker.alive ? 'bg-success' : 'bg-error'" />
    <span v-if="!collapsed">
      Worker {{ data?.worker.alive ? 'vivo' : 'fermo' }}
      <span class="text-dimmed">· {{ formatAgo(data?.worker.lastBeat ?? null) }}</span>
    </span>
  </div>
</template>
