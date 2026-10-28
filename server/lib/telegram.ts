import { and, eq, gte, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { audits, messages, prospects } from '../db/schema'
import { tokenGuard } from './jobs'
import type { MessageWithContext } from './outreach'
import { CHANNEL_LABEL, pendingCount } from './outreach'

// Testi e bottoni del bot Telegram. Il ciclo che parla con Telegram sta nel worker.

export type TelegramAction = 'approve' | 'edit' | 'discard'
const ACTION_CODE: Record<TelegramAction, string> = { approve: 'a', edit: 'e', discard: 'd' }

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** La bozza come la vede William sul telefono: chi, dove, perché, e il testo. */
export function draftText(m: MessageWithContext): string {
  const where = [m.prospect.city, m.prospect.country].filter(Boolean).join(', ')
  const head = [
    `<b>#${m.id} · ${escapeHtml(m.prospect.name)}</b>${where ? ` (${escapeHtml(where)})` : ''}`,
    `${CHANNEL_LABEL[m.channel]}${m.campaign ? ` · ${escapeHtml(m.campaign.name)}, giorno ${m.campaign.day}` : ''} · firma ${escapeHtml(m.identityName)}`,
  ]
  if (m.issues[0]) head.push(`Aggancio: ${escapeHtml(m.issues[0].text)}`)
  const body = m.body.length > 3000 ? `${m.body.slice(0, 3000)}…` : m.body
  return [...head, '', m.subject ? `<b>${escapeHtml(m.subject)}</b>\n` : '', escapeHtml(body)].filter((l, i) => l !== '' || i === head.length).join('\n')
}

export function draftKeyboard(id: number) {
  return {
    inline_keyboard: [[
      { text: 'Approva', callback_data: `${ACTION_CODE.approve}:${id}` },
      { text: 'Modifica', callback_data: `${ACTION_CODE.edit}:${id}` },
      { text: 'Scarta', callback_data: `${ACTION_CODE.discard}:${id}` },
    ]],
  }
}

export function parseCallback(data: string | undefined): { action: TelegramAction, id: number } | null {
  const match = data?.match(/^([aed]):(\d+)$/)
  if (!match) return null
  const action = (Object.keys(ACTION_CODE) as TelegramAction[]).find(a => ACTION_CODE[a] === match[1])!
  return { action, id: Number(match[2]) }
}

export function editPrompt(id: number): string {
  return `Scrivi il testo nuovo del messaggio #${id} rispondendo a questo. L'oggetto delle email si cambia dalla dashboard.`
}

/** Il messaggio a cui William risponde con il testo nuovo: l'id sta nella richiesta del bot. */
export function parseEditReply(promptText: string | undefined): number | null {
  const match = promptText?.match(/^Scrivi il testo nuovo del messaggio #(\d+)/)
  return match ? Number(match[1]) : null
}

/** Il rapporto della sera: cosa è successo nelle ultime 24 ore. */
export function dailyReport(db: Db, now: Date = new Date()): string {
  const since = new Date(now.getTime() - 24 * 3600_000)
  const count = (rows: { n: number } | undefined) => rows?.n ?? 0
  const newProspects = count(db.select({ n: sql<number>`count(*)` }).from(prospects).where(gte(prospects.createdAt, since)).get())
  const doneAudits = count(db.select({ n: sql<number>`count(*)` }).from(audits).where(and(eq(audits.status, 'done'), gte(audits.finishedAt, since))).get())
  const drafted = count(db.select({ n: sql<number>`count(*)` }).from(messages).where(gte(messages.createdAt, since)).get())
  const decided = db.select({ status: messages.status, n: sql<number>`count(*)` }).from(messages)
    .where(gte(messages.decidedAt, since)).groupBy(messages.status).all()
  const approved = decided.find(d => d.status === 'approved')?.n ?? 0
  const discarded = decided.find(d => d.status === 'discarded')?.n ?? 0
  const guard = tokenGuard(db, now)
  const pct = guard.cap ? Math.round((guard.used / guard.cap) * 100) : 100
  return [
    '<b>Marketer, ultime 24 ore</b>',
    `Prospect nuovi: ${newProspects} · audit fatti: ${doneAudits}`,
    `Bozze scritte: ${drafted} · approvate: ${approved} · scartate: ${discarded}`,
    `Da approvare adesso: ${pendingCount(db)}`,
    `Token di oggi: ${guard.used.toLocaleString('it-IT')} di ${guard.cap.toLocaleString('it-IT')} (${pct}%)`,
  ].join('\n')
}
