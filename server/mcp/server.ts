import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ZodError } from 'zod'
import { JobError } from '../lib/jobs'
import { PortfolioError } from '../lib/portfolio'
import { OutreachError } from '../lib/outreach'
import { ProspectError } from '../lib/prospects'
import { StrategyError } from '../lib/strategies'
import type { McpToolContext } from './tools'
import { MCP_TOOLS, McpToolError } from './tools'

// Il server MCP sull'SDK ufficiale: senza sessioni, uno nuovo per ogni richiesta.
// L'SDK gestisce il protocollo; qui si adattano i tool di Marketer.

function textResult(value: unknown): CallToolResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const content: CallToolResult['content'] = [{ type: 'text', text }]
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? { content, structuredContent: JSON.parse(text) as Record<string, unknown> }
    : { content }
}

/** Errori previsti in chiaro, per il resto solo un codice: niente stack trace all'agente. */
function errorResult(err: unknown): CallToolResult {
  let text = 'INTERNAL'
  if (err instanceof JobError || err instanceof PortfolioError || err instanceof ProspectError || err instanceof OutreachError || err instanceof StrategyError) text = `${err.code}: ${err.message}`
  else if (err instanceof McpToolError) text = err.message
  else if (err instanceof ZodError) text = `INVALID_INPUT: ${err.issues.map(i => `${i.path.join('.')} ${i.message}`).join('; ')}`
  else console.error('[mcp] errore nel tool', err)
  return { content: [{ type: 'text', text }], isError: true }
}

export function buildMcpServer(ctx: McpToolContext): McpServer {
  const server = new McpServer({ name: 'marketer', title: 'Marketer', version: '0.1.0' })
  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: unknown) => {
        try {
          return textResult(await tool.handler(ctx, args))
        }
        catch (err) {
          return errorResult(err)
        }
      },
    )
  }
  return server
}
