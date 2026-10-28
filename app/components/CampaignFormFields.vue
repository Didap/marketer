<script setup lang="ts">
const form = defineModel<CampaignForm>({ required: true })

const { data: segmentData } = await useFetch('/api/segments', { key: 'segments' })
const { data: identityList } = await useFetch('/api/identities', { key: 'identities' })
const { data: legal } = await useFetch('/api/legal', { key: 'legal' })

const segmentItems = computed(() => (segmentData.value?.segments ?? []).map(s => ({ value: s.id, label: `${s.name} (${MARKET_LABEL[s.market]})` })))
const identityItems = computed(() => (identityList.value ?? []).filter(i => i.active).map(i => ({ value: i.id, label: i.role ? `${i.name}, ${i.role}` : i.name })))
const languageItems = optionsOf(LANGUAGE_LABEL)
const channelItems = optionsOf(CHANNEL_LABEL)

const market = computed(() => segmentData.value?.segments.find(s => s.id === form.value.segmentId)?.market ?? null)
watch(market, (m, before) => {
  if (m && before !== undefined && MARKET_LANGUAGE[m]) form.value.language = MARKET_LANGUAGE[m]!
})

/** Per un'azienda trovata dall'agente in quel mercato: il passo si può fare? */
function verdict(channel: Channel) {
  const row = legal.value?.matrix.find(r => r.market === market.value)
  return row?.channels[channel] ?? null
}
</script>

<template>
  <div class="grid gap-4 md:grid-cols-2">
    <UFormField label="Nome" required class="md:col-span-2">
      <UInput v-model="form.name" placeholder="Per esempio: consulenti del lavoro, primo giro" class="w-full" />
    </UFormField>
    <UFormField label="Segmento" required>
      <USelect v-model="form.segmentId" :items="segmentItems" placeholder="Scegli il segmento" class="w-full" />
    </UFormField>
    <UFormField label="Mittente" required>
      <USelect v-model="form.identityId" :items="identityItems" placeholder="Scegli chi firma" class="w-full" />
      <p v-if="identityList && !identityItems.length" class="mt-1 text-xs text-warning">
        Nessuna identità: creane una in <NuxtLink to="/impostazioni" class="underline">Impostazioni</NuxtLink>.
      </p>
    </UFormField>
    <UFormField label="Lingua dei messaggi">
      <USelect v-model="form.language" :items="languageItems" class="w-full" />
    </UFormField>

    <div class="space-y-2 md:col-span-2">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium">Sequenza</h3>
        <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-plus" label="Aggiungi passo" :disabled="form.steps.length >= 8" @click="form.steps.push({ day: (form.steps.at(-1)?.day ?? 0) + 3, channel: 'email' })" />
      </div>
      <div v-for="(step, i) in form.steps" :key="i" class="flex flex-wrap items-center gap-2">
        <span class="w-14 text-sm text-muted">Giorno</span>
        <UInputNumber v-model="step.day" :min="0" :max="90" class="w-28" />
        <USelect v-model="step.channel" :items="channelItems" class="w-40" />
        <template v-if="verdict(step.channel)">
          <UIcon :name="verdict(step.channel)!.allowed ? 'i-lucide-check' : 'i-lucide-ban'" :class="verdict(step.channel)!.allowed ? 'text-success' : 'text-error'" class="size-4" />
          <span class="max-w-md text-xs text-muted">{{ verdict(step.channel)!.reason }}</span>
        </template>
        <UButton color="neutral" variant="ghost" icon="i-lucide-trash-2" aria-label="Togli il passo" class="ml-auto" :disabled="form.steps.length <= 1" @click="form.steps.splice(i, 1)" />
      </div>
      <p class="text-xs text-muted">I passi che la matrice legale non ammette si saltano: la bozza non viene scritta.</p>
    </div>

    <UFormField label="Indicazioni per chi scrive" help="Tono, cosa offrire, cosa evitare. Le legge il job che prepara le bozze." class="md:col-span-2">
      <UTextarea v-model="form.notes" :rows="3" autoresize class="w-full" />
    </UFormField>
  </div>
</template>
