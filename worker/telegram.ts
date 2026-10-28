import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Db } from '../server/db/client'
import { messages } from '../server/db/schema'
import type { Fetcher } from '../server/lib/sources'
import { decideMessage, editMessage, getMessage, messageContext, OutreachError } from '../server/lib/outreach'
import { readSetting, writeSetting } from '../server/lib/settings'
import { dailyReport, draftKeyboard, draftText, editPrompt, parseCallback, parseEditReply } from '../server/lib/telegram'
import { romeDay } from '../server/lib/tokens'

// Il bot Telegram di William, in long polling: nessun webhook, il Mac non si espone.
// Manda ogni bozza nuova con Approva, Modifica, Scarta e la sera il rapporto del giorno.

const POLL_TIMEOUT_S = 25
/** Bozze mandate per giro: se se ne accumulano tante, arrivano un po' alla volta. */
const NOTIFY_PER_TICK = 3
const REPORT_HOUR = 19

interface Update {
  update_id: number
  message?: { message_id: number, chat: { id: number }, text?: string, reply_to_message?: { text?: string } }
  callback_query?: { id: string, data?: string, message?: { message_id: number, chat: { id: number }, text?: string } }
}

function romeHour(at: Date): number {
  return Number(new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(at))
}

export class TelegramBot {
  private running = false
  private notifying = false

  constructor(
    private readonly db: Db,
    private readonly config: { token: string, chatId: string },
    private readonly log: (message: string) => void,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async call<T = any>(method: string, body: object, timeoutMs = 15_000): Promise<T> {
    const res = await this.fetcher(`https://api.telegram.org/bot${this.config.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data = await res.json() as { ok: boolean, result?: T, description?: string }
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description ?? res.status}`)
    return data.result as T
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  stop(): void {
    this.running = false
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce()
      }
      catch (err) {
        this.log(`telegram: ${err instanceof Error ? err.message : String(err)}`)
        await new Promise(r => setTimeout(r, 10_000))
      }
    }
  }

  async pollOnce(): Promise<void> {
    const offset = Number(readSetting(this.db, 'telegramOffset') ?? 0)
    const updates = await this.call<Update[]>('getUpdates', { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message', 'callback_query'] }, (POLL_TIMEOUT_S + 10) * 1000)
    for (const update of updates) {
      writeSetting(this.db, 'telegramOffset', update.update_id + 1)
      try {
        if (update.callback_query) await this.onCallback(update.callback_query)
        else if (update.message) await this.onMessage(update.message)
      }
      catch (err) {
        this.log(`telegram, aggiornamento ${update.update_id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  /** Solo la chat di William: tutto il resto si ignora. */
  private mine(chatId: number | undefined): boolean {
    return String(chatId) === this.config.chatId
  }

  private async sendDraft(id: number): Promise<void> {
    const ctx = messageContext(this.db, getMessage(this.db, id))
    const sent = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: this.config.chatId,
      text: draftText(ctx),
      parse_mode: 'HTML',
      reply_markup: draftKeyboard(id),
      link_preview_options: { is_disabled: true },
    })
    this.db.update(messages).set({ telegramMessageId: sent.message_id, notifiedAt: new Date() }).where(eq(messages.id, id)).run()
  }

  private async onCallback(cq: NonNullable<Update['callback_query']>): Promise<void> {
    if (!this.mine(cq.message?.chat.id)) return
    const parsed = parseCallback(cq.data)
    if (!parsed) return this.call('answerCallbackQuery', { callback_query_id: cq.id })
    if (parsed.action === 'edit') {
      await this.call('sendMessage', { chat_id: this.config.chatId, text: editPrompt(parsed.id), reply_markup: { force_reply: true } })
      return this.call('answerCallbackQuery', { callback_query_id: cq.id })
    }
    let outcome: string
    try {
      decideMessage(this.db, parsed.id, parsed.action, 'telegram')
      outcome = parsed.action === 'approve' ? 'Approvato' : 'Scartato'
    }
    catch (err) {
      if (!(err instanceof OutreachError)) throw err
      return this.call('answerCallbackQuery', { callback_query_id: cq.id, text: err.message, show_alert: true })
    }
    await this.call('answerCallbackQuery', { callback_query_id: cq.id, text: outcome })
    if (cq.message) {
      await this.call('editMessageReplyMarkup', { chat_id: this.config.chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [[{ text: outcome, callback_data: 'x' }]] } })
    }
  }

  private async onMessage(msg: NonNullable<Update['message']>): Promise<void> {
    if (!this.mine(msg.chat.id) || !msg.text) return
    const editing = parseEditReply(msg.reply_to_message?.text)
    if (editing !== null) {
      try {
        editMessage(this.db, editing, { body: msg.text })
      }
      catch (err) {
        if (!(err instanceof OutreachError)) throw err
        await this.call('sendMessage', { chat_id: this.config.chatId, text: err.message })
        return
      }
      await this.sendDraft(editing)
      return
    }
    // Qualunque altro messaggio: il punto della situazione.
    await this.call('sendMessage', { chat_id: this.config.chatId, text: dailyReport(this.db), parse_mode: 'HTML' })
  }

  /** Bozze nuove da far vedere sul telefono, poche per giro; e il rapporto la sera. Lo chiama il giro del worker. */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.notifying) return
    this.notifying = true
    try {
      const fresh = this.db.select({ id: messages.id }).from(messages)
        .where(and(eq(messages.status, 'pending'), isNull(messages.notifiedAt)))
        .orderBy(asc(messages.id)).limit(NOTIFY_PER_TICK).all()
      for (const { id } of fresh) await this.sendDraft(id)

      const today = romeDay(now)
      if (romeHour(now) >= REPORT_HOUR && readSetting(this.db, 'telegramReportDay') !== today) {
        writeSetting(this.db, 'telegramReportDay', today)
        await this.call('sendMessage', { chat_id: this.config.chatId, text: dailyReport(this.db, now), parse_mode: 'HTML' })
      }
    }
    catch (err) {
      this.log(`telegram: ${err instanceof Error ? err.message : String(err)}`)
    }
    finally {
      this.notifying = false
    }
  }
}
