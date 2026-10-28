import { homedir } from 'node:os'
import { resolve } from 'node:path'

// Configurazione comune a app e worker. Arriva da .env (vedi scripts/setup.mjs).

export function dataDir(): string {
  return process.env.MARKETER_DATA_DIR || resolve(process.cwd(), 'data')
}

/** Indirizzo dell'app che serve /mcp, usato dai job e dalla registrazione in Claude Code. */
export function appUrl(): string {
  return (process.env.MARKETER_URL || 'http://127.0.0.1:4310').replace(/\/$/, '')
}

export function mcpToken(): string {
  return process.env.MARKETER_MCP_TOKEN ?? ''
}

export function claudeBin(): string {
  return process.env.MARKETER_CLAUDE_BIN || 'claude'
}

/** Nomi host accettati oltre a localhost (per esempio il nome Tailscale del Mac). */
export function extraAllowedHosts(): string[] {
  return (process.env.MARKETER_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean)
}

/** Cartella dei repo da cui si ricava il portfolio. */
export function reposDir(): string {
  return process.env.MARKETER_REPOS_DIR || homedir()
}

/** Repo del sito didap: le schede di prodotti e partner stanno in content/. */
export function siteDir(): string {
  return process.env.MARKETER_SITE_DIR || resolve(homedir(), 'didap')
}

/** Chiave Google Cloud per Places API (New). Senza, la fonte Google Maps resta spenta. */
export function placesKey(): string {
  return process.env.GOOGLE_PLACES_API_KEY ?? ''
}

/** Token di OpenAPI.it per il Registro Imprese (company.openapi.com). Senza, la fonte resta spenta. */
export function openapiToken(): string {
  return process.env.OPENAPI_COMPANY_TOKEN ?? ''
}

/** Chrome per gli audit Lighthouse: quello installato sul Mac, salvo indicazione diversa. */
export function chromePath(): string | undefined {
  return process.env.MARKETER_CHROME_PATH || undefined
}

/** Bot Telegram per le approvazioni dal telefono: token di BotFather e la chat di William. */
export function telegramConfig(): { token: string, chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? ''
  const chatId = process.env.TELEGRAM_CHAT_ID ?? ''
  return token && chatId ? { token, chatId } : null
}
