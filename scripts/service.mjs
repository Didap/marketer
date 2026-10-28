// Servizi launchd di Marketer: l'app (dashboard, API, /mcp) e il worker.
// Uso: pnpm service install | uninstall | restart | status
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const AGENTS = join(homedir(), 'Library', 'LaunchAgents')
const LOGS = join(ROOT, 'data', 'logs')
const DOMAIN = `gui/${userInfo().uid}`

/** Il Node di .nvmrc, se c'è in nvm: il servizio non deve dipendere dalla shell da cui lo installi. */
function nodeBin() {
  const wanted = existsSync(join(ROOT, '.nvmrc')) ? readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim().replace(/^v/, '') : ''
  const candidate = join(homedir(), '.nvm', 'versions', 'node', `v${wanted}`, 'bin', 'node')
  return wanted && existsSync(candidate) ? candidate : process.execPath
}

function envFile() {
  const env = {}
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2]
  }
  return env
}

function services() {
  const node = nodeBin()
  const port = new URL(envFile().MARKETER_URL || 'http://127.0.0.1:4310').port || '4310'
  const path = [dirname(node), join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':')
  return [
    {
      label: 'it.didap.marketer.web',
      args: [node, `--env-file=${join(ROOT, '.env')}`, join(ROOT, '.output', 'server', 'index.mjs')],
      env: { PATH: path, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: port },
      log: join(LOGS, 'web.log'),
    },
    {
      label: 'it.didap.marketer.worker',
      args: [node, `--env-file=${join(ROOT, '.env')}`, '--import', 'tsx', join(ROOT, 'worker', 'index.ts')],
      env: { PATH: path, NODE_ENV: 'production' },
      log: join(LOGS, 'worker.log'),
    },
  ]
}

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function plist(svc) {
  const args = svc.args.map(a => `    <string>${xml(a)}</string>`).join('\n')
  const env = Object.entries(svc.env).map(([k, v]) => `    <key>${k}</key><string>${xml(v)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${svc.label}</string>
  <key>ProgramArguments</key><array>
${args}
  </array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>EnvironmentVariables</key><dict>
${env}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(svc.log)}</string>
  <key>StandardErrorPath</key><string>${xml(svc.log)}</string>
</dict></plist>
`
}

function launchctl(...args) {
  try {
    return execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  }
  catch {
    return null
  }
}

function status() {
  for (const svc of services()) {
    const out = launchctl('print', `${DOMAIN}/${svc.label}`)
    if (out === null) {
      console.log(`${svc.label}: non installato`)
      continue
    }
    const state = out.match(/^\s*state = (.+)$/m)?.[1] ?? '?'
    const pid = out.match(/^\s*pid = (\d+)$/m)?.[1]
    const exit = out.match(/^\s*last exit code = (.+)$/m)?.[1]
    console.log(`${svc.label}: ${state}${pid ? ` (pid ${pid})` : ''}${exit && !pid ? `, ultima uscita ${exit}` : ''}`)
  }
}

const command = process.argv[2]
switch (command) {
  case 'install': {
    if (!existsSync(join(ROOT, '.env'))) {
      console.error('.env manca: lancia prima pnpm setup')
      process.exit(1)
    }
    if (!existsSync(join(ROOT, '.output', 'server', 'index.mjs'))) {
      console.error('Build mancante: lancia prima pnpm build')
      process.exit(1)
    }
    mkdirSync(LOGS, { recursive: true })
    for (const svc of services()) {
      const file = join(AGENTS, `${svc.label}.plist`)
      launchctl('bootout', `${DOMAIN}/${svc.label}`)
      writeFileSync(file, plist(svc))
      if (launchctl('bootstrap', DOMAIN, file) === null) {
        console.error(`${svc.label}: bootstrap fallito`)
        process.exit(1)
      }
    }
    status()
    break
  }
  case 'uninstall':
    for (const svc of services()) {
      launchctl('bootout', `${DOMAIN}/${svc.label}`)
      rmSync(join(AGENTS, `${svc.label}.plist`), { force: true })
    }
    status()
    break
  case 'restart':
    for (const svc of services()) launchctl('kickstart', '-k', `${DOMAIN}/${svc.label}`)
    status()
    break
  case 'status':
    status()
    break
  default:
    console.error('Uso: pnpm service install | uninstall | restart | status')
    process.exit(1)
}
