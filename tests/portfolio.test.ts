import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import { discoverSources, splitIntoLots } from '../server/lib/portfolio-sources'

const root = mkdtempSync(join(tmpdir(), 'marketer-portfolio-'))
const repos = join(root, 'repos')
const site = join(repos, 'didap')

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

beforeAll(() => {
  write(join(repos, 'Quadra', 'README.md'), '# Quadra')
  write(join(repos, 'Quadra', 'PRODUCT.md'), '# Quadra, il prodotto')
  mkdirSync(join(repos, 'Quadra', '.git'))
  write(join(repos, 'quadra-wt', '.git'), 'gitdir: ../Quadra/.git/worktrees/x')
  write(join(repos, 'quadra-wt', 'README.md'), '# Quadra in un worktree')
  write(join(repos, 'Bin or Deal', 'package.json'), '{"name":"bin-or-deal"}')
  mkdirSync(join(repos, 'Vuota'))
  write(join(repos, 'node_modules', 'README.md'), 'no')
  write(join(site, 'package.json'), '{}')
  write(join(site, 'content', 'work', 'it', 'bin-or-deal.md'), '---\ntitle: Bin or Deal\n---\nTesto')
  write(join(site, 'content', 'clients', 'it', 'sudel.md'), '---\ntitle: "Sudel"\n---\nTesto')
  write(join(site, 'content', 'clients', 'en', 'sudel.md'), '---\ntitle: Sudel\n---\nText')

  process.env.MARKETER_DATA_DIR = join(root, 'data')
  process.env.MARKETER_REPOS_DIR = repos
  process.env.MARKETER_SITE_DIR = site
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('discoverSources', () => {
  it('trova repo e schede del sito, salta worktree, cartelle vuote e il sito come repo', () => {
    const sources = discoverSources({ reposDir: repos, siteDir: site })
    expect(sources.map(s => `${s.kind}:${s.name}`)).toEqual([
      'repo:Bin or Deal',
      'site:Bin or Deal',
      'repo:Quadra',
      'site:Sudel',
    ])
    const quadra = sources.find(s => s.name === 'Quadra')!
    expect(quadra.files.map(f => f.slice(quadra.path.length + 1))).toEqual(['PRODUCT.md', 'README.md'])
    expect(sources.find(s => s.kind === 'repo' && s.name === 'Bin or Deal')!.files).toHaveLength(1)
  })

  it('cambia impronta solo se cambia il contenuto', () => {
    const before = discoverSources({ reposDir: repos, siteDir: site }).find(s => s.name === 'Quadra')!.fingerprint
    write(join(repos, 'Quadra', 'README.md'), '# Quadra')
    expect(discoverSources({ reposDir: repos, siteDir: site }).find(s => s.name === 'Quadra')!.fingerprint).toBe(before)
    write(join(repos, 'Quadra', 'README.md'), '# Quadra, aggiornato')
    expect(discoverSources({ reposDir: repos, siteDir: site }).find(s => s.name === 'Quadra')!.fingerprint).not.toBe(before)
  })
})

describe('splitIntoLots', () => {
  it('non divide le fonti della stessa cosa', () => {
    const lots = splitIntoLots(['a', 'b', 'b', 'c', 'd'].map(group => ({ group })), 2)
    expect(lots.map(l => l.map(s => s.group).join(''))).toEqual(['a', 'bb', 'cd'])
  })
})

describe('portfolio nel database', () => {
  let db: Db
  let lib: typeof import('../server/lib/portfolio')

  const quadra = {
    slug: 'quadra',
    kind: 'product' as const,
    name: 'Quadra',
    summary: 'Gestionale per studi di consulenza del lavoro',
    sectors: ['Consulenza del lavoro'],
  }

  beforeAll(async () => {
    const client = await import('../server/db/client')
    db = client.useDb()
    migrate(db, { migrationsFolder: resolve('drizzle') })
    lib = await import('../server/lib/portfolio')
  })

  it('una voce nuova nasce da rivedere e segna la fonte come importata', () => {
    const out = lib.upsertFromAgent(db, { ...quadra, sources: [join(repos, 'Quadra', 'README.md')] }, null)
    expect(out.outcome).toBe('created')
    const item = lib.getPortfolioItem(db, 'quadra')
    expect(item.status).toBe('draft')
    expect(item.sectors).toEqual(['consulenza del lavoro'])
    expect(item.sources).toEqual([join(repos, 'Quadra')])
    const states = Object.fromEntries(lib.listSources(db).map(s => [s.name + s.kind, s.state]))
    expect(states).toMatchObject({ Quadrarepo: 'imported', Sudelsite: 'new' })
  })

  it('una bozza intatta si aggiorna, una voce corretta da William riceve una proposta', () => {
    expect(lib.upsertFromAgent(db, { ...quadra, stack: 'Nuxt' }, null).outcome).toBe('updated')

    const item = lib.getPortfolioItem(db, 'quadra')
    lib.updatePortfolioItem(db, item.id, { ...quadra, stack: 'Nuxt', summary: 'Scritto da William', notes: 'Non citare i prezzi' })
    const out = lib.upsertFromAgent(db, { ...quadra, stack: 'Nuxt 4' }, null)
    expect(out.outcome).toBe('proposed')

    const proposed = lib.getPortfolioItem(db, 'quadra')
    expect(proposed.summary).toBe('Scritto da William')
    expect(proposed.proposal!.fields).toEqual({ summary: quadra.summary, stack: 'Nuxt 4' })

    const applied = lib.resolveProposal(db, item.id, 'apply')
    expect(applied).toMatchObject({ summary: quadra.summary, stack: 'Nuxt 4', notes: 'Non citare i prezzi', proposal: null })
  })

  it('ignorare e riprendere una fonte', () => {
    const sudel = join(site, 'content', 'clients', 'it', 'sudel.md')
    lib.ignoreSource(db, sudel, 'Prova', null)
    expect(lib.listSources(db).find(s => s.path === sudel)).toMatchObject({ state: 'ignored', ignoredReason: 'Prova' })
    lib.restoreSource(db, sudel)
    expect(lib.listSources(db).find(s => s.path === sudel)!.state).toBe('new')
    expect(() => lib.ignoreSource(db, join(repos, 'Vuota'), 'x', null)).toThrow(lib.PortfolioError)
  })

  it('l\'import accoda le fonti nuove e non parte due volte', () => {
    const jobs = lib.enqueuePortfolioImport(db, undefined, 'dashboard')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ kind: 'portfolio_import', permission: 'read', cwd: repos })
    expect(jobs[0]!.prompt).toContain(join(site, 'content', 'clients', 'it', 'sudel.md'))
    expect(jobs[0]!.prompt).not.toContain(join(repos, 'Quadra'))
    expect(() => lib.enqueuePortfolioImport(db, undefined, 'dashboard')).toThrow(/già un import/)
  })
})
