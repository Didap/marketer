import type { JobEventKind } from '../server/db/schema'
import type { Usage } from '../server/lib/tokens'
import { EMPTY_USAGE, addUsage, weigh } from '../server/lib/tokens'

// Traduce una riga di `claude -p --output-format stream-json` negli eventi del log del job.
// Funzione pura: il runner decide cosa salvare e quando fermare il job.

export interface ParsedEvent {
  kind: JobEventKind
  summary: string
}

export interface ParsedResult {
  ok: boolean
  subtype: string
  text: string
  numTurns: number | null
  durationMs: number | null
  costUsd: number
  usage: Usage
}

export interface ParsedLine {
  events: ParsedEvent[]
  init?: { sessionId: string | null, model: string | null }
  /** Usage di un messaggio dell'assistente: arriva ripetuto per ogni blocco, si conta per id. */
  usage?: { messageId: string, usage: Usage }
  result?: ParsedResult
}

type Json = Record<string, any>

const MAX_TEXT = 4000

export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function parseStreamLine(line: string): ParsedLine {
  let msg: Json
  try {
    msg = JSON.parse(line)
  }
  catch {
    return { events: [{ kind: 'other', summary: clip(line, MAX_TEXT) }] }
  }
  if (!msg || typeof msg !== 'object') return { events: [] }

  switch (msg.type) {
    case 'system':
      return parseSystem(msg)
    case 'assistant':
      return parseAssistant(msg)
    case 'user':
      return parseUser(msg)
    case 'result':
      return parseResult(msg)
    default:
      return { events: [] }
  }
}

function parseSystem(msg: Json): ParsedLine {
  if (msg.subtype !== 'init') {
    return { events: [{ kind: 'system', summary: `Evento di sistema: ${msg.subtype ?? 'sconosciuto'}` }] }
  }
  const servers = Array.isArray(msg.mcp_servers)
    ? msg.mcp_servers.map((s: Json) => `${s.name} ${s.status === 'connected' ? 'collegato' : `non collegato (${s.status})`}`)
    : []
  const tools = Array.isArray(msg.tools) ? msg.tools.length : 0
  const parts = [`Sessione avviata con ${msg.model ?? 'modello sconosciuto'}`, `${tools} tool`]
  if (servers.length) parts.push(`MCP: ${servers.join(', ')}`)
  if (msg.permissionMode) parts.push(`permessi: ${msg.permissionMode}`)
  return {
    events: [{ kind: 'system', summary: parts.join(' · ') }],
    init: { sessionId: msg.session_id ?? null, model: msg.model ?? null },
  }
}

function parseAssistant(msg: Json): ParsedLine {
  const message = msg.message ?? {}
  const sub = msg.parent_tool_use_id ? '[subagente] ' : ''
  const events: ParsedEvent[] = []
  for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      events.push({ kind: 'text', summary: sub + clip(block.text.trim(), MAX_TEXT) })
    }
    else if (block?.type === 'tool_use') {
      events.push({ kind: 'tool_use', summary: `${sub}${block.name}${describeToolInput(block.name, block.input)}` })
    }
  }
  const parsed: ParsedLine = { events }
  if (typeof message.id === 'string' && message.usage) {
    parsed.usage = { messageId: message.id, usage: apiUsage(message.usage) }
  }
  return parsed
}

function parseUser(msg: Json): ParsedLine {
  const content = msg.message?.content
  const events: ParsedEvent[] = []
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type !== 'tool_result') continue
    const text = toolResultText(block.content)
    events.push({
      kind: 'tool_result',
      summary: block.is_error
        ? `Errore del tool: ${clip(text.trim() || 'senza dettagli', 300)}`
        : `Risultato: ${text.length.toLocaleString('it-IT')} caratteri`,
    })
  }
  return { events }
}

function parseResult(msg: Json): ParsedLine {
  const usage = msg.modelUsage && typeof msg.modelUsage === 'object' && Object.keys(msg.modelUsage).length
    ? Object.values(msg.modelUsage as Record<string, Json>).reduce<Usage>((acc, m) => addUsage(acc, {
        input: num(m.inputTokens),
        output: num(m.outputTokens),
        cacheWrite: num(m.cacheCreationInputTokens),
        cacheRead: num(m.cacheReadInputTokens),
      }), EMPTY_USAGE)
    : apiUsage(msg.usage ?? {})
  const result: ParsedResult = {
    ok: msg.subtype === 'success' && !msg.is_error,
    subtype: String(msg.subtype ?? 'sconosciuto'),
    text: typeof msg.result === 'string' ? msg.result : '',
    numTurns: typeof msg.num_turns === 'number' ? msg.num_turns : null,
    durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : null,
    costUsd: num(msg.total_cost_usd),
    usage,
  }
  const minutes = result.durationMs === null ? null : (result.durationMs / 60_000).toLocaleString('it-IT', { maximumFractionDigits: 1 })
  const summary = [
    result.ok ? 'Fine' : `Fine con errore (${result.subtype})`,
    result.numTurns === null ? null : `${result.numTurns} turni`,
    minutes === null ? null : `${minutes} min`,
    `${weigh(usage).toLocaleString('it-IT')} token pesati`,
    `${result.costUsd.toLocaleString('it-IT', { maximumFractionDigits: 2 })} $ di listino`,
  ].filter(Boolean).join(' · ')
  return { events: [{ kind: 'result', summary }], result }
}

function apiUsage(u: Json): Usage {
  return {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheWrite: num(u.cache_creation_input_tokens),
    cacheRead: num(u.cache_read_input_tokens),
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

const INPUT_KEYS = ['file_path', 'path', 'pattern', 'command', 'url', 'query', 'description', 'prompt']

function describeToolInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return ''
  const obj = input as Json
  if (!String(name).startsWith('mcp__')) {
    const key = INPUT_KEYS.find(k => typeof obj[k] === 'string')
    if (key) return ` ${clip(obj[key].replace(/\s+/g, ' '), 200)}`
  }
  const json = JSON.stringify(obj)
  return json === '{}' ? '' : ` ${clip(json, 200)}`
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(c => (c && typeof c === 'object' && typeof c.text === 'string' ? c.text : '')).join('\n')
  }
  return ''
}
