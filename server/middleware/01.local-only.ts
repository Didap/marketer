import { isAllowedHost, isSameOrigin } from '../lib/host'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export default defineEventHandler((event) => {
  const host = getHeader(event, 'host')
  if (!isAllowedHost(host)) {
    throw createError({ statusCode: 421, statusMessage: 'Host non ammesso' })
  }
  if (!event.path.startsWith('/api/') || SAFE_METHODS.has(event.method)) return
  if (getHeader(event, 'x-marketer') !== '1' || !isSameOrigin(getHeader(event, 'origin'), host)) {
    throw createError({ statusCode: 403, statusMessage: 'Richiesta non ammessa' })
  }
})
