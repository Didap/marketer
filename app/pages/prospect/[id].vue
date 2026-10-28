<script setup lang="ts">
const route = useRoute()
const api = useApi()
const toast = useToast()
const id = Number(route.params.id)

const { data, error, refresh } = await useFetch(`/api/prospects/${id}`)
const prospect = computed(() => data.value?.prospect)
const audit = computed(() => data.value?.audit)
const pending = computed(() => data.value?.audits.find(a => a.status === 'queued' || a.status === 'running') ?? null)
const lastFailed = computed(() => {
  const last = data.value?.audits[0]
  return last?.status === 'failed' ? last : null
})
useIntervalRefresh(refresh, 4000)

const form = ref({ website: '', phone: '', legalBasis: 'b2b_optout' as LegalBasis, notes: '' })
const savedSnapshot = ref('')
const dirty = computed(() => JSON.stringify(form.value) !== savedSnapshot.value)
const busy = ref(false)

function load() {
  if (!prospect.value) return
  const p = prospect.value
  form.value = { website: p.website ?? '', phone: p.phone ?? '', legalBasis: p.legalBasis, notes: p.notes }
  savedSnapshot.value = JSON.stringify(form.value)
}
watch(() => prospect.value?.updatedAt, load, { immediate: true })

async function act(request: () => Promise<unknown>, failTitle: string) {
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

const save = () => act(() => api(`/api/prospects/${id}`, {
  method: 'PUT',
  body: { ...form.value, website: form.value.website.trim() || null, phone: form.value.phone.trim() || null },
}), 'Prospect non salvato')

async function setStatus(status: ProspectStatus) {
  if (dirty.value && !(await save())) return
  await act(() => api(`/api/prospects/${id}/status`, { method: 'POST', body: { status } }), 'Stato non cambiato')
}

const reaudit = () => act(() => api(`/api/prospects/${id}/audit`, { method: 'POST' }), 'Audit non partito')

const { data: strategyList } = await useFetch('/api/strategies', { query: { prospectId: id } })
const { start: startStrategy, starting } = useStartStrategy()

async function generateIdeas() {
  const job = await act(() => api<{ id: number }>(`/api/prospects/${id}/ideas`, { method: 'POST' }), 'Idee non partite')
  if (job) toast.add({ title: 'Idee in preparazione', description: 'Un job di Opus le scrive dal portfolio e dall\'audit.', actions: [{ label: 'Apri il job', to: '/job' }] })
}

const legalItems = optionsOf(LEGAL_BASIS_LABEL)

const fitParts = computed(() => {
  const c = data.value?.comune
  if (!c) return []
  return [
    ['Rigenerazione urbana', c.fit.regeneration, c.max.regeneration],
    ['Digitale', c.fit.digital, c.max.digital],
    ['Spazio per CityFix', c.fit.space, c.max.space],
    ['Bisogno: manutenzione', c.fit.maintenance, c.max.maintenance],
  ] as [string, number, number][]
})

const signalGroups = computed(() => (Object.keys(SIGNAL_KIND_LABEL) as SignalKind[])
  .map(kind => ({ kind, items: (data.value?.comune?.signals ?? []).filter(s => s.kind === kind) }))
  .filter(g => g.items.length))

const facts = computed(() => {
  const p = prospect.value
  if (!p) return []
  return [
    ['Fonte', QUERY_SOURCE_LABEL[p.source]],
    ['Registro', p.registryId],
    ['Settore', [p.sectorCode, p.sectorLabel].filter(Boolean).join(' · ')],
    ['Dipendenti', employeesText(p.employeesMin, p.employeesMax)],
    ['Nata il', p.foundedAt],
    ['Abitanti', p.population === null ? null : formatNumber(p.population)],
    ['Giunta eletta il', formatDay(p.electedAt)],
    ['Indirizzo', p.address],
    ['Telefono', p.phone],
    [isComune(p) ? 'PEC' : 'Email', p.email],
  ].filter(([, v]) => v) as [string, string][]
})

const lighthouse = computed(() => {
  const a = audit.value
  if (!a) return []
  return [
    ['Prestazioni', a.performance],
    ['Accessibilità', a.accessibility],
    ['SEO', a.seo],
    ['Buone pratiche', a.bestPractices],
  ] as [string, number | null][]
})
</script>

<template>
  <UDashboardPanel id="prospect-scheda">
    <template #header>
      <UDashboardNavbar :title="prospect?.name ?? 'Prospect'">
        <template #leading>
          <UButton to="/prospect" icon="i-lucide-arrow-left" color="neutral" variant="ghost" aria-label="Torna ai prospect" />
        </template>
        <template v-if="prospect" #right>
          <UBadge :color="PROSPECT_STATUS_COLOR[prospect.status]" variant="subtle" :label="PROSPECT_STATUS_LABEL[prospect.status]" />
          <UButton v-if="prospect.status !== 'new'" color="neutral" variant="outline" icon="i-lucide-undo-2" label="Rimetti da guardare" :disabled="busy" @click="setStatus('new')" />
          <UButton v-if="prospect.status !== 'discarded'" color="neutral" variant="outline" icon="i-lucide-x" label="Scarta" :disabled="busy" @click="setStatus('discarded')" />
          <UButton color="neutral" variant="outline" icon="i-lucide-save" label="Salva" :disabled="!dirty || busy" @click="save" />
          <UButton v-if="prospect.status !== 'qualified'" icon="i-lucide-check" label="Qualifica" :disabled="busy" @click="setStatus('qualified')" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert v-if="error" color="error" variant="subtle" :title="error.statusCode === 404 ? 'Questo prospect non esiste' : 'Prospect non caricato'" />

      <template v-if="prospect">
        <p class="text-sm text-muted">
          {{ [prospect.city, prospect.region, MARKET_LABEL[prospect.country as Market] ?? prospect.country].filter(Boolean).join(', ') }}
          <template v-if="data?.segment"> · segmento <NuxtLink :to="`/segmenti/${data.segment.id}`" class="hover:underline">{{ data.segment.name }}</NuxtLink></template>
          · trovato {{ formatDateTime(prospect.createdAt) }}
        </p>

        <div class="grid gap-4 md:grid-cols-3">
          <UCard>
            <p class="text-sm text-muted">Punteggio</p>
            <p class="text-3xl font-semibold">{{ prospect.score ?? '-' }}</p>
            <p class="mt-2 text-sm text-muted">
              Fit {{ prospect.fitScore ?? '-' }} · bisogno {{ prospect.needScore ?? 'da capire' }} · freschezza {{ prospect.freshScore ?? '-' }}
            </p>
          </UCard>
          <UCard class="md:col-span-2">
            <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <template v-for="[label, value] in facts" :key="label">
                <dt class="text-muted">{{ label }}</dt>
                <dd>{{ value }}</dd>
              </template>
              <template v-if="prospect.politicalSide">
                <dt class="text-muted">Orientamento</dt>
                <dd><PoliticalSideDot :side="prospect.politicalSide" label /></dd>
              </template>
            </dl>
          </UCard>
        </div>

        <UCard v-if="data?.comune">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-medium">Perché CityFix</h2>
              <span class="text-xs text-muted">dati aperti raccolti il {{ formatDay(data.comune.collectedAt) }}</span>
            </div>
          </template>
          <div class="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div v-for="[label, value, max] in fitParts" :key="label" class="rounded-md border border-default p-3">
              <p class="text-xs text-muted">{{ label }}</p>
              <p class="text-xl font-semibold">{{ value }}<span class="text-sm font-normal text-muted"> / {{ max }}</span></p>
            </div>
          </div>
          <div v-for="group in signalGroups" :key="group.kind" class="mb-3">
            <h3 class="mb-1 text-sm font-medium">{{ SIGNAL_KIND_LABEL[group.kind] }}</h3>
            <ul class="space-y-1 text-sm">
              <li v-for="(s, i) in group.items" :key="i">
                {{ s.text }}
                <span class="text-xs text-muted"> · {{ s.source }}</span>
                <a v-if="s.url" :href="s.url" target="_blank" rel="noopener" class="ml-1 text-xs underline">verifica</a>
              </li>
            </ul>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-medium">Strategia</h2>
              <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-compass" label="Scrivi la strategia" :loading="starting" :disabled="busy" @click="startStrategy([id])" />
            </div>
          </template>
          <ul v-if="strategyList?.length" class="divide-y divide-default text-sm">
            <li v-for="s in strategyList" :key="s.id" class="flex items-start justify-between gap-4 py-2">
              <div>
                <NuxtLink :to="`/strategie/${s.id}`" class="font-medium hover:underline">{{ s.title }}</NuxtLink>
                <span v-if="s.targets.length > 1" class="text-muted"> · gruppo di {{ s.targets.length }}</span>
                <p class="text-muted">{{ strategyLine(s) }}</p>
              </div>
              <UBadge :color="STRATEGY_STATUS_COLOR[s.status]" variant="subtle" :label="STRATEGY_STATUS_LABEL[s.status]" />
            </li>
          </ul>
          <p v-else class="text-sm text-muted">Nessuna strategia. Per un gruppo, seleziona più prospect nella lista.</p>
        </UCard>

        <UCard v-if="data?.contacts.length">
          <template #header>
            <h2 class="font-medium">Persone</h2>
          </template>
          <ul class="divide-y divide-default text-sm">
            <li v-for="c in data.contacts" :key="c.id" class="py-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium">{{ c.name }}</span>
                <span class="text-muted">{{ c.role }}<template v-if="c.since">, in carica dal {{ formatDay(c.since) }}</template></span>
                <UBadge v-for="a in c.angles" :key="a" color="primary" variant="subtle" size="sm" :label="a" />
              </div>
              <p v-if="c.email" class="text-sm">
                <a :href="`mailto:${c.email}`" class="hover:underline">{{ c.email }}</a>
                <a v-if="c.sourceUrl" :href="c.sourceUrl" target="_blank" rel="noopener" class="ml-2 text-xs text-muted underline">fonte</a>
              </p>
              <p v-if="c.linkedinActivity" class="text-xs text-muted">
                LinkedIn:
                <a v-if="c.linkedinUrl" :href="c.linkedinUrl" target="_blank" rel="noopener" class="underline">{{ LINKEDIN_LABEL[c.linkedinActivity] }}</a>
                <template v-else>{{ LINKEDIN_LABEL[c.linkedinActivity] }}</template>
                <template v-if="c.linkedinNote"> · {{ c.linkedinNote }}</template>
                <template v-if="c.linkedinCheckedAt"> ({{ formatDateTime(c.linkedinCheckedAt) }})</template>
              </p>
              <p v-if="c.delegations" class="text-xs text-muted">Deleghe: {{ c.delegations }}</p>
              <p v-if="c.lists" class="text-xs text-muted">Liste: {{ c.lists }}</p>
            </li>
          </ul>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-medium">Audit del sito</h2>
              <div class="flex items-center gap-2">
                <UBadge v-if="pending" :color="WORK_STATUS_COLOR[pending.status]" variant="subtle" :label="WORK_STATUS_LABEL[pending.status]" />
                <UButton v-if="prospect.website" size="xs" color="neutral" variant="outline" icon="i-lucide-refresh-cw" label="Rifai l'audit" :disabled="busy || !!pending" @click="reaudit" />
              </div>
            </div>
          </template>

          <p v-if="!prospect.website" class="text-sm text-muted">
            {{ prospect.placeId ? 'Google Maps non conosce un sito: è già un aggancio.' : 'Sito sconosciuto: scrivilo qui sotto e l\'audit parte da solo.' }}
          </p>
          <UAlert v-else-if="lastFailed && !pending" color="warning" variant="subtle" title="L'ultimo audit non è riuscito" :description="lastFailed.error ?? ''" class="mb-4" />

          <template v-if="audit">
            <p class="mb-3 text-sm text-muted">
              <a :href="audit.finalUrl ?? audit.url" target="_blank" rel="noopener" class="hover:underline">{{ audit.finalUrl ?? audit.url }}</a>
              · {{ formatDateTime(audit.finishedAt) }}
              <template v-if="audit.error"> · Lighthouse non riuscito: {{ audit.error }}</template>
            </p>
            <div class="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div v-for="[label, value] in lighthouse" :key="label" class="rounded-md border border-default p-3">
                <p class="text-xs text-muted">{{ label }}</p>
                <p class="text-xl font-semibold">{{ value ?? '-' }}</p>
              </div>
            </div>

            <h3 class="mb-2 text-sm font-medium">Difetti, dal più grave</h3>
            <ul v-if="audit.issues.length" class="mb-4 space-y-2">
              <li v-for="issue in audit.issues" :key="issue.code" class="flex items-start gap-2 text-sm">
                <UBadge :color="SEVERITY_COLOR[issue.severity]" variant="subtle" :label="String(issue.severity)" class="mt-0.5" />
                <span>{{ issue.text }}</span>
              </li>
            </ul>
            <p v-else class="mb-4 text-sm text-muted">Nessun difetto trovato.</p>

            <div class="flex flex-wrap gap-2 text-sm">
              <UBadge v-for="item in audit.stack" :key="item.name" :color="item.outdated ? 'warning' : 'neutral'" variant="outline" :label="item.version ? `${item.name} ${item.version}` : item.name" />
              <UBadge :color="audit.hasForm ? 'success' : 'neutral'" variant="outline" :label="audit.hasForm ? 'Modulo di contatto' : 'Nessun modulo'" />
              <UBadge :color="audit.hasBooking ? 'success' : 'neutral'" variant="outline" :label="audit.hasBooking ? 'Prenotazione online' : 'Nessuna prenotazione'" />
            </div>
          </template>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <h2 class="font-medium">Idee</h2>
              <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-sparkles" :label="data?.ideas.length ? 'Rifai le idee' : 'Genera idee'" :disabled="busy" @click="generateIdeas" />
            </div>
          </template>
          <ul v-if="data?.ideas.length" class="space-y-3">
            <li v-for="idea in data.ideas" :key="idea.id">
              <p class="font-medium">
                {{ idea.title }}
                <UBadge color="neutral" variant="outline" :label="IDEA_KIND_LABEL[idea.kind]" class="ml-2" />
              </p>
              <p class="text-sm">{{ idea.pitch }}</p>
              <p class="text-xs text-muted">
                {{ [idea.effort, idea.priceBand].filter(Boolean).join(' · ') }}
                <template v-if="idea.portfolioSlug"> · prova: {{ idea.portfolioSlug }}</template>
              </p>
            </li>
          </ul>
          <p v-else class="text-sm text-muted">Ancora nessuna idea. Le scrive anche il job delle bozze, se mancano.</p>
        </UCard>

        <UCard v-if="data?.messages.length">
          <template #header>
            <h2 class="font-medium">Messaggi</h2>
          </template>
          <ul class="divide-y divide-default text-sm">
            <li v-for="m in data.messages" :key="m.id" class="flex items-center justify-between gap-4 py-2">
              <span>
                <UIcon :name="CHANNEL_ICON[m.channel]" class="mr-1 size-4 align-middle text-muted" />
                {{ m.subject ?? m.body.slice(0, 80) }}
              </span>
              <UBadge :color="MESSAGE_STATUS_COLOR[m.status]" variant="subtle" :label="MESSAGE_STATUS_LABEL[m.status]" />
            </li>
          </ul>
          <UButton v-if="data.messages.some(m => m.status === 'pending')" to="/approvazioni" size="xs" color="neutral" variant="ghost" trailing-icon="i-lucide-arrow-right" label="Vai alle approvazioni" class="mt-2" />
        </UCard>

        <UCard>
          <div class="grid gap-4 md:grid-cols-2">
            <UFormField label="Sito" help="Se lo cambi, l'audit si rifà.">
              <UInput v-model="form.website" placeholder="https://" class="w-full" />
            </UFormField>
            <UFormField label="Telefono">
              <UInput v-model="form.phone" class="w-full" />
            </UFormField>
            <UFormField label="Base legale" help="Dalla Fase 4 la matrice legale decide, per paese e canale, cosa è ammesso." class="md:col-span-2">
              <USelect v-model="form.legalBasis" :items="legalItems" class="w-full" />
            </UFormField>
            <UFormField label="Note" class="md:col-span-2">
              <UTextarea v-model="form.notes" :rows="3" autoresize class="w-full" />
            </UFormField>
          </div>
        </UCard>
      </template>
    </template>
  </UDashboardPanel>
</template>
