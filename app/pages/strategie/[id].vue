<script setup lang="ts">
const route = useRoute()
const api = useApi()
const toast = useToast()
const id = Number(route.params.id)

const { data, error, refresh } = await useFetch(`/api/strategies/${id}`)
const strategy = computed(() => data.value?.strategy)
const writing = computed(() => data.value?.state === 'writing')
// Si aggiorna solo mentre Opus scrive; il markdown si rifà solo quando cambia il testo.
useIntervalRefresh(async () => writing.value && refresh(), 4000)
const text = computed(() => strategy.value?.body ?? '')
const sections = computed(() => markdownSections(text.value).map(s => ({ ...s, html: renderMarkdown(s.body) })))

const busy = ref(false)
async function act(request: () => Promise<unknown>, failTitle: string): Promise<boolean> {
  busy.value = true
  try {
    await request()
    await refresh()
    return true
  }
  catch (err) {
    toast.add({ title: failTitle, description: apiErrorMessage(err), color: 'error' })
    return false
  }
  finally {
    busy.value = false
  }
}
const put = (body: object) => api(`/api/strategies/${id}`, { method: 'PUT', body })

// Note per l'agente: le rilegge quando la riscrive.
const notes = ref('')
watch(() => strategy.value?.notes, n => (notes.value = n ?? ''), { immediate: true })
const setStatus = (status: StrategyStatus) => act(() => put({ notes: notes.value, status }), 'Strategia non salvata')
const saveNotes = () => act(() => put({ notes: notes.value }), 'Note non salvate')
// Prima le note, poi la riscrittura che le legge: se le note non si salvano, non parte niente.
const rewrite = () => act(async () => {
  await put({ notes: notes.value })
  await api(`/api/strategies/${id}/rewrite`, { method: 'POST' })
  // Opus rifà anche il messaggio: un ritocco aperto andrebbe perso comunque.
  editing.value = false
}, 'Riscrittura non partita')

// Il primo messaggio: a chi va, e si può ritoccare prima di mandarlo.
const recipient = computed(() => data.value?.contacts[0] ?? null)
const editing = ref(false)
const subject = ref('')
const body = ref('')
function edit() {
  subject.value = strategy.value?.openingSubject ?? ''
  body.value = strategy.value?.openingBody ?? ''
  editing.value = true
}
const saveMessage = () => act(() => put({ openingSubject: subject.value, openingBody: body.value }), 'Messaggio non salvato').then(ok => ok && (editing.value = false))
// Il pannello scorre al posto della finestra: l'ancora del router non lo muoverebbe.
const goTo = (i: number) => document.getElementById(`sezione-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
async function copyMessage() {
  await navigator.clipboard.writeText(`${strategy.value?.openingSubject ?? ''}\n\n${strategy.value?.openingBody ?? ''}`)
  toast.add({ title: 'Messaggio copiato' })
}
</script>

<template>
  <UDashboardPanel id="strategia">
    <template #header>
      <UDashboardNavbar :title="strategy?.title ?? 'Strategia'">
        <template #leading>
          <UButton to="/strategie" icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Torna alle strategie" />
        </template>
        <template v-if="strategy" #right>
          <UBadge :color="STRATEGY_STATUS_COLOR[strategy.status]" variant="subtle" :label="STRATEGY_STATUS_LABEL[strategy.status]" />
          <UButton :href="`/api/strategies/${id}/md`" external color="neutral" variant="ghost" icon="i-lucide-download" label=".md" :disabled="!strategy.body" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" label="Riscrivi" :loading="writing" :disabled="busy || writing" @click="rewrite" />
          <UButton v-if="strategy.status !== 'archived'" color="neutral" variant="ghost" icon="i-lucide-archive" label="Archivia" :disabled="busy" @click="setStatus('archived')" />
          <UButton v-if="strategy.status !== 'approved'" icon="i-lucide-check" label="Approva" :disabled="busy || writing || !strategy.body" @click="setStatus('approved')" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="subtle" :title="error.statusCode === 404 ? 'Questa strategia non esiste' : 'Strategia non caricata'" />

      <template v-if="strategy">
        <p class="text-sm text-muted">
          Per
          <template v-for="(t, i) in data?.targets" :key="t.id">
            <NuxtLink :to="`/prospect/${t.id}`" class="hover:underline">{{ t.name }}</NuxtLink>{{ i < (data?.targets.length ?? 0) - 1 ? ', ' : '' }}
          </template>
          · aggiornata {{ formatDateTime(strategy.updatedAt) }}
          <template v-if="strategy.jobId"> · <NuxtLink :to="`/job/${strategy.jobId}`" class="hover:underline">job {{ strategy.jobId }}</NuxtLink></template>
        </p>

        <UAlert v-if="writing" color="info" variant="subtle" title="Opus la sta scrivendo" description="Si aggiorna da sola quando ha finito." />
        <UAlert v-else-if="data?.state === 'failed'" color="error" variant="subtle" title="Il job non l'ha scritta" description="Guarda il job per capire perché, poi Riscrivi." />

        <div v-if="strategy.body || !writing" class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <!-- Il piano: la sintesi in evidenza, l'indice e una sezione per scheda. -->
          <div v-if="strategy.body" class="space-y-4">
            <UCard class="bg-elevated/50">
              <p class="text-base leading-relaxed">{{ strategy.summary }}</p>
            </UCard>
            <!-- L'indice resta in cima mentre si legge, per saltare da una sezione all'altra. -->
            <nav class="sticky -top-4 z-10 -mx-2 flex flex-wrap gap-1 border-b border-default bg-default p-2 sm:-top-6" aria-label="Sezioni della strategia">
              <UButton v-for="(s, i) in sections" :key="i" size="xs" color="neutral" variant="soft" :label="s.title" @click="goTo(i)" />
            </nav>
            <UCard v-for="(s, i) in sections" :id="`sezione-${i}`" :key="i" class="scroll-mt-24">
              <template #header>
                <h2 class="font-semibold">{{ s.title }}</h2>
              </template>
              <!-- Il markdown passa dall'escape in renderMarkdown: qui è HTML sicuro. -->
              <div class="max-w-prose text-[15px] leading-relaxed" v-html="s.html" />
            </UCard>
          </div>

          <!-- Quello che serve per agire: scorre con la pagina, senza uno scroll suo. -->
          <div class="space-y-4">
            <UCard v-if="strategy.openingBody">
              <template #header>
                <div class="flex items-center justify-between gap-2">
                  <h2 class="font-semibold">Il primo messaggio</h2>
                  <UButton v-if="!editing" size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" label="Modifica" :disabled="writing" @click="edit" />
                </div>
              </template>
              <p v-if="recipient" class="mb-3 text-sm">
                <span class="text-muted">A:</span> {{ recipient.name }}, {{ recipient.role }}
                <span v-if="recipient.email" class="block text-muted">{{ recipient.email }}</span>
                <span v-else class="block text-warning">Email da trovare: pnpm contatti &lt;Comune&gt;</span>
              </p>
              <template v-if="editing">
                <UFormField label="Oggetto">
                  <UInput v-model="subject" class="w-full" />
                </UFormField>
                <UFormField label="Testo" class="mt-3">
                  <UTextarea v-model="body" :rows="16" autoresize class="w-full" />
                </UFormField>
                <div class="mt-3 flex gap-2">
                  <UButton size="sm" icon="i-lucide-save" label="Salva" :loading="busy" :disabled="writing || !subject.trim() || !body.trim()" @click="saveMessage" />
                  <UButton size="sm" color="neutral" variant="ghost" label="Annulla" @click="editing = false" />
                </div>
              </template>
              <template v-else>
                <p class="text-sm font-medium">{{ strategy.openingSubject }}</p>
                <p class="mt-2 whitespace-pre-line text-sm leading-relaxed">{{ strategy.openingBody }}</p>
                <div class="mt-4 flex flex-wrap gap-2">
                  <UButton v-if="data?.mail?.href" :href="data.mail.href" external size="sm" icon="i-lucide-mail" label="Apri nella posta" />
                  <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-copy" label="Copia" @click="copyMessage" />
                </div>
                <p v-if="data?.mail" class="mt-2 text-xs text-muted">{{ data.mail.note }}</p>
              </template>
            </UCard>

            <UCard v-if="data?.contacts.length">
              <template #header>
                <h2 class="font-semibold">Chi contattare, in ordine</h2>
              </template>
              <ol class="space-y-3 text-sm">
                <li v-for="(c, i) in data.contacts" :key="`${c.prospectId}-${c.name}`" class="flex gap-3">
                  <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold">{{ i + 1 }}</span>
                  <div class="min-w-0">
                    <p><span class="font-medium">{{ c.name }}</span> <span class="text-muted">· {{ c.role }}</span></p>
                    <p class="text-muted">{{ c.why }}</p>
                    <p class="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <a v-if="c.email" :href="`mailto:${c.email}`" class="underline">{{ c.email }}</a>
                      <UBadge v-if="c.linkedinActivity" :color="c.linkedinActivity === 'attivo' ? 'success' : 'neutral'" variant="subtle" size="sm">
                        <a v-if="c.linkedinUrl" :href="c.linkedinUrl" target="_blank" rel="noopener">LinkedIn {{ LINKEDIN_LABEL[c.linkedinActivity] }}</a>
                        <template v-else>LinkedIn: {{ LINKEDIN_LABEL[c.linkedinActivity] }}</template>
                      </UBadge>
                    </p>
                  </div>
                </li>
              </ol>
            </UCard>

            <UCard>
              <UFormField label="Note per l'agente" help="Le rilegge quando la riscrive: cosa cambiare, cosa non dire, a chi dare la precedenza.">
                <UTextarea v-model="notes" :rows="3" autoresize class="w-full" />
              </UFormField>
              <div class="mt-2 flex gap-2">
                <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-save" label="Salva le note" :disabled="busy || notes === strategy.notes" @click="saveNotes" />
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-refresh-cw" label="Salva e riscrivi" :disabled="busy || writing" @click="rewrite" />
              </div>
            </UCard>
          </div>
        </div>
      </template>
    </template>
  </UDashboardPanel>
</template>
