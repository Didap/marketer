import { extraAllowedHosts } from './env'

// Difese per un'app che lancia agenti e gira su localhost.
// Host: blocca il DNS rebinding (un sito esterno che punta il suo nome a 127.0.0.1).
// Scritture: solo con l'intestazione x-marketer, che un altro sito non può mandare senza preflight CORS.

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function hostName(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null
  const host = hostHeader.trim().toLowerCase()
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? null : host.slice(0, end + 1)
  }
  return host.split(':')[0] || null
}

export function isAllowedHost(hostHeader: string | undefined, extra: string[] = extraAllowedHosts()): boolean {
  const name = hostName(hostHeader)
  return !!name && (LOCAL_HOSTS.has(name) || extra.includes(name))
}

/** Un'origine, se c'è, deve essere la stessa dell'host chiamato. */
export function isSameOrigin(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (!origin) return true
  try {
    return new URL(origin).host.toLowerCase() === hostHeader?.trim().toLowerCase()
  }
  catch {
    return false
  }
}
