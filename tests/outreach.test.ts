import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import { checkChannel } from '../server/lib/legal'
import type { FoundCompany } from '../server/lib/sources'
import { draftKeyboard, editPrompt, escapeHtml, parseCallback, parseEditReply } from '../server/lib/telegram'

const root = mkdtempSync(join(tmpdir(), 'marketer-outreach-'))

beforeAll(() => {
  process.env.MARKETER_DATA_DIR = join(root, 'data')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('matrice legale', () => {
  it('email a freddo B2B: no in Italia e DACH, sì in Francia e USA', () => {
    expect(checkChannel('b2b_optout', 'IT', 'email').allowed).toBe(false)
    expect(checkChannel('b2b_optout', 'DE', 'email').allowed).toBe(false)
    expect(checkChannel('b2b_optout', 'FR', 'email').allowed).toBe(true)
    expect(checkChannel('b2b_optout', 'US', 'email').reason).toContain('CAN-SPAM')
  })

  it('WhatsApp solo con il consenso, inbound mai, LinkedIn a mano sì', () => {
    expect(checkChannel('b2b_optout', 'FR', 'whatsapp').allowed).toBe(false)
    expect(checkChannel('consent', 'IT', 'whatsapp').allowed).toBe(true)
    expect(checkChannel('inbound_only', 'US', 'linkedin').allowed).toBe(false)
    expect(checkChannel('b2b_optout', 'IT', 'linkedin').allowed).toBe(true)
    expect(checkChannel('existing_customer', 'IT', 'email').allowed).toBe(true)
    expect(checkChannel('b2b_optout', 'DE', 'phone').allowed).toBe(false)
    expect(checkChannel('b2b_optout', 'BR', 'phone').allowed).toBe(false)
  })
})

describe('telegram', () => {
  it('bottoni e risposte si leggono indietro', () => {
    const data = draftKeyboard(42).inline_keyboard[0]!.map(b => parseCallback(b.callback_data))
    expect(data).toEqual([{ action: 'approve', id: 42 }, { action: 'edit', id: 42 }, { action: 'discard', id: 42 }])
    expect(parseCallback('x')).toBeNull()
    expect(parseEditReply(editPrompt(7))).toBe(7)
    expect(parseEditReply('altro')).toBeNull()
    expect(escapeHtml('<b>A & B</b>')).toBe('&lt;b&gt;A &amp; B&lt;/b&gt;')
  })
})

const company = (id: string, country: string): FoundCompany => ({
  name: `Studio ${id}`, country, city: 'Lyon', region: null, address: null, website: `https://studio${id}.example`, phone: null,
  registryId: `${country}:${id}`, placeId: null, sectorCode: null, sectorLabel: null, employeesMin: 10, employeesMax: 19, foundedAt: null, source: 'fr_registry',
})

describe('idee, campagne e messaggi', () => {
  let db: Db
  let out: typeof import('../server/lib/outreach')
  let pros: typeof import('../server/lib/prospects')
  let campaignId: number
  let fr: number
  let itId: number

  beforeAll(async () => {
    const client = await import('../server/db/client')
    db = client.useDb()
    migrate(db, { migrationsFolder: resolve('drizzle') })
    out = await import('../server/lib/outreach')
    pros = await import('../server/lib/prospects')

    const segment = pros.createSegment(db, { name: 'Studi', market: 'FR', sector: 'consulenza del lavoro' })
    fr = pros.upsertProspect(db, company('1', 'FR'), segment.id).id
    // Un prospect italiano nello stesso segmento: per lui l'email a freddo non passa.
    itId = pros.upsertProspect(db, company('2', 'IT'), segment.id).id
    pros.upsertProspect(db, company('3', 'FR'), segment.id)
    const identity = out.saveIdentity(db, null, { name: 'William', role: 'Fondatore', languages: ['it', 'fr'], signature: 'William\ndidap' })
    campaignId = out.saveCampaign(db, null, {
      name: 'Primo giro', segmentId: segment.id, identityId: identity.id, language: 'fr',
      steps: [{ day: 3, channel: 'linkedin' }, { day: 0, channel: 'email' }, { day: 10, channel: 'phone' }],
    }).id
  })

  it('la sequenza si ordina per giorno, e le bozze partono solo per i qualificati', () => {
    expect(out.getCampaign(db, campaignId).steps.map(s => s.channel)).toEqual(['email', 'linkedin', 'phone'])
    expect(() => out.enqueueDrafts(db, campaignId, 'dashboard')).toThrow(/qualificat/)
    pros.setProspectStatus(db, fr, 'qualified')
    pros.setProspectStatus(db, itId, 'qualified')
    const [job] = out.enqueueDrafts(db, campaignId, 'dashboard')
    expect(job!.kind).toBe(out.DRAFTS_JOB_KIND)
    expect(job!.prompt).toContain(`prospect ${fr}: passi 0, 1, 2`)
    expect(job!.prompt).toContain(`prospect ${itId}: passi 1, 2`)
    expect(job!.prompt).toContain('francese')
    expect(() => out.enqueueDrafts(db, campaignId, 'dashboard')).toThrow(/già bozze/)
  })

  it('le idee si sostituiscono e citano solo voci che esistono', () => {
    expect(() => out.saveIdeas(db, fr, [{ kind: 'product', title: 'Quadra', pitch: 'x', portfolioSlug: 'non-esiste' }], 1)).toThrow(/non esistono/)
    out.saveIdeas(db, fr, [{ kind: 'quick', title: 'Sito veloce', pitch: 'x' }, { kind: 'custom', title: 'Portale', pitch: 'y' }], null)
    const ideas = out.saveIdeas(db, fr, [{ kind: 'custom', title: 'Portale clienti', pitch: 'z' }], null)
    expect(out.listIdeas(db, fr).map(i => i.id)).toEqual(ideas.map(i => i.id))
  })

  it('la matrice ferma le bozze non ammesse, e una bozza da approvare si riscrive', () => {
    expect(() => out.draftMessage(db, { campaignId, prospectId: itId, step: 0, subject: 'Ciao', body: 'x' }, null)).toThrow(/consenso/)
    expect(() => out.draftMessage(db, { campaignId, prospectId: fr, step: 0, body: 'x' }, null)).toThrow(/oggetto/)
    const first = out.draftMessage(db, { campaignId, prospectId: fr, step: 0, subject: 'Votre site', body: 'Bonjour' }, null)
    const again = out.draftMessage(db, { campaignId, prospectId: fr, step: 0, subject: 'Votre site', body: 'Bonjour, version 2' }, null)
    expect(again.id).toBe(first.id)
    expect(again).toMatchObject({ channel: 'email', language: 'fr', status: 'pending', legalBasis: 'b2b_optout' })
    const note = out.draftMessage(db, { campaignId, prospectId: itId, step: 1, subject: 'ignorato', body: 'Nota' }, null)
    expect(note).toMatchObject({ channel: 'linkedin', subject: null })
    expect(out.approvalQueue(db).map(m => m.id)).toEqual([first.id, note.id])
    expect(out.approvalQueue(db)[0]!.ideas[0]!.title).toBe('Portale clienti')
  })

  it('approvato non si tocca più, e la base legale si ricontrolla', () => {
    const [email, note] = out.approvalQueue(db)
    out.editMessage(db, email!.id, { body: 'Bonjour, corrigé' })
    expect(out.decideMessage(db, email!.id, 'approve', 'dashboard').status).toBe('approved')
    expect(() => out.decideMessage(db, email!.id, 'discard', 'dashboard')).toThrow(/già stato deciso/)
    expect(() => out.editMessage(db, email!.id, { body: 'x' })).toThrow(/già stato deciso/)
    expect(() => out.draftMessage(db, { campaignId, prospectId: fr, step: 0, subject: 's', body: 'b' }, null)).toThrow(/già deciso/)

    pros.updateProspect(db, itId, { website: null, phone: null, legalBasis: 'inbound_only', notes: '' })
    expect(() => out.decideMessage(db, note!.id, 'approve', 'dashboard')).toThrow(/inbound/)
    expect(out.decideMessage(db, note!.id, 'discard', 'dashboard').status).toBe('discarded')
    expect(out.pendingCount(db)).toBe(0)
  })

  it('il bot manda le bozze nuove e applica Approva e Modifica', async () => {
    const { TelegramBot } = await import('../worker/telegram')
    const draft = out.draftMessage(db, { campaignId, prospectId: fr, step: 1, body: 'Note <LinkedIn>' }, null)
    const calls: { method: string, body: any }[] = []
    let updates: unknown[] = []
    const fetcher = (async (url: string, init?: RequestInit) => {
      const method = url.split('/').pop()!
      const body = JSON.parse(String(init?.body ?? '{}'))
      calls.push({ method, body })
      const result = method === 'getUpdates' ? updates : method === 'sendMessage' ? { message_id: 100 + calls.length } : true
      return new Response(JSON.stringify({ ok: true, result }))
    }) as unknown as typeof fetch
    const bot = new TelegramBot(db, { token: 't', chatId: '9' }, () => {}, fetcher)

    await bot.tick(new Date('2026-10-22T08:00:00Z'))
    const sent = calls.find(c => c.method === 'sendMessage')!
    expect(sent.body.text).toContain('Note &lt;LinkedIn&gt;')
    expect(out.getMessage(db, draft.id).notifiedAt).not.toBeNull()

    updates = [
      { update_id: 1, message: { message_id: 5, chat: { id: 9 }, text: 'Testo nuovo', reply_to_message: { text: editPrompt(draft.id) } } },
      { update_id: 2, callback_query: { id: 'q', data: `a:${draft.id}`, message: { message_id: 101, chat: { id: 9 } } } },
      { update_id: 3, callback_query: { id: 'r', data: `d:${draft.id}`, message: { message_id: 101, chat: { id: 666 } } } },
    ]
    await bot.pollOnce()
    const final = out.getMessage(db, draft.id)
    expect(final.body).toBe('Testo nuovo')
    expect(final.status).toBe('approved')
    expect(calls.filter(c => c.method === 'answerCallbackQuery')).toHaveLength(1)

    // La sera, una volta sola, il rapporto.
    updates = []
    const before = calls.length
    await bot.tick(new Date('2026-10-22T17:30:00Z'))
    await bot.tick(new Date('2026-10-22T17:40:00Z'))
    const reports = calls.slice(before).filter(c => c.method === 'sendMessage')
    expect(reports).toHaveLength(1)
    expect(reports[0]!.body.text).toContain('ultime 24 ore')
  })
})
