import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { PortfolioSourceKind } from '../db/schema'

// Le fonti del portfolio sul disco: i repo nella cartella dei repo e le schede del sito didap.
// Solo file system, niente database: chi le usa ci aggiunge lo stato dell'import.

export interface DiscoveredSource {
  /** Cartella del repo o file della scheda: è la chiave della fonte. */
  path: string
  kind: PortfolioSourceKind
  name: string
  /** File da leggere, dal più importante. */
  files: string[]
  /** Impronta del contenuto dei file: se cambia, la fonte va riletta. */
  fingerprint: string
  modifiedAt: Date
  /** Tiene nello stesso lotto le fonti della stessa cosa (CityFix dal sito e dal repo). */
  group: string
}

const DOC_FILES = ['PRODUCT.md', 'README.md']
// Senza documenti, CLAUDE.md e package.json dicono almeno cos'è e con cosa è fatto.
const FALLBACK_FILES = ['CLAUDE.md', 'package.json']
// Prodotti e partner, solo in italiano: le versioni inglesi sono traduzioni.
const SITE_SECTIONS = ['work', 'clients']

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  }
  catch {
    return false
  }
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir).sort((a, b) => a.localeCompare(b))
  }
  catch {
    return []
  }
}

export function groupKey(name: string): string {
  return name.toLowerCase().replace(/\.md$/, '').replace(/[^a-z0-9]/g, '')
}

function fingerprintOf(files: string[]): { fingerprint: string, modifiedAt: Date } {
  const hash = createHash('sha1')
  let latest = 0
  for (const file of files) {
    hash.update(`${basename(file)}\n`).update(readFileSync(file)).update('\n')
    latest = Math.max(latest, statSync(file).mtimeMs)
  }
  return { fingerprint: hash.digest('hex').slice(0, 16), modifiedAt: new Date(latest) }
}

function repoSource(dir: string): DiscoveredSource | null {
  // Un worktree (.git è un file) è una copia di lavoro di un altro repo: vale quello.
  if (isFile(join(dir, '.git'))) return null
  const docs = DOC_FILES.map(f => join(dir, f)).filter(isFile)
  const files = docs.length ? docs : FALLBACK_FILES.map(f => join(dir, f)).filter(isFile)
  if (!files.length) return null
  const name = basename(dir)
  return { path: dir, kind: 'repo', name, files, ...fingerprintOf(files), group: groupKey(name) }
}

function siteTitle(file: string): string | null {
  const head = readFileSync(file, 'utf8').slice(0, 2000)
  return /^title:\s*(.+)$/m.exec(head)?.[1]?.trim().replace(/^["']|["']$/g, '') || null
}

function siteSources(siteDir: string): DiscoveredSource[] {
  return SITE_SECTIONS.flatMap((section) => {
    const dir = join(siteDir, 'content', section, 'it')
    return listDir(dir)
      .filter(name => name.endsWith('.md'))
      .map(name => join(dir, name))
      .filter(isFile)
      .map(file => ({
        path: file,
        kind: 'site' as const,
        name: siteTitle(file) ?? basename(file, '.md'),
        files: [file],
        ...fingerprintOf([file]),
        group: groupKey(basename(file)),
      }))
  })
}

export interface DiscoverOptions {
  reposDir: string
  siteDir: string
  /** Cartelle da non trattare come repo (il sito, Marketer stesso). */
  exclude?: string[]
}

/** Tutte le fonti, ordinate in modo che le fonti della stessa cosa stiano vicine. */
export function discoverSources(opts: DiscoverOptions): DiscoveredSource[] {
  const exclude = new Set([opts.siteDir, ...(opts.exclude ?? [])].map(p => resolve(p)))
  const repos = listDir(opts.reposDir)
    .filter(name => !name.startsWith('.') && name !== 'node_modules')
    .map(name => resolve(opts.reposDir, name))
    .filter(dir => !exclude.has(dir))
    .filter((dir) => {
      try {
        return statSync(dir).isDirectory()
      }
      catch {
        return false
      }
    })
    .map(repoSource)
    .filter(s => s !== null)
  const site = siteSources(opts.siteDir)
  return [...site, ...repos].sort((a, b) => a.group.localeCompare(b.group) || a.kind.localeCompare(b.kind))
}

/** La fonte a cui appartiene un percorso: la fonte stessa o un file dentro un repo. */
export function matchSource<T extends Pick<DiscoveredSource, 'path' | 'kind'>>(sources: T[], path: string): T | undefined {
  const p = resolve(path)
  return sources.find(s => s.path === p) ?? sources.find(s => s.kind === 'repo' && p.startsWith(`${s.path}/`))
}

/** Lotti di al massimo `size` fonti, senza dividere le fonti della stessa cosa. */
export function splitIntoLots<T extends Pick<DiscoveredSource, 'group'>>(sources: T[], size: number): T[][] {
  const groups = new Map<string, T[]>()
  for (const s of sources) groups.set(s.group, [...(groups.get(s.group) ?? []), s])
  const lots: T[][] = []
  let current: T[] = []
  for (const group of groups.values()) {
    if (current.length && current.length + group.length > size) {
      lots.push(current)
      current = []
    }
    current.push(...group)
  }
  if (current.length) lots.push(current)
  return lots
}
