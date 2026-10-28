import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import { analyzeHtml, buildIssues, olderThan } from '../server/lib/audit'
import { freshScore, scoreProspect, segmentScore } from '../server/lib/scoring'
import type { Fetcher } from '../server/lib/sources'
import { frHeadcountCodes, normalizeWebsite, sameBusiness, searchFrRegistry, searchPlaces, siteDomain } from '../server/lib/sources'

const root = mkdtempSync(join(tmpdir(), 'marketer-prospects-'))

beforeAll(() => {
  process.env.MARKETER_DATA_DIR = join(root, 'data')
  process.env.GOOGLE_PLACES_API_KEY = ''
  process.env.OPENAPI_COMPANY_TOKEN = ''
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Un fetch finto che risponde con i JSON indicati, uno per chiamata, e registra le richieste. */
function fakeFetch(...bodies: unknown[]): Fetcher & { calls: { url: string, init?: RequestInit }[] } {
  const calls: { url: string, init?: RequestInit }[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const body = bodies[Math.min(calls.length - 1, bodies.length - 1)]
    return new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as Fetcher & { calls: typeof calls }
  fn.calls = calls
  return fn
}

const frCompany = (siren: string, extra: object = {}) => ({
  siren,
  nom_complet: `Cabinet ${siren}`,
  nom_raison_sociale: `CABINET ${siren}`,
  nature_juridique: '5710',
  activite_principale: '69.20Z',
  date_creation: '2024-05-01',
  tranche_effectif_salarie: '11',
  siege: { adresse: '1 RUE X 69001 LYON', libelle_commune: 'LYON', departement: '69' },
  ...extra,
})

describe('sources', () => {
  it('normalizza i siti e scarta social e vetrine', () => {
    expect(normalizeWebsite('www.Studio-Rossi.it/contatti?x=1')).toBe('http://www.studio-rossi.it')
    expect(normalizeWebsite('https://studiorossi.it/')).toBe('https://studiorossi.it')
    expect(normalizeWebsite('https://www.facebook.com/studiorossi')).toBeNull()
    expect(normalizeWebsite('https://rossi.business.site')).toBeNull()
    expect(normalizeWebsite('https://wa.me/39333')).toBeNull()
    expect(normalizeWebsite('non un sito')).toBeNull()
    expect(siteDomain('https://www.studiorossi.it')).toBe('studiorossi.it')
  })

  it('riconosce la stessa azienda a parte la forma giuridica', () => {
    expect(sameBusiness('STUDIO ROSSI SRL', 'Studio Rossi Consulenti')).toBe(true)
    expect(sameBusiness('Studio Rossi S.r.l.', 'Bianchi & Partners')).toBe(false)
  })

  it('registro francese: pagine, fasce di dipendenti, niente imprenditori individuali', async () => {
    const fetcher = fakeFetch(
      { results: [frCompany('111'), frCompany('222', { nature_juridique: '1000' })], total_pages: 2 },
      { results: [frCompany('333', { tranche_effectif_salarie: null })], total_pages: 2 },
    )
    const { companies, paidCalls } = await searchFrRegistry({ source: 'fr_registry', naf: '69.20Z', departement: '69', limit: 50 }, fetcher)
    expect(paidCalls).toBe(0)
    expect(companies.map(c => c.registryId)).toEqual(['FR:111', 'FR:333'])
    expect(companies[0]).toMatchObject({ name: 'CABINET 111', city: 'Lyon', employeesMin: 10, employeesMax: 19, foundedAt: '2024-05-01', country: 'FR' })
    expect(companies[1]!.employeesMin).toBeNull()
    expect(fetcher.calls[0]!.url).toContain('departement=69')
  })

  it('registro francese: fasce di dipendenti e solo sedi nel dipartimento', async () => {
    expect(frHeadcountCodes(10, 249)).toEqual(['11', '12', '21', '22', '31'])
    expect(frHeadcountCodes(undefined, undefined)).toEqual([])
    const fetcher = fakeFetch({ results: [frCompany('111'), frCompany('444', { siege: { departement: '75', libelle_commune: 'PARIS' } })], total_pages: 1 })
    const { companies } = await searchFrRegistry({ source: 'fr_registry', naf: '69.20Z', departement: '69', minEmployees: 10, maxEmployees: 49, limit: 10 }, fetcher)
    expect(companies.map(c => c.registryId)).toEqual(['FR:111'])
    expect(decodeURIComponent(fetcher.calls[0]!.url)).toContain('tranche_effectif_salarie=11,12')
  })

  it('Google Maps: senza chiave è spento, con la chiave legge le pagine e salta i chiusi', async () => {
    await expect(searchPlaces({ source: 'places', text: 'studio Lecce', limit: 20 }, 'IT', fakeFetch({}))).rejects.toThrow(/spento/)
    process.env.GOOGLE_PLACES_API_KEY = 'k'
    try {
      const place = (id: string, extra: object = {}) => ({
        id,
        displayName: { text: `Studio ${id}` },
        websiteUri: `https://www.studio${id}.it/home`,
        addressComponents: [{ shortText: 'Lecce', longText: 'Lecce', types: ['locality'] }, { shortText: 'LE', longText: 'Provincia di Lecce', types: ['administrative_area_level_2'] }, { shortText: 'IT', longText: 'Italia', types: ['country'] }],
        businessStatus: 'OPERATIONAL',
        ...extra,
      })
      const fetcher = fakeFetch({ places: [place('a'), place('b', { businessStatus: 'CLOSED_PERMANENTLY' })], nextPageToken: 't' }, { places: [place('c', { websiteUri: undefined })] })
      const { companies, paidCalls } = await searchPlaces({ source: 'places', text: 'studio Lecce', limit: 20 }, 'IT', fetcher)
      expect(paidCalls).toBe(2)
      expect(companies.map(c => c.placeId)).toEqual(['a', 'c'])
      expect(companies[0]).toMatchObject({ website: 'https://www.studioa.it', city: 'Lecce', region: 'LE', country: 'IT' })
      expect(JSON.parse(String(fetcher.calls[1]!.init!.body)).pageToken).toBe('t')
    }
    finally {
      process.env.GOOGLE_PLACES_API_KEY = ''
    }
  })
})

describe('scoring', () => {
  const today = new Date('2026-10-21')
  const base = { employeesMin: 10, employeesMax: 19, website: 'https://a.it', phone: null, placeId: null, foundedAt: '2020-01-01', source: 'places' as const, population: null, electedAt: null, profile: null }

  it('il bisogno viene dai difetti, e senza audit resta sconosciuto', () => {
    const none = scoreProspect({ prospect: base, audit: null, portfolioMatch: true, today })
    expect(none.need).toBeNull()
    const bad = scoreProspect({
      prospect: base,
      audit: { status: 'done', stack: [], issues: [{ code: 'a', severity: 3, text: '' }, { code: 'b', severity: 3, text: '' }, { code: 'c', severity: 2, text: '' }] },
      portfolioMatch: true,
      today,
    })
    expect(bad.need).toBe(62)
    expect(bad.fit).toBe(100)
    expect(bad.score).toBeGreaterThan(none.score)
  })

  it('Google Maps senza sito è un bisogno, un registro senza sito no', () => {
    expect(scoreProspect({ prospect: { ...base, website: null, placeId: 'p' }, audit: null, portfolioMatch: null, today }).need).toBe(70)
    expect(scoreProspect({ prospect: { ...base, website: null }, audit: null, portfolioMatch: null, today }).need).toBeNull()
  })

  it('freschezza dalla data di nascita, segmento dalla media dei migliori', () => {
    expect(freshScore({ prospect: { ...base, foundedAt: '2026-03-01' }, audit: null, portfolioMatch: null, today })).toBe(100)
    expect(freshScore({ prospect: { ...base, foundedAt: null }, audit: null, portfolioMatch: null, today })).toBe(20)
    expect(segmentScore([null, 50, 70])).toBe(60)
    expect(segmentScore([null])).toBeNull()
  })
})

describe('audit', () => {
  const old = `<html><head><title>Studio</title>
    <script src="/wp-includes/js/jquery/jquery.min.js?ver=1.12.4"></script>
    <meta name="generator" content="WordPress 5.2.4"></head>
    <body><p>&copy; 2017 Studio</p><a href="https://calendly.com/studio">Prenota</a></body></html>`

  it('riconosce stack vecchi, prenotazioni e copyright fermo', () => {
    const page = analyzeHtml(old, new Headers({ 'x-powered-by': 'PHP/7.4.33' }))
    expect(page.mobile).toBe(false)
    expect(page.hasBooking).toBe(true)
    expect(page.hasForm).toBe(false)
    expect(page.copyrightYear).toBe(2017)
    expect(page.stack).toEqual(expect.arrayContaining([
      { name: 'WordPress', version: '5.2.4', outdated: true },
      { name: 'jQuery', version: '1.12.4', outdated: true },
      { name: 'PHP', version: '7.4', outdated: true },
    ]))
  })

  it('scrive i difetti dal più grave', () => {
    const page = analyzeHtml(old, new Headers())
    const issues = buildIssues({ https: true, httpsRedirect: false, certError: false }, page, { performance: 31, accessibility: 90, seo: 70, bestPractices: 90, lcpMs: 6400 }, new Date('2026-10-21'))
    const codes = issues.map(i => i.code)
    expect(codes).toEqual(expect.arrayContaining(['not_mobile', 'outdated_wordpress', 'outdated_jquery', 'slow_mobile', 'weak_seo', 'no_https_redirect', 'no_meta_description', 'stale_copyright']))
    expect(codes).not.toContain('no_contact_form')
    expect(issues[0]!.severity).toBe(3)
    expect(issues.find(i => i.code === 'slow_mobile')!.text).toContain('6,4 secondi')
  })

  it('un sito moderno non ha difetti di stack', () => {
    const html = '<html><head><title>Ok</title><meta name="viewport" content="width=device-width"><meta name="description" content="Bello"></head><body><form><input type="email"></form><script src="/_nuxt/app.js"></script></body></html>'
    const page = analyzeHtml(html, new Headers())
    expect(page.stack).toEqual([{ name: 'Nuxt', version: null, outdated: false }])
    expect(buildIssues({ https: true, httpsRedirect: true, certError: false }, page, null, new Date())).toEqual([])
    expect(olderThan('3.10.0', '3.5.0')).toBe(false)
  })
})

describe('segmenti e prospect', () => {
  let db: Db
  let lib: typeof import('../server/lib/prospects')

  beforeAll(async () => {
    const client = await import('../server/db/client')
    db = client.useDb()
    migrate(db, { migrationsFolder: resolve('drizzle') })
    lib = await import('../server/lib/prospects')
  })

  it('una ricerca salva i prospect una volta sola e li punteggia', async () => {
    const segment = lib.createSegment(db, { name: 'Consulenti Lione', market: 'FR', sector: 'Consulenza del lavoro', queries: [{ source: 'fr_registry', naf: '69.20Z', departement: '69', limit: 10 }] })
    expect(segment.sector).toBe('consulenza del lavoro')
    const [search] = lib.enqueueSearch(db, segment.id)
    expect(() => lib.enqueueSearch(db, segment.id)).toThrow(/già una ricerca/)

    const claimed = lib.claimNextSearch(db)!
    expect(claimed.id).toBe(search!.id)
    const done = await lib.runSearch(db, claimed, fakeFetch({ results: [frCompany('111'), frCompany('222')], total_pages: 1 }))
    expect(done).toMatchObject({ status: 'done', found: 2, added: 2 })

    lib.enqueueSearch(db, segment.id)
    const again = await lib.runSearch(db, lib.claimNextSearch(db)!, fakeFetch({ results: [frCompany('111')], total_pages: 1 }))
    expect(again).toMatchObject({ status: 'done', found: 1, added: 0 })

    const rows = lib.listProspects(db, { segmentId: segment.id })
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.score !== null && r.needScore === null)).toBe(true)
    expect(lib.listSegments(db)[0]).toMatchObject({ id: segment.id, prospects: 2, audited: 0 })
  })

  it('una ricerca su una fonte spenta non parte', () => {
    const segment = lib.createSegment(db, { name: 'Maps', market: 'IT', sector: 'ristorazione', queries: [{ source: 'places', text: 'ristoranti Lecce', limit: 20 }] })
    expect(() => lib.enqueueSearch(db, segment.id)).toThrow(/Google Maps/)
  })

  it('il sito scritto a mano mette in coda l\'audit, e l\'audit fa il bisogno', () => {
    const [first] = lib.listProspects(db, {})
    expect(() => lib.enqueueAudit(db, first!.id)).toThrow(/sito/)
    lib.updateProspect(db, first!.id, { website: 'cabinet111.fr', phone: null, legalBasis: 'b2b_optout', notes: '' })
    const audit = lib.claimNextAudit(db)!
    expect(audit.url).toBe('http://cabinet111.fr')
    lib.finishAudit(db, audit.id, {
      finalUrl: 'https://cabinet111.fr/', https: true, mobile: false, performance: 40, accessibility: 80, seo: 90, bestPractices: 90, lcpMs: 5000,
      stack: [], hasForm: false, hasBooking: false, issues: [{ code: 'not_mobile', severity: 3, text: 'x' }], error: null,
    })
    const detail = lib.prospectDetail(db, first!.id)
    expect(detail.audit?.status).toBe('done')
    expect(detail.prospect.needScore).toBe(25)

    // La stessa azienda trovata da Google Maps con lo stesso dominio non si duplica.
    const { created } = lib.upsertProspect(db, {
      name: 'Cabinet 111', country: 'FR', city: 'Lyon', region: null, address: null, website: 'https://www.cabinet111.fr', phone: '+33 4',
      registryId: null, placeId: 'place-111', sectorCode: null, sectorLabel: null, employeesMin: null, employeesMax: null, foundedAt: null, source: 'places',
    }, null)
    expect(created).toBe(false)
    expect(lib.getProspect(db, first!.id)).toMatchObject({ placeId: 'place-111', phone: '+33 4' })
  })

  it('la proposta dei segmenti è un job in sola lettura, uno alla volta', () => {
    const job = lib.enqueueSegmentProposal(db, 'IT', 'dashboard')
    expect(job).toMatchObject({ kind: lib.SEGMENT_JOB_KIND, permission: 'read' })
    expect(job.prompt).toContain('segment_propose')
    expect(job.prompt).not.toContain('it_registry (')
    expect(() => lib.enqueueSegmentProposal(db, undefined, 'dashboard')).toThrow(/già una proposta/)
  })
})
