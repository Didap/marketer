<script setup lang="ts">
const { data, refresh } = await useFetch('/api/messages', { key: 'approvals' })
useIntervalRefresh(refresh, 5000)
</script>

<template>
  <UDashboardPanel id="approvazioni">
    <template #header>
      <UDashboardNavbar :title="data?.length ? `Approvazioni (${data.length})` : 'Approvazioni'" />
    </template>

    <template #body>
      <p class="text-sm text-muted">
        Nessun messaggio parte senza la tua approvazione. Puoi correggere il testo prima di approvarlo; dal telefono
        arrivano le stesse bozze sul bot Telegram, se è acceso.
      </p>
      <MessageCard v-for="m in data ?? []" :key="m.id" :message="m" @changed="refresh" />
      <div v-if="!data?.length" class="py-10 text-center text-muted">
        Niente da approvare. Le bozze nascono dalle <NuxtLink to="/campagne" class="underline">campagne</NuxtLink>.
      </div>
    </template>
  </UDashboardPanel>
</template>
