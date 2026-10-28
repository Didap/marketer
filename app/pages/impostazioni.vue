<script setup lang="ts">
const api = useApi()
const toast = useToast()

const { data: list, refresh } = await useFetch('/api/identities', { key: 'identities' })
const { data: legal } = await useFetch('/api/legal', { key: 'legal' })

type Identity = NonNullable<typeof list.value>[number]

const emptyIdentity = () => ({ name: '', role: '', languages: ['it'] as Language[], email: '', linkedinUrl: '', phone: '', signature: '', active: true })
const editing = ref<number | 'new' | null>(null)
const form = ref(emptyIdentity())
const saving = ref(false)
const languageItems = optionsOf(LANGUAGE_LABEL)
const channels = Object.keys(CHANNEL_LABEL) as Channel[]

function open(identity?: Identity) {
  editing.value = identity?.id ?? 'new'
  form.value = identity
    ? { ...identity, email: identity.email ?? '', linkedinUrl: identity.linkedinUrl ?? '', phone: identity.phone ?? '' }
    : emptyIdentity()
}

async function save() {
  saving.value = true
  try {
    const url = editing.value === 'new' ? '/api/identities' : `/api/identities/${editing.value}`
    await api(url, { method: editing.value === 'new' ? 'POST' : 'PUT', body: form.value })
    editing.value = null
    await refresh()
  }
  catch (err) {
    toast.add({ title: 'Identità non salvata', description: apiErrorMessage(err), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="impostazioni">
    <template #header>
      <UDashboardNavbar title="Impostazioni" />
    </template>

    <template #body>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <div>
              <h2 class="font-medium">Mittenti</h2>
              <p class="text-sm text-muted">Chi firma i messaggi. Le caselle email arrivano con la Fase 5.</p>
            </div>
            <UButton size="sm" icon="i-lucide-plus" label="Nuovo mittente" @click="open()" />
          </div>
        </template>
        <ul v-if="list?.length" class="divide-y divide-default">
          <li v-for="identity in list" :key="identity.id" class="flex items-center justify-between gap-4 py-2">
            <div>
              <span class="font-medium" :class="identity.active ? '' : 'text-muted line-through'">{{ identity.name }}</span>
              <span class="text-sm text-muted">
                <template v-if="identity.role"> · {{ identity.role }}</template>
                · {{ identity.languages.map(l => LANGUAGE_LABEL[l]).join(', ') || 'nessuna lingua' }}
              </span>
            </div>
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" label="Modifica" @click="open(identity)" />
          </li>
        </ul>
        <p v-else class="text-sm text-muted">Nessun mittente: serve almeno una persona per creare una campagna.</p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-medium">Matrice legale</h2>
          <p class="text-sm text-muted">
            Cosa si può fare con un'azienda trovata dall'agente (base B2B con opt-out). Default prudenti: vanno verificati con un legale
            prima dell'invio (Fase 5). Con il consenso o con un cliente passato le regole sono più larghe.
          </p>
        </template>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-muted">
                <th class="py-1 pr-4 font-normal">Mercato</th>
                <th v-for="c in channels" :key="c" class="py-1 pr-4 font-normal">{{ CHANNEL_LABEL[c] }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in legal?.matrix ?? []" :key="row.market" class="border-t border-default">
                <td class="py-1 pr-4">{{ MARKET_LABEL[row.market] }}</td>
                <td v-for="c in channels" :key="c" class="py-1 pr-4">
                  <UTooltip :text="row.channels[c].reason">
                    <UIcon :name="row.channels[c].allowed ? 'i-lucide-check' : 'i-lucide-ban'" :class="row.channels[c].allowed ? 'text-success' : 'text-error'" class="size-4" />
                  </UTooltip>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-medium">Telefono</h2>
        </template>
        <p class="text-sm">
          Bot Telegram:
          <UBadge :color="legal?.telegram ? 'success' : 'neutral'" variant="subtle" :label="legal?.telegram ? 'acceso' : 'spento'" />
        </p>
        <p v-if="!legal?.telegram" class="mt-2 text-sm text-muted">
          Crea il bot con BotFather, scrivigli un messaggio, poi metti in .env TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID (il tuo id di chat)
          e lancia pnpm service restart. Il bot manda ogni bozza con Approva, Modifica, Scarta e alle 19 il rapporto del giorno.
        </p>
      </UCard>

      <UModal :open="editing !== null" :title="editing === 'new' ? 'Nuovo mittente' : 'Modifica mittente'" @update:open="(v: boolean) => { if (!v) editing = null }">
        <template #body>
          <form class="grid gap-4 md:grid-cols-2" @submit.prevent="save">
            <UFormField label="Nome" required>
              <UInput v-model="form.name" class="w-full" autofocus />
            </UFormField>
            <UFormField label="Ruolo">
              <UInput v-model="form.role" placeholder="Fondatore" class="w-full" />
            </UFormField>
            <UFormField label="Lingue" class="md:col-span-2">
              <USelect v-model="form.languages" :items="languageItems" multiple class="w-full" />
            </UFormField>
            <UFormField label="Profilo LinkedIn" class="md:col-span-2">
              <UInput v-model="form.linkedinUrl" placeholder="https://www.linkedin.com/in/" class="w-full" />
            </UFormField>
            <UFormField label="Telefono">
              <UInput v-model="form.phone" class="w-full" />
            </UFormField>
            <UFormField label="Email">
              <UInput v-model="form.email" type="email" class="w-full" />
            </UFormField>
            <UFormField label="Firma delle email" class="md:col-span-2">
              <UTextarea v-model="form.signature" :rows="3" autoresize class="w-full" />
            </UFormField>
            <UCheckbox v-model="form.active" label="Attivo" class="md:col-span-2" />
            <div class="flex justify-end gap-2 md:col-span-2">
              <UButton color="neutral" variant="ghost" label="Annulla" @click="editing = null" />
              <UButton type="submit" label="Salva" :loading="saving" :disabled="!form.name.trim()" />
            </div>
          </form>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
