import { describe, expect, it } from 'vitest'
import { parseStreamLine } from '../worker/stream'

describe('parseStreamLine', () => {
  it('legge init con modello, sessione e server MCP', () => {
    const p = parseStreamLine(JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      model: 'claude-opus-5-5',
      tools: ['Read', 'Grep'],
      mcp_servers: [{ name: 'marketer', status: 'connected' }],
      permissionMode: 'dontAsk',
    }))
    expect(p.init).toEqual({ sessionId: 's1', model: 'claude-opus-5-5' })
    expect(p.events[0]!.summary).toContain('marketer collegato')
    expect(p.events[0]!.summary).toContain('2 tool')
  })

  it('separa testo e chiamate ai tool, con la usage del messaggio', () => {
    const p = parseStreamLine(JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        id: 'msg_1',
        content: [
          { type: 'text', text: 'Leggo il README.' },
          { type: 'tool_use', name: 'Read', input: { file_path: '/Users/w/Quadra/README.md' } },
          { type: 'tool_use', name: 'mcp__marketer__activity_log', input: { text: 'fatto' } },
        ],
        usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 },
      },
    }))
    expect(p.events.map(e => e.kind)).toEqual(['text', 'tool_use', 'tool_use'])
    expect(p.events[1]!.summary).toBe('Read /Users/w/Quadra/README.md')
    expect(p.events[2]!.summary).toBe('mcp__marketer__activity_log {"text":"fatto"}')
    expect(p.usage).toEqual({ messageId: 'msg_1', usage: { input: 10, output: 20, cacheWrite: 100, cacheRead: 1000 } })
  })

  it('riassume i risultati dei tool senza riportarli interi', () => {
    const p = parseStreamLine(JSON.stringify({
      type: 'user',
      message: { content: [
        { type: 'tool_result', content: 'x'.repeat(15000) },
        { type: 'tool_result', is_error: true, content: [{ type: 'text', text: 'permesso negato' }] },
      ] },
    }))
    expect(p.events[0]!.summary).toBe('Risultato: 15.000 caratteri')
    expect(p.events[1]!.summary).toBe('Errore del tool: permesso negato')
  })

  it('somma la usage di tutti i modelli nel risultato', () => {
    const p = parseStreamLine(JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Tutto fatto.',
      num_turns: 3,
      duration_ms: 90_000,
      total_cost_usd: 0.42,
      usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: {
        'claude-opus-5-5': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1000, cacheCreationInputTokens: 200 },
        'claude-haiku-5-5': { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      },
    }))
    expect(p.result).toMatchObject({ ok: true, text: 'Tutto fatto.', numTurns: 3, costUsd: 0.42 })
    expect(p.result!.usage).toEqual({ input: 110, output: 55, cacheWrite: 200, cacheRead: 1000 })
    expect(p.events[0]!.summary).toContain('3 turni')
  })

  it('segna come errore un risultato non riuscito', () => {
    const p = parseStreamLine(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true }))
    expect(p.result!.ok).toBe(false)
    expect(p.events[0]!.summary).toContain('error_max_turns')
  })

  it('tiene le righe che non sono JSON', () => {
    expect(parseStreamLine('non json').events).toEqual([{ kind: 'other', summary: 'non json' }])
  })
})
