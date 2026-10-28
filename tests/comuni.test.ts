import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '../server/db/client'
import { analyzeHtml } from '../server/lib/audit'
import { accented, COMUNI_FILES, parseCsv, personKey, politicalSide, searchComuni } from '../server/lib/comuni'
import { cityfixAngle, delegations, findGiunta, pageEmails, personalEmail } from '../server/lib/contacts'
import { comuneFit, scoreProspect } from '../server/lib/scoring'
import type { ComuneProfile } from '../server/lib/signals'
import { comuneSignals, formatEuro, reportLink, scanSite, signalsFile } from '../server/lib/signals'
import type { Fetcher } from '../server/lib/sources'

const root = mkdtempSync(join(tmpdir(), 'marketer-comuni-'))

beforeAll(() => {
  process.env.MARKETER_DATA_DIR = join(root, 'data')
  process.env.GOOGLE_PLACES_API_KEY = ''
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

// I tre file in piccolo, con le stranezze di quelli veri: ISTAT in Windows-1252 con un a capo
// nell'intestazione, l'Anagrafe con due righe di titolo, IndicePA con la PEC non sempre in Mail1.

const ISTAT = [
  'Codice Regione;"Codice dell\'Unità territoriale sovracomunale \n(valida a fini statistici)";Codice Comune formato alfanumerico;Denominazione in italiano;Denominazione Regione;Sigla automobilistica',
  '16;075;075076;Soleto;Puglia;LE',
  '16;075;075052;Nardò;Puglia;LE',
  '16;075;075046;Melendugno;Puglia;LE',
  '16;074;074015;San Vito dei Normanni;Puglia;BR',
  '20;111;111008;Burcei;Sardegna;SU',
  '03;015;015146;Milano;Lombardia;MI',
].join('\r\n')

const IPA = [
  '_id,Codice_IPA,Denominazione_ente,Codice_Categoria,Codice_comune_ISTAT,CAP,Indirizzo,Mail1,Tipo_Mail1,Mail2,Tipo_Mail2,Mail3,Tipo_Mail3,Mail4,Tipo_Mail4,Mail5,Tipo_Mail5,Sito_istituzionale',
  '1,u_gs,Unione dei Comuni della Grecia Salentina,L6,075076,73010,Via Roma 1,unione@pec.it,Pec,,,,,,,,,www.unione.it',
  '2,c_i800,Comune di Soleto,L6,075076,73010,Largo Osanna 30,protocollo@pec.soleto.it,Pec,,,,,,,,,www.comune.soleto.le.it',
  '3,c_f842,Comune di Nardò,L6,075052,73048,"Piazza Cesare Battisti, 7",info@comune.nardo.le.it,Altro,protocollo@pecnardo.it,Pec,,,,,,,https://www.comune.nardo.le.it',
  // Due Comuni con il sito sullo stesso hosting: restano due prospect.
  '4,c_f101,Comune di Melendugno,L6,075046,73026,Via Roma 1,protocollo@pec.melendugno.it,Pec,,,,,,,,,https://www.halleyweb.com/c075046',
  '5,c_i396,Comune di San Vito dei Normanni,L6,074015,72019,Piazza Leo 1,protocollo@pec.sanvito.it,Pec,,,,,,,,,https://www.halleyweb.com/c074015',
].join('\n')

const HEADER = '"codice_regione";"codice_provincia";"codice_comune";"denominazione_comune";"sigla_provincia";"popolazione_censita_alla_data_elezione";"cognome";"nome";"sesso";"data_nascita";"luogo_nascita";"descrizione_carica";"incarico";"data_elezione";"data_entrata_in_carica";"lista_appartenenza/collegamento";"titolo_studio";"professione"'

function amm(rows: [comune: string, province: string, population: number, surname: string, first: string, role: string, task: string, elected: string, since: string, lists: string][]): string {
  return [
    '"Amministratori Comunali - elenco completo Italia"',
    '"Aggiornato al 24/08/2026"',
    '',
    HEADER,
    ...rows.map(([c, p, pop, s, f, r, t, e, since, l]) => `"16";"041";"0750";"${c}";"${p}";"${pop}";"${s}";"${f}";"M";"01/01/1970";"LECCE (LE)";"${r}";${t ? `"${t}"` : ''};"${e}";"${since}";${l ? `"${l}"` : ''};;`),
  ].join('\r\n')
}

const GIUNTE: Parameters<typeof amm>[0] = [
  ['SOLETO', 'LE', 5236, 'VANTAGGIATO', 'GRAZIANO', 'Sindaco', '', '09/06/2024', '10/06/2024', 'PER SOLETO'],
  ['SOLETO', 'LE', 5236, 'CAFARO', 'DAVIDE', 'Assessore', '', '09/06/2024', '24/06/2024', ''],
  ['SOLETO', 'LE', 5236, 'CAFARO', 'DAVIDE', 'Consigliere', '', '09/06/2024', '10/06/2024', 'PER SOLETO'],
  ['SOLETO', 'LE', 5236, 'ROSSI', 'ANNA', 'Consigliere', 'Vicesindaco', '09/06/2024', '10/06/2024', 'PER SOLETO'],
  ['SOLETO', 'LE', 5236, 'BIANCHI', 'LUCA', 'Consigliere', '', '09/06/2024', '10/06/2024', 'SOLETO SI PUO'],
  ['NARDO\'', 'LE', 31688, 'MELLONE', 'GIUSEPPE', 'Sindaco', '', '03/10/2021', '05/10/2021', 'LIBERI POLARI | NARDO\' PER BENE'],
  ['MELENDUGNO', 'LE', 9000, 'ESPOSITO', 'MARIO', 'Commissario Straordinario', '', '', '01/03/2026', ''],
  // La stessa persona prima come assessore e poi come sindaco: vale il sindaco, con le sue liste.
  ['SAN VITO DEI NORMANNI', 'BR', 18267, 'RUGGIERO', 'MARCO', 'Assessore', '', '24/05/2026', '25/05/2026', ''],
  ['SAN VITO DEI NORMANNI', 'BR', 18267, 'RUGGIERO', 'MARCO', 'Sindaco', '', '24/05/2026', '25/05/2026', 'MOVIMENTO 5 STELLE | PARTITO DEMOCRATICO'],
  ['BURCEI', 'CA', 2500, 'PIRAS', 'ANNA', 'Sindaco', '', '12/06/2022', '13/06/2022', 'BURCEI CIVICA'],
  ['MILANO', 'MI', 1350000, 'SALA', 'GIUSEPPE', 'Sindaco', '', '03/10/2021', '05/10/2021', 'PARTITO DEMOCRATICO'],
]

/** Un fetch finto che dà i tre file per indirizzo. */
function filesFetch(giunte = GIUNTE): Fetcher {
  const files: Record<string, Buffer> = {
    [COMUNI_FILES.amministratori]: Buffer.from(amm(giunte), 'utf8'),
    [COMUNI_FILES.istat]: Buffer.from(ISTAT, 'latin1'),
    [COMUNI_FILES.ipa]: Buffer.from(`﻿${IPA}`, 'utf8'),
  }
  return (async (url: string) => {
    const file = files[url]
    return file ? new Response(new Uint8Array(file)) : new Response(null, { status: 404 })
  }) as unknown as Fetcher
}

describe('file dei Comuni', () => {
  it('legge il CSV con virgolette, a capo nei campi e BOM', () => {
    expect(parseCsv('a;"b ""x""\nc";d\r\n1;;3\n', ';')).toEqual([['a', 'b "x"\nc', 'd'], ['1', '', '3']])
    expect(parseCsv('﻿h1,h2\nv1,v2', ',')).toEqual([['h1', 'h2'], ['v1', 'v2']])
  })

  it('legge l\'orientamento dalle liste del sindaco', () => {
    expect(politicalSide('CASA DEI MODERATI-UNIONE DI CENTRO | FORZA ITALIA | FRATELLI D\'ITALIA GIORGIA MELONI | LEGA SALVINI PUGLIA')).toBe('centrodestra')
    expect(politicalSide('ATTIVA SAN VITO | AVANTI-PSI | MOVIMENTO 5 STELLE | PARTITO DEMOCRATICO')).toBe('centrosinistra')
    expect(politicalSide('DEMOCRATICI DI CENTRO SINISTRA')).toBe('centrosinistra')
    expect(politicalSide('CENTRO-DESTRA PER NARDO\'')).toBe('centrodestra')
    expect(politicalSide('PER SOLETO')).toBe('civica')
    expect(politicalSide('LEGALITA\' E TRASPARENZA | PARTITO LIBERAL DEMOCRATICO')).toBe('civica')
    expect(politicalSide('PARTITO DEMOCRATICO | FORZA ITALIA')).toBe('civica')
  })

  it('unisce Anagrafe, ISTAT e IndicePA e filtra per regione', async () => {
    const { companies, paidCalls } = await searchComuni({ source: 'it_comuni', region: 'Puglia', limit: 100 }, filesFetch())
    expect(paidCalls).toBe(0)
    expect(companies.map(c => c.name)).toEqual(['Comune di Nardò', 'Comune di San Vito dei Normanni', 'Comune di Melendugno', 'Comune di Soleto'])

    const soleto = companies.find(c => c.city === 'Soleto')!
    expect(soleto).toMatchObject({
      registryId: 'ISTAT:075076',
      region: 'LE',
      website: 'http://www.comune.soleto.le.it',
      email: 'protocollo@pec.soleto.it',
      address: 'Largo Osanna 30 73010 Soleto',
      population: 5236,
      electedAt: '2024-06-09',
      politicalSide: 'civica',
      source: 'it_comuni',
    })
    expect(soleto.contacts).toEqual([
      { name: 'Graziano Vantaggiato', role: 'Sindaco', lists: 'PER SOLETO', since: '2024-06-10' },
      { name: 'Anna Rossi', role: 'Vicesindaco', lists: null, since: '2024-06-10' },
      { name: 'Davide Cafaro', role: 'Assessore', lists: null, since: '2024-06-24' },
    ])

    const nardo = companies.find(c => c.city === 'Nardò')!
    expect(nardo.email).toBe('protocollo@pecnardo.it')
    expect(nardo.website).toBe('https://www.comune.nardo.le.it')
    const sanVito = companies.find(c => c.city === 'San Vito dei Normanni')!
    expect(sanVito).toMatchObject({ electedAt: '2026-05-24', politicalSide: 'centrosinistra', website: 'https://www.halleyweb.com' })
    expect(sanVito.contacts).toEqual([{ name: 'Marco Ruggiero', role: 'Sindaco', lists: 'MOVIMENTO 5 STELLE | PARTITO DEMOCRATICO', since: '2026-05-25' }])

    const commissariato = companies.find(c => c.city === 'Melendugno')!
    expect(commissariato).toMatchObject({ electedAt: null, politicalSide: null, email: 'protocollo@pec.melendugno.it' })
    expect(commissariato.contacts).toEqual([{ name: 'Mario Esposito', role: 'Commissario Straordinario', lists: null, since: '2026-03-01' }])
  })

  it('filtra per provincia e abitanti, dai più popolosi, e ritrova le province cambiate', async () => {
    const fetcher = filesFetch()
    const big = await searchComuni({ source: 'it_comuni', region: 'Puglia', minPopulation: 10000, limit: 1 }, fetcher)
    expect(big.companies.map(c => c.city)).toEqual(['Nardò'])
    const br = await searchComuni({ source: 'it_comuni', province: 'BR', limit: 100 }, fetcher)
    expect(br.companies.map(c => c.city)).toEqual(['San Vito dei Normanni'])
    const all = await searchComuni({ source: 'it_comuni', limit: 100 }, fetcher)
    expect(all.companies.map(c => c.city)).toEqual(expect.arrayContaining(['Milano', 'Burcei']))
    // In Sardegna l'Anagrafe ha ancora la sigla vecchia (CA): vale quella di ISTAT.
    const su = await searchComuni({ source: 'it_comuni', province: 'SU', limit: 100 }, fetcher)
    expect(su.companies.map(c => [c.city, c.region])).toEqual([['Burcei', 'SU']])
  })

  it('un file che manca ferma la ricerca con il nome della fonte', async () => {
    const broken = (async () => new Response('no', { status: 503 })) as unknown as Fetcher
    await expect(searchComuni({ source: 'it_comuni', limit: 10 }, broken)).rejects.toThrow(/HTTP 503/)
  })
})

describe('punteggio dei Comuni', () => {
  const today = new Date('2026-10-23')
  const comune = { employeesMin: null, employeesMax: null, website: 'https://www.comune.it', phone: null, placeId: null, foundedAt: null, source: 'it_comuni' as const, population: 20000, electedAt: '2026-05-24', profile: null }

  it('la giunta appena eletta pesa di più, uno strumento di segnalazione abbassa il bisogno', () => {
    const fresh = scoreProspect({ prospect: comune, audit: { status: 'done', issues: [], stack: [] }, portfolioMatch: true, today })
    expect(fresh).toMatchObject({ fit: 100, need: 70, fresh: 100 })
    const taken = scoreProspect({ prospect: comune, audit: { status: 'done', issues: [], stack: [{ name: 'Municipium', version: null, outdated: false }] }, portfolioMatch: true, today })
    expect(taken.need).toBe(20)
    const old = scoreProspect({ prospect: { ...comune, electedAt: '2021-10-03' }, audit: null, portfolioMatch: true, today })
    expect(old.fresh).toBe(10)
    expect(fresh.score).toBeGreaterThan(old.score)
  })

  it('l\'audit riconosce gli strumenti di segnalazione', () => {
    const page = analyzeHtml('<html><body><a href="https://app.municipiumapp.it/comune">App Municipium</a></body></html>', new Headers())
    expect(page.stack.map(s => s.name)).toContain('Municipium')
    const latin = analyzeHtml('<html><body><p>Fu un antico municipium romano.</p></body></html>', new Headers())
    expect(latin.stack).toEqual([])
  })
})

/** Un profilo da dati aperti, con i campi da cambiare caso per caso. */
function profile(over: { [K in keyof ComuneProfile]?: Partial<ComuneProfile[K]> } = {}): ComuneProfile {
  const base: ComuneProfile = {
    collectedAt: '2026-10-23',
    sinceYear: 2024,
    sources: { pnrr: 'PNRR', opencoesione: 'OpenCoesione', anac: 'ANAC', site: 'sito' },
    regeneration: {
      amount: 2_500_000,
      rank: 0.5,
      pnrr: [{ measure: 'rigenerazione urbana', title: 'Riqualificazione di piazza Osanna e delle strade del centro', amount: 1_200_000, partners: 1, cup: 'J81B21000560006' }, { measure: 'qualità dell\'abitare (PINQuA)', title: 'CUP 1 - ID 411 Comune', amount: 900_000, partners: 3, cup: 'J84E20001340001' }],
      cohesion: [{ title: 'Pubblica illuminazione di via Galatina', amount: 70_000, cycle: '2014-2020', url: 'https://opencoesione.gov.it/it/dati/progetti/x/' }],
    },
    digital: { measures: ['servizi al cittadino e sito', 'pagoPA e app IO', 'SPID e CIE', 'cloud', 'notifiche digitali', 'interoperabilità dei dati', 'SUAP e SUE digitali'], modelSite: true },
    reporting: { kind: 'modulo', tool: null, vendor: 'Halley', url: 'https://vurp.comune.it/', spid: true, map: false },
    maintenance: { contracts: 8, amount: 415_000, rank: 0.75, kinds: { verde: 5, strade: 3 }, top: [{ subject: 'Manutenzione ordinaria del verde pubblico', amount: 131_000, cig: 'B8811B8355', year: '2025' }], purchases: [] },
  }
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, typeof v === 'object' && v && !Array.isArray(v) && k in over ? { ...v, ...(over as Record<string, object>)[k] } : v])) as ComuneProfile
}

/** Il file di scripts/segnali_comuni.py per un Comune: i dati senza siti né percentili. */
function fileComune(over: { contracts?: number, amount?: number } = {}) {
  const p = profile()
  return {
    regeneration: { amount: over.amount ?? p.regeneration.amount, pnrr: p.regeneration.pnrr, cohesion: p.regeneration.cohesion },
    digital: { measures: p.digital.measures },
    maintenance: { ...p.maintenance, contracts: over.contracts ?? p.maintenance.contracts, rank: undefined },
  }
}

/** Un fetch finto che risponde con l'HTML indicato per indirizzo, 404 altrove. */
function pagesFetch(pages: Record<string, string>): Fetcher {
  return (async (url: string) => {
    const html = pages[url]
    const res = html === undefined ? new Response('no', { status: 404 }) : new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
    Object.defineProperty(res, 'url', { value: url })
    return res
  }) as unknown as Fetcher
}

describe('segnali dei Comuni', () => {
  it('il fit viene da rigenerazione, digitale e spazio libero; il bisogno dalla manutenzione', () => {
    expect(comuneFit(profile())).toEqual({ regeneration: 25, digital: 25, space: 22, maintenance: 80 })
    expect(comuneFit(profile({ regeneration: { amount: 0, rank: 0 } })).regeneration).toBe(0)
    expect(comuneFit(profile({ reporting: { kind: 'nessuno' } })).space).toBe(30)
    expect(comuneFit(profile({ reporting: { kind: 'piattaforma', tool: 'OpenSegnalazioni' } })).space).toBe(6)
    expect(comuneFit(profile({ maintenance: { purchases: [{ subject: 'App segnalazioni', amount: 15_500, cig: 'B7F774810D', year: '2025' }] } })).space).toBe(6)
    expect(comuneFit(profile({ digital: { measures: ['a', 'b', 'c'], modelSite: false } })).digital).toBe(0)
    expect(comuneFit(profile({ maintenance: { contracts: 0, rank: 0 } })).maintenance).toBe(10)
  })

  it('con il profilo il punteggio usa il fit reale', () => {
    const prospect = { employeesMin: null, employeesMax: null, website: 'https://www.comune.it', phone: null, placeId: null, foundedAt: null, source: 'it_comuni' as const, population: 5000, electedAt: '2026-05-24', profile: profile() }
    expect(scoreProspect({ prospect, audit: null, portfolioMatch: null, today: new Date('2026-10-23') })).toMatchObject({ fit: 72, need: 80, fresh: 100 })
  })

  it('scrive frasi da citare con fonte e link, e salta i titoli che sono codici', () => {
    const signals = comuneSignals(profile())
    const pnrr = signals.filter(s => s.source === 'PNRR' && s.kind === 'rigenerazione')
    expect(pnrr[0]).toEqual({
      kind: 'rigenerazione',
      text: 'PNRR, rigenerazione urbana: «Riqualificazione di piazza Osanna e delle strade del centro», 1,2 milioni di euro (CUP J81B21000560006)',
      source: 'PNRR',
      url: 'https://www.opencup.gov.it/portale/progetto/-/cup/J81B21000560006',
    })
    expect(pnrr[1]!.text).toBe('PNRR, qualità dell\'abitare (PINQuA): 900.000 euro in tutto, con altri 2 Comuni (CUP J84E20001340001)')
    expect(signals.find(s => s.kind === 'segnalazioni')!.text).toContain('modulo generico (su Halley, con accesso SPID, senza mappa)')
    expect(signals.find(s => s.kind === 'manutenzione')!.text).toBe('Dal 2024, 8 affidamenti di manutenzione (verde, strade) per 415.000 euro')
    expect(signals.filter(s => s.kind === 'digitale').map(s => s.source)).toEqual(['PNRR', 'sito'])
    expect(formatEuro(85_000)).toBe('85.000 euro')
    expect(formatEuro(1_020_000)).toBe('1 milione di euro')
    expect(formatEuro(6_388_630)).toBe('6,4 milioni di euro')
  })

  it('rifiuta un file con link che non sono http o https', () => {
    const bad = fileComune()
    bad.regeneration.cohesion = [{ title: 'x', amount: 1, cycle: '2014-2020', url: 'JavaScript:alert(1)' }]
    expect(() => signalsFile.parse({ region: 'Puglia', collectedAt: '2026-10-23', sinceYear: 2024, sources: profile().sources, comuni: { '075076': bad } })).toThrow()
  })

  it('legge dal sito come si segnala, con le regole dell\'audit', async () => {
    expect(reportLink('<a href="/notizie/segnalazione-blatte">Segnalazione blatte</a><a href="javascript:x()">Segnala disservizio</a><a href="/segnala">Segnala</a><a href="/servizi/segnalazione-disservizio/">Segnala disservizio</a>', 'https://www.comune.it/'))
      .toBe('https://www.comune.it/servizi/segnalazione-disservizio/')
    const modulo = await scanSite('https://www.comune.it', pagesFetch({
      'https://www.comune.it/': '<link href="/bootstrap-italia.min.css"><a href="/servizi/segnalazione-disservizio/">Segnala disservizio</a>',
      'https://www.comune.it/servizi/segnalazione-disservizio/': '<p>Accedi con SPID</p><script src="https://vurp.halley.it/app.js"></script>',
    }))
    expect(modulo).toEqual({ modelSite: true, reporting: { kind: 'modulo', tool: null, vendor: 'Halley', url: 'https://www.comune.it/servizi/segnalazione-disservizio/', spid: true, map: false } })
    const piattaforma = await scanSite('https://www.altro.it', pagesFetch({
      'https://www.altro.it/': '<a href="/it/new-issue">Segnala un disservizio</a>',
      'https://www.altro.it/it/new-issue': '<div id="map"></div><script src="https://cdn.municipiumapp.it/leaflet.js"></script>',
    }))
    expect(piattaforma.reporting).toMatchObject({ kind: 'piattaforma', tool: 'Municipium', map: true, url: 'https://www.altro.it/it/new-issue' })
    const chiuso = await scanSite('https://www.terzo.it', pagesFetch({ 'https://www.terzo.it/': '<a href="/segnalazioni">Segnala</a>' }))
    expect(chiuso.reporting).toBeNull()
  })
})


describe('contatti della giunta', () => {
  // Come Joomla nasconde un'email agli spambot (dal sito del Comune di Gallipoli).
  const cloak = `<script>var addy1a2b = 'r&#111;b&#101;rt&#111;.c&#97;rt&#101;n&#105;' + '&#64;'; addy1a2b = addy1a2b + 'c&#111;m&#117;n&#101;' + '&#46;' + 'g&#97;ll&#105;p&#111;l&#105;' + '&#46;' + 'l&#101;' + '&#46;' + '&#105;t'; var addy_text1a2b = 'Roberto Carten&#236;';</script>`

  it('rimonta le email nascoste e sceglie quella della persona', () => {
    expect(pageEmails('sindaco@comune.melpignano.le e sindaco@comune.melpignano.le.it')).toEqual(['sindaco@comune.melpignano.le.it'])
    const emails = pageEmails(`${cloak}<a href="mailto:protocollo.comunegallipoli@pec.rupar.puglia.it">PEC</a> scrivi a urp [at] comune.gallipoli.le.it`)
    expect(emails).toEqual(expect.arrayContaining(['roberto.carteni@comune.gallipoli.le.it', 'protocollo.comunegallipoli@pec.rupar.puglia.it', 'urp@comune.gallipoli.le.it']))
    expect(emails).not.toContain('roberto cartenì')
    expect(personalEmail(emails, 'Roberto Cartenì', 'Assessore', true)).toBe('roberto.carteni@comune.gallipoli.le.it')
    expect(personalEmail(['sindaco@comune.it', 'info@comune.it'], 'Flavio Fasano', 'Sindaco', true)).toBe('sindaco@comune.it')
    expect(personalEmail(['sindaco@comune.it'], 'Flavio Fasano', 'Sindaco', false)).toBeNull()
    // Il nome di battesimo non basta: mariagrazia.rossi non è di Maria Verdi.
    expect(personalEmail(['mariagrazia.rossi@comune.it'], 'Maria Verdi', 'Assessore', true)).toBeNull()
  })

  it('legge le deleghe e dice perché la persona conta per CityFix', () => {
    const d = delegations('Cartenì Roberto Deleghe: Assessore ai Lavori Pubblici, Demanio e Patrimonio, Marine, Arredo Urbano e Verde Pubblico. Documenti e link')
    expect(d).toBe('Assessore ai Lavori Pubblici, Demanio e Patrimonio, Marine, Arredo Urbano e Verde Pubblico.')
    expect(cityfixAngle(d)).toEqual(['interventi sul territorio'])
    expect(cityfixAngle('Bilancio, Innovazione Tecnologica, Agenda Digitale')).toEqual(['innovazione e digitale', 'fondi e bilancio'])
    expect(cityfixAngle('Ambiente e Transizione ecologica')).toEqual(['ambiente e rifiuti'])
    expect(delegations('Deleghe: Sport Recapiti Telefono 0833')).toBe('Sport')
    expect(accented('ROBERTO CARTENI\'')).toBe('ROBERTO CARTENÌ')
    expect(personKey('Cartenì Roberto')).toBe(personKey('Roberto Carteni\''))
  })

  it('trova sul sito la pagina di ognuno, con email e deleghe', async () => {
    const people = await findGiunta('https://www.comune.it', [{ id: 1, name: 'Flavio Fasano', role: 'Sindaco' }, { id: 2, name: 'Mario Rossi', role: 'Vicesindaco' }, { id: 3, name: 'Roberto Cartenì', role: 'Assessore' }, { id: 4, name: 'Anna Bianchi', role: 'Assessore' }], pagesFetch({
      'https://www.comune.it/': '<a href="/notizie/il-sindaco-fasano-incontra-gli-studenti">Il sindaco Fasano</a><a href="/amministrazione/ente/giunta-comunale">Giunta Comunale</a>',
      'https://www.comune.it/amministrazione/ente/giunta-comunale': '<title>Giunta</title><p>Rossi Mario Vicesindaco Bianchi Anna Deleghe: Cultura e Turismo. Curriculum</p><a href="/giunta/item/carteni-roberto">Carten&igrave; Roberto</a><a href="/giunta/item/fasano-flavio">Fasano Flavio</a>',
      'https://www.comune.it/giunta/item/carteni-roberto': `<title>Cartenì Roberto</title><p>Deleghe: Lavori Pubblici, Verde Pubblico. Recapiti</p>${cloak}`,
      'https://www.comune.it/giunta/item/fasano-flavio': '<title>Fasano Flavio</title><p>Deleghe correnti : Il Sindaco mantiene la titolarità delle seguenti deleghe: Urbanistica. Recapiti</p><a href="mailto:sindaco@comune.it">sindaco@comune.it</a>',
    }))
    expect(people).toEqual([
      { id: 1, name: 'Flavio Fasano', email: 'sindaco@comune.it', delegations: 'Urbanistica.', sourceUrl: 'https://www.comune.it/giunta/item/fasano-flavio' },
      // Senza deleghe sue, non prende quelle di chi viene dopo.
      { id: 2, name: 'Mario Rossi', email: null, delegations: null, sourceUrl: 'https://www.comune.it/amministrazione/ente/giunta-comunale' },
      { id: 3, name: 'Roberto Cartenì', email: 'roberto.carteni@comune.gallipoli.le.it', delegations: 'Lavori Pubblici, Verde Pubblico.', sourceUrl: 'https://www.comune.it/giunta/item/carteni-roberto' },
      { id: 4, name: 'Anna Bianchi', email: null, delegations: 'Cultura e Turismo.', sourceUrl: 'https://www.comune.it/amministrazione/ente/giunta-comunale' },
    ])
  })
})

describe('ricerca dei Comuni', () => {
  let db: Db
  let lib: typeof import('../server/lib/prospects')

  beforeAll(async () => {
    const client = await import('../server/db/client')
    db = client.useDb()
    migrate(db, { migrationsFolder: resolve('drizzle') })
    lib = await import('../server/lib/prospects')
  })

  it('salva i Comuni con le persone, e una nuova giunta sostituisce la vecchia', async () => {
    const segment = lib.createSegment(db, { name: 'Comuni Puglia', market: 'IT', sector: 'pubblica amministrazione', queries: [{ source: 'it_comuni', region: 'Puglia', limit: 300 }] })
    lib.enqueueSearch(db, segment.id)
    const first = await lib.runSearch(db, lib.claimNextSearch(db)!, filesFetch())
    expect(first).toMatchObject({ status: 'done', found: 4, added: 4, paidCalls: 0 })

    const soleto = lib.listProspects(db, { segmentId: segment.id }).find(p => p.city === 'Soleto')!
    expect(lib.prospectDetail(db, soleto.id).contacts.map(c => c.role)).toEqual(['Sindaco', 'Vicesindaco', 'Assessore'])

    // Elezioni a Soleto: sindaco nuovo, di un partito, e nessuna giunta ancora.
    const nuova = GIUNTE.filter(r => r[0] !== 'SOLETO')
    nuova.push(['SOLETO', 'LE', 5300, 'VERDI', 'PAOLA', 'Sindaco', '', '24/05/2026', '25/05/2026', 'FRATELLI D\'ITALIA | SOLETO AVANTI'])
    lib.enqueueSearch(db, segment.id)
    const second = await lib.runSearch(db, lib.claimNextSearch(db)!, filesFetch(nuova))
    expect(second).toMatchObject({ status: 'done', found: 4, added: 0 })

    const detail = lib.prospectDetail(db, soleto.id)
    expect(detail.prospect).toMatchObject({ population: 5300, electedAt: '2026-05-24', politicalSide: 'centrodestra' })
    expect(detail.contacts.map(c => `${c.role}:${c.name}`)).toEqual(['Sindaco:Paola Verdi'])

    // L'email trovata sul sito resta alla persona anche dopo una nuova ricerca.
    const sindaco = lib.listContacts(db, soleto.id)[0]!
    expect(lib.enrichContacts(db, [{ id: sindaco.id, name: 'Paola Verdi', email: 'sindaco@comune.soleto.le.it', delegations: 'Urbanistica', sourceUrl: 'https://www.comune.soleto.le.it/giunta' }]))
      .toEqual({ updated: 1, notFound: [] })
    // Un giro che non trova niente non cancella né sposta la fonte.
    expect(lib.enrichContacts(db, [{ id: sindaco.id, name: 'Paola Verdi', email: null, delegations: null, sourceUrl: 'https://www.comune.soleto.le.it/' }]))
      .toEqual({ updated: 0, notFound: ['Paola Verdi'] })
    expect(lib.findComune(db, 'soleto')?.id).toBe(soleto.id)
    lib.enqueueSearch(db, segment.id)
    await lib.runSearch(db, lib.claimNextSearch(db)!, filesFetch(nuova))
    expect(lib.prospectDetail(db, soleto.id).contacts[0]).toMatchObject({ name: 'Paola Verdi', email: 'sindaco@comune.soleto.le.it', delegations: 'Urbanistica', sourceUrl: 'https://www.comune.soleto.le.it/giunta', angles: [] })

    // LinkedIn: solo profili linkedin.com/in, e resta anche dopo una nuova ricerca (che riscrive le righe).
    const person = { prospectId: soleto.id, name: 'Verdi Paola' }
    expect(() => lib.saveLinkedin(db, { ...person, url: 'javascript:x', activity: 'attivo', note: 'x' })).toThrow()
    expect(() => lib.saveLinkedin(db, { ...person, url: 'https://it.linkedin.com/in/omonimo', activity: 'assente', note: 'un omonimo' })).toThrow(/assente non ha indirizzo/)
    expect(() => lib.saveLinkedin(db, { ...person, url: null, activity: 'attivo', note: 'x' })).toThrow(/ha il suo indirizzo/)
    expect(() => lib.saveLinkedin(db, { ...person, name: 'Mario Neri', url: null, activity: 'assente', note: 'x' })).toThrow(/non è tra le persone/)
    lib.saveLinkedin(db, { ...person, url: 'https://it.linkedin.com/in/paola-verdi', activity: 'attivo', note: 'Post di settembre 2026 sul bilancio' })
    lib.enqueueSearch(db, segment.id)
    await lib.runSearch(db, lib.claimNextSearch(db)!, filesFetch(nuova))
    expect(lib.listContacts(db, soleto.id)[0]).toMatchObject({ linkedinUrl: 'https://it.linkedin.com/in/paola-verdi', linkedinActivity: 'attivo' })
    expect(lib.prospectDetail(db, soleto.id).prospect.legalBasis).toBe('public_office')
  })

  it('importa i segnali nei Comuni trovati, con i percentili tra loro, e ne rifà il punteggio', async () => {
    const soleto = lib.listProspects(db, {}).find(p => p.city === 'Soleto')!
    const file = signalsFile.parse({ region: 'Puglia', collectedAt: '2026-10-23', sinceYear: 2024, sources: profile().sources, comuni: { '075076': fileComune(), '075052': fileComune({ contracts: 2, amount: 0 }), '075999': fileComune() } })
    const site = { modelSite: true, reporting: profile().reporting }
    expect(lib.importSignals(db, file, new Map([[soleto.id, site]]))).toEqual({ updated: 2, missing: 1 })
    const after = lib.prospectDetail(db, soleto.id)
    expect(after.comune?.fit).toEqual({ regeneration: 40, digital: 25, space: 22, maintenance: 100 })
    expect(after.comune?.max.regeneration).toBe(40)
    expect(after.comune?.signals.length).toBeGreaterThan(3)
    expect('profile' in after.prospect).toBe(false)
    const nardo = lib.prospectDetail(db, lib.listProspects(db, {}).find(p => p.city === 'Nardò')!.id)
    // Senza sito letto lo spazio resta da capire, e senza progetti la rigenerazione è zero.
    expect(nardo.comune?.fit).toMatchObject({ regeneration: 0, space: 20 })
  })
})
