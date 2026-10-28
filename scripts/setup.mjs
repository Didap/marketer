// Prepara .env e la cartella data. Non tocca un .env che esiste già.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('data/logs', { recursive: true })

if (existsSync('.env')) {
  console.log('.env c\'è già: lasciato com\'è')
}
else {
  const env = [
    '# Indirizzo dell\'app sotto launchd: lo usano i job e la registrazione MCP.',
    'MARKETER_URL=http://127.0.0.1:4310',
    '# Token di /mcp. Se lo cambi, rilancia pnpm mcp:register.',
    `MARKETER_MCP_TOKEN=${randomBytes(32).toString('hex')}`,
    '# Nomi host ammessi oltre a localhost, separati da virgola (per esempio il nome Tailscale).',
    'MARKETER_ALLOWED_HOSTS=',
    '# Fonti dei prospect a pagamento: senza chiave restano spente.',
    'GOOGLE_PLACES_API_KEY=',
    'OPENAPI_COMPANY_TOKEN=',
    '# Bot Telegram per le approvazioni dal telefono: token di BotFather e id della tua chat.',
    'TELEGRAM_BOT_TOKEN=',
    'TELEGRAM_CHAT_ID=',
    '',
  ].join('\n')
  writeFileSync('.env', env, { mode: 0o600 })
  console.log('.env creato con un token MCP nuovo')
}
