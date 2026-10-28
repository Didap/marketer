import { timingSafeEqual } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { mcpToken } from '../lib/env'
import { buildMcpServer } from '../mcp/server'

// /mcp su HTTP streamable, senza sessioni, solo con il token di .env.
// I job del runner aggiungono X-Marketer-Job, così i tool sanno da quale job arriva la chiamata.

function tokenMatches(header: string | undefined): boolean {
  const expected = mcpToken()
  const given = header?.startsWith('Bearer ') ? header.slice(7) : ''
  if (!expected || given.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    setResponseHeader(event, 'Allow', 'POST')
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }
  if (!tokenMatches(getHeader(event, 'authorization'))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const jobHeader = Number(getHeader(event, 'x-marketer-job'))
  const server = buildMcpServer({ jobId: Number.isInteger(jobHeader) && jobHeader > 0 ? jobHeader : null })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  event.node.res.on('close', () => {
    transport.close().catch(() => {})
    server.close().catch(() => {})
  })

  const body = await readBody(event)
  await server.connect(transport)
  await transport.handleRequest(event.node.req, event.node.res, body)
})
