<script setup lang="ts">
// Un messaggio da decidere, con accanto quello che serve per deciderlo.
interface MessageView {
  id: number
  channel: Channel
  status: MessageStatus
  subject: string | null
  body: string
  editedAt: string | Date | null
  identityName: string
  prospect: { id: number, name: string, city: string | null, website: string | null, score: number | null }
  issues: { code: string, severity: 1 | 2 | 3, text: string }[]
  ideas: { id: number, kind: IdeaKind, title: string, priceBand: string }[]
  campaign: { id: number, name: string, day: number | null } | null
}

const props = defineProps<{ message: MessageView }>()
const emit = defineEmits<{ changed: [] }>()
const api = useApi()
const toast = useToast()

const subject = ref(props.message.subject ?? '')
const body = ref(props.message.body)
watch(() => [props.message.subject, props.message.body], () => {
  subject.value = props.message.subject ?? ''
  body.value = props.message.body
})
const dirty = computed(() => body.value !== props.message.body || (props.message.channel === 'email' && subject.value !== (props.message.subject ?? '')))
const busy = ref(false)
const pending = computed(() => props.message.status === 'pending')

async function act(request: () => Promise<unknown>, failTitle: string) {
  busy.value = true
  try {
    await request()
    emit('changed')
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

const save = () => act(() => api(`/api/messages/${props.message.id}`, { method: 'PUT', body: { subject: subject.value, body: body.value } }), 'Modifica non salvata')

async function decide(decision: 'approve' | 'discard') {
  if (decision === 'approve' && dirty.value && !(await save())) return
  await act(() => api(`/api/messages/${props.message.id}/decision`, { method: 'POST', body: { decision } }), decision === 'approve' ? 'Non approvato' : 'Non scartato')
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <UIcon :name="CHANNEL_ICON[message.channel]" class="size-4 text-muted" />
          <NuxtLink :to="`/prospect/${message.prospect.id}`" class="font-medium hover:underline">{{ message.prospect.name }}</NuxtLink>
          <span class="text-sm text-muted">
            {{ CHANNEL_LABEL[message.channel] }}
            <template v-if="message.campaign"> · <NuxtLink :to="`/campagne/${message.campaign.id}`" class="hover:underline">{{ message.campaign.name }}</NuxtLink>, giorno {{ message.campaign.day }}</template>
            · firma {{ message.identityName }}
          </span>
        </div>
        <UBadge :color="MESSAGE_STATUS_COLOR[message.status]" variant="subtle" :label="MESSAGE_STATUS_LABEL[message.status]" />
      </div>
    </template>

    <div class="grid gap-4 lg:grid-cols-3">
      <div class="space-y-3 lg:col-span-2">
        <UInput v-if="message.channel === 'email'" v-model="subject" :disabled="!pending" placeholder="Oggetto" class="w-full" />
        <UTextarea v-model="body" :disabled="!pending" :rows="8" autoresize class="w-full" />
        <div v-if="pending" class="flex flex-wrap gap-2">
          <UButton icon="i-lucide-check" :label="dirty ? 'Salva e approva' : 'Approva'" :disabled="busy" @click="decide('approve')" />
          <UButton color="neutral" variant="outline" icon="i-lucide-save" label="Salva" :disabled="!dirty || busy" @click="save" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-x" label="Scarta" :disabled="busy" @click="decide('discard')" />
        </div>
      </div>

      <div class="space-y-3 text-sm">
        <p class="text-muted">
          {{ message.prospect.city }}
          <template v-if="message.prospect.website"> · <a :href="message.prospect.website" target="_blank" rel="noopener" class="hover:underline">{{ message.prospect.website.replace(/^https?:\/\/(www\.)?/, '') }}</a></template>
          · punteggio {{ message.prospect.score ?? '-' }}
        </p>
        <div v-if="message.issues.length">
          <p class="font-medium">Difetti del sito</p>
          <ul class="mt-1 space-y-1">
            <li v-for="issue in message.issues" :key="issue.code" class="flex gap-2">
              <UBadge :color="SEVERITY_COLOR[issue.severity]" variant="subtle" :label="String(issue.severity)" />
              <span>{{ issue.text }}</span>
            </li>
          </ul>
        </div>
        <div v-if="message.ideas.length">
          <p class="font-medium">Idee</p>
          <ul class="mt-1 space-y-1">
            <li v-for="idea in message.ideas" :key="idea.id">
              <span class="text-muted">{{ IDEA_KIND_LABEL[idea.kind] }}:</span> {{ idea.title }}
              <span v-if="idea.priceBand" class="text-muted"> ({{ idea.priceBand }})</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </UCard>
</template>
