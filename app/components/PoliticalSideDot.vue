<script setup lang="ts">
defineProps<{ side: PoliticalSide | null, label?: boolean }>()
</script>

<template>
  <span v-if="side" class="inline-flex items-center gap-1.5" :title="POLITICAL_SIDE_LABEL[side]">
    <span class="inline-block size-2.5 shrink-0 rounded-full" :class="POLITICAL_SIDE_DOT[side]" />
    <span v-if="label">{{ POLITICAL_SIDE_LABEL[side] }}</span>
  </span>
</template>
