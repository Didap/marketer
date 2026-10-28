<script setup lang="ts">
const form = defineModel<PortfolioForm>({ required: true })
const props = defineProps<{ slug?: string }>()

const { data: all } = await useFetch('/api/portfolio', { key: 'portfolio-all' })

const kindItems = (Object.keys(KIND_LABEL) as PortfolioKind[]).map(value => ({ value, label: KIND_LABEL[value] }))
const relatedItems = computed(() => (all.value ?? [])
  .filter(i => i.slug !== props.slug)
  .map(i => ({ value: i.slug, label: `${i.name} (${KIND_LABEL[i.kind]})` })))
</script>

<template>
  <div class="grid gap-4 md:grid-cols-2">
    <UFormField label="Tipo" required>
      <USelect v-model="form.kind" :items="kindItems" class="w-full" />
    </UFormField>
    <UFormField label="Nome" required>
      <UInput v-model="form.name" class="w-full" />
    </UFormField>

    <UFormField label="Sintesi" help="Una frase: cos'è e per chi." class="md:col-span-2">
      <UInput v-model="form.summary" class="w-full" />
    </UFormField>

    <UFormField label="Settori" help="Invio dopo ogni settore. Servono a trovare prospect simili." class="md:col-span-2">
      <UInputTags v-model="form.sectors" class="w-full" />
    </UFormField>

    <UFormField v-if="form.kind === 'case'" label="Cliente">
      <UInput v-model="form.client" class="w-full" />
    </UFormField>
    <UFormField label="Sito" :class="form.kind === 'case' ? '' : 'md:col-span-2'">
      <UInput v-model="form.url" type="url" placeholder="https://" class="w-full" />
    </UFormField>

    <UFormField label="Problema" class="md:col-span-2">
      <UTextarea v-model="form.problem" :rows="3" autoresize class="w-full" />
    </UFormField>
    <UFormField label="Soluzione" class="md:col-span-2">
      <UTextarea v-model="form.solution" :rows="3" autoresize class="w-full" />
    </UFormField>
    <UFormField label="Risultati" help="Solo risultati veri: finiscono nei messaggi ai prospect." class="md:col-span-2">
      <UTextarea v-model="form.results" :rows="3" autoresize class="w-full" />
    </UFormField>

    <UFormField label="Stack">
      <UInput v-model="form.stack" class="w-full" />
    </UFormField>
    <UFormField label="Anno">
      <UInput v-model.number="form.year" type="number" :min="1990" :max="2100" class="w-full" />
    </UFormField>

    <UFormField label="Tag">
      <UInputTags v-model="form.tags" class="w-full" />
    </UFormField>
    <UFormField label="Voci collegate" help="Il cliente di un caso, il prodotto usato.">
      <USelectMenu v-model="form.related" :items="relatedItems" value-key="value" multiple placeholder="Nessuna" class="w-full" />
    </UFormField>

    <UFormField class="md:col-span-2">
      <USwitch v-model="form.citable" label="Citabile" description="Il nome si può fare in un messaggio a un prospect." />
    </UFormField>

    <UFormField label="Note per l'agente" help="Cosa non dire, chi citare come referente, quando usarla." class="md:col-span-2">
      <UTextarea v-model="form.notes" :rows="2" autoresize class="w-full" />
    </UFormField>
  </div>
</template>
