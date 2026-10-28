<script setup lang="ts">
const form = defineModel<SegmentForm>({ required: true })
defineProps<{ sources?: Record<QuerySource, boolean> }>()

const marketItems = optionsOf(MARKET_LABEL)
const sourceItems = optionsOf(QUERY_SOURCE_LABEL).filter(o => o.value !== 'manual')
const regionItems = [{ value: 'all', label: 'Tutta Italia' }, ...IT_REGIONS.map(r => ({ value: r, label: r }))]

function changeSource(index: number, source: QuerySource) {
  form.value.queries[index] = emptyQuery(source)
}
</script>

<template>
  <div class="grid gap-4 md:grid-cols-2">
    <UFormField label="Nome" required>
      <UInput v-model="form.name" placeholder="Per esempio: consulenti del lavoro in Puglia" class="w-full" />
    </UFormField>
    <UFormField label="Mercato" required>
      <USelect v-model="form.market" :items="marketItems" class="w-full" />
    </UFormField>

    <UFormField label="Settore" required help="In italiano, con le parole dei settori del portfolio: il punteggio guarda se didap ha già lavorato lì." class="md:col-span-2">
      <UInput v-model="form.sector" placeholder="consulenza del lavoro" class="w-full" />
    </UFormField>

    <UFormField label="Perché" help="Perché è un buon bersaglio e quale voce del portfolio fa da prova." class="md:col-span-2">
      <UTextarea v-model="form.description" :rows="2" autoresize class="w-full" />
    </UFormField>

    <div class="space-y-3 md:col-span-2">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium">Ricerche</h3>
        <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-plus" label="Aggiungi" @click="form.queries.push(emptyQuery())" />
      </div>
      <p v-if="!form.queries.length" class="text-sm text-muted">Nessuna ricerca: senza, il segmento non trova prospect.</p>

      <div v-for="(query, i) in form.queries" :key="i" class="grid gap-3 rounded-md border border-default p-3 md:grid-cols-6">
        <UFormField label="Fonte" class="md:col-span-2">
          <USelect :model-value="query.source" :items="sourceItems" class="w-full" @update:model-value="v => changeSource(i, v as QuerySource)" />
          <p v-if="sources && !sources[query.source]" class="mt-1 text-xs text-warning">Spenta: manca la chiave in .env</p>
        </UFormField>

        <UFormField v-if="query.source === 'places'" label="Ricerca su Maps, con la zona" class="md:col-span-3">
          <UInput v-model="query.text" placeholder="studio consulenza del lavoro Lecce" class="w-full" />
        </UFormField>

        <template v-else-if="query.source === 'it_registry'">
          <UFormField label="ATECO">
            <UInput v-model="query.atecoCode" placeholder="69.20" class="w-full" />
          </UFormField>
          <UFormField label="Provincia">
            <UInput v-model="query.province" placeholder="LE" maxlength="2" class="w-full" />
          </UFormField>
          <UFormField label="Dipendenti">
            <div class="flex gap-1">
              <UInputNumber v-model="query.minEmployees" :min="0" placeholder="da" class="w-full" />
              <UInputNumber v-model="query.maxEmployees" :min="0" placeholder="a" class="w-full" />
            </div>
          </UFormField>
        </template>

        <template v-else-if="query.source === 'it_comuni'">
          <UFormField label="Regione">
            <USelect v-model="query.region" :items="regionItems" class="w-full" />
          </UFormField>
          <UFormField label="Provincia">
            <UInput v-model="query.province" placeholder="LE" maxlength="2" class="w-full" />
          </UFormField>
          <UFormField label="Abitanti">
            <div class="flex gap-1">
              <UInputNumber v-model="query.minPopulation" :min="0" placeholder="da" class="w-full" />
              <UInputNumber v-model="query.maxPopulation" :min="0" placeholder="a" class="w-full" />
            </div>
          </UFormField>
        </template>

        <template v-else>
          <UFormField label="NAF">
            <UInput v-model="query.naf" placeholder="69.20Z" class="w-full" />
          </UFormField>
          <UFormField label="Dipartimento">
            <UInput v-model="query.departement" placeholder="69" class="w-full" />
          </UFormField>
          <UFormField label="Dipendenti">
            <div class="flex gap-1">
              <UInputNumber v-model="query.minEmployees" :min="0" placeholder="da" class="w-full" />
              <UInputNumber v-model="query.maxEmployees" :min="0" placeholder="a" class="w-full" />
            </div>
          </UFormField>
        </template>

        <UFormField label="Massimo">
          <div class="flex items-center gap-1">
            <UInputNumber v-model="query.limit" :min="1" :max="QUERY_LIMIT_MAX[query.source]" class="w-full" />
            <UButton color="neutral" variant="ghost" icon="i-lucide-trash-2" aria-label="Togli la ricerca" @click="form.queries.splice(i, 1)" />
          </div>
        </UFormField>
      </div>
    </div>

    <UFormField label="Note per l'agente" class="md:col-span-2">
      <UTextarea v-model="form.notes" :rows="2" autoresize class="w-full" />
    </UFormField>
  </div>
</template>
