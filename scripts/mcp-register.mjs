// Registra Marketer in Claude Code (scope utente), così `claude mcp list` mostra marketer.
import { execFileSync } from 'node:child_process'

const url = `${(process.env.MARKETER_URL || 'http://127.0.0.1:4310').replace(/\/$/, '')}/mcp`
const token = process.env.MARKETER_MCP_TOKEN
if (!token) {
  console.error('MARKETER_MCP_TOKEN manca: lancia prima pnpm setup')
  process.exit(1)
}

try {
  execFileSync('claude', ['mcp', 'remove', 'marketer', '--scope', 'user'], { stdio: 'ignore' })
}
catch {}
execFileSync('claude', ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'marketer', url, '--header', `Authorization: Bearer ${token}`], { stdio: 'ignore' })
console.log(`marketer registrato in Claude Code: ${url}`)
