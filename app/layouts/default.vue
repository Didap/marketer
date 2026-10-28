<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const items: NavigationMenuItem[] = [
  { label: 'Oggi', icon: 'i-lucide-sun', to: '/' },
  { label: 'Approvazioni', icon: 'i-lucide-inbox', to: '/approvazioni' },
  { label: 'Campagne', icon: 'i-lucide-send', to: '/campagne' },
  { label: 'Prospect', icon: 'i-lucide-building-2', to: '/prospect' },
  { label: 'Segmenti', icon: 'i-lucide-target', to: '/segmenti' },
  { label: 'Strategie', icon: 'i-lucide-compass', to: '/strategie' },
  { label: 'Portfolio', icon: 'i-lucide-briefcase', to: '/portfolio' },
  { label: 'Job', icon: 'i-lucide-terminal', to: '/job' },
  { label: 'Impostazioni', icon: 'i-lucide-settings', to: '/impostazioni' },
]
</script>

<template>
  <UDashboardGroup>
    <UDashboardSidebar collapsible :ui="{ footer: 'border-t border-default' }">
      <template #header="{ collapsed }">
        <span v-if="!collapsed" class="font-semibold text-highlighted">Marketer</span>
        <UIcon v-else name="i-lucide-megaphone" class="size-5 mx-auto" />
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu :collapsed="collapsed" :items="items" orientation="vertical" />
      </template>

      <template #footer="{ collapsed }">
        <WorkerPill :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
