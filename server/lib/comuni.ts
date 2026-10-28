import type { PoliticalSide, Prospect, SegmentQuery } from '../db/schema'
import type { Fetcher, FoundCompany, FoundContact, SourceResult } from './sources'
import { fetchOk, normalizeWebsite, SourceError, stripAccents, title } from './sources'

// I Comuni italiani dai dati aperti, gratis. L'Anagrafe degli amministratori locali del Ministero
// dell'Interno dà sindaco, giunta, liste e abitanti; l'elenco ISTAT il codice e la regione;
// IndicePA sito, PEC e indirizzo. A ogni ricerca si leggono i tre file interi, circa 40 MB.

export const COMUNI_FILES = {
  amministratori: 'https://dait.interno.gov.it/documenti/ammcom.csv',
  istat: 'https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv',
  ipa: 'https://indicepa.gov.it/ipa-dati/datastore/dump/d09adf99-dc10-4349-8c53-27b1e5aa97b6?format=csv',
} as const

export const IT_REGIONS = [
  'Piemonte', 'Valle d\'Aosta', 'Lombardia', 'Trentino-Alto Adige', 'Veneto', 'Friuli-Venezia Giulia',
  'Liguria', 'Emilia-Romagna', 'Toscana', 'Umbria', 'Marche', 'Lazio', 'Abruzzo', 'Molise', 'Campania',
  'Puglia', 'Basilicata', 'Calabria', 'Sicilia', 'Sardegna',
] as const

/** Un Comune ha metri suoi: punteggio, audit e schede lo chiedono qui. */
export const isComune = (p: Pick<Prospect, 'source'>) => p.source === 'it_comuni'

/** Un Comune si riconosce dal codice ISTAT, salvato come registryId. */
export const istatId = (code: string) => `ISTAT:${code}`
export const istatCode = (registryId: string) => registryId.replace(/^ISTAT:/, '')

/** CSV con le virgolette e gli a capo dentro i campi; le righe finiscono con LF, CRLF o CR. */
export function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c !== '"') {
        field += c
      }
      else if (text[i + 1] === '"') {
        field += '"'
        i++
      }
      else {
        quoted = false
      }
    }
    else if (c === '"') {
      quoted = true
    }
    else if (c === sep) {
      row.push(field)
      field = ''
    }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    }
    else {
      field += c
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Le righe dopo l'intestazione, con le colonne chiamate per nome: se il formato cambia, si dice. */
function table<K extends string>(text: string, sep: string, label: string, columns: Record<K, string>): Record<K, string>[] {
  const rows = parseCsv(text, sep)
  const keys = Object.keys(columns) as K[]
  const clean = (h: string) => h.replace(/\s+/g, ' ').trim()
  const at = rows.findIndex(r => keys.every(k => r.some(h => clean(h).startsWith(columns[k]))))
  if (at < 0) throw new SourceError(`${label}: intestazione non trovata, il formato del file è cambiato`)
  const header = rows[at]!.map(clean)
  const index = keys.map(k => header.findIndex(h => h.startsWith(columns[k])))
  return rows.slice(at + 1).filter(r => r.length >= header.length)
    .map(r => Object.fromEntries(keys.map((k, i) => [k, r[index[i]!]!.trim()])) as Record<K, string>)
}

/** Nome confrontabile tra i tre file: senza accenti, apostrofi e spazi. */
export function nameKey(name: string): string {
  return stripAccents(name).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const RIGHT = /\b(?:FRATELLI D'ITALIA|FDI|FORZA ITALIA|LEGA|NOI MODERATI|UNIONE DI CENTRO|UDC|CENTRO[ -]?DESTRA)\b/
const LEFT = /\b(?:PARTITO DEMOCRATICO|PD|MOVIMENTO 5 STELLE|M5S|ALLEANZA VERDI E SINISTRA|AVS|EUROPA VERDE|SINISTRA ITALIANA|RIFONDAZIONE COMUNISTA|CENTRO[ -]?SINISTRA)\b/

/** Dalle liste collegate al sindaco: un partito di un solo schieramento lo dice, altrimenti è civica. */
export function politicalSide(lists: string): PoliticalSide {
  const text = lists.toUpperCase().replace(/[’`]/g, '\'')
  const right = RIGHT.test(text)
  const left = LEFT.test(text)
  if (right === left) return 'civica'
  return right ? 'centrodestra' : 'centrosinistra'
}

const GRAVE: Record<string, string> = { A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' }

/** L'Anagrafe scrive le vocali accentate con l'apostrofo: CARTENI' è Cartenì. */
export function accented(name: string): string {
  return name.replace(/([AEIOU])'(?=\s|$)/g, (_, v: string) => GRAVE[v]!)
}

/** Lo stesso nome in due ordini o grafie: «Cartenì Roberto» e «Roberto Carteni'». */
export function personKey(name: string): string {
  return name.split(/\s+/).map(nameKey).filter(Boolean).sort().join(' ')
}

/** GG/MM/AAAA in AAAA-MM-GG. */
function isoDate(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

const ROLE_ORDER = ['Sindaco', 'Commissario', 'Vicesindaco', 'Assessore']
const rank = (role: string) => ROLE_ORDER.findIndex(r => role.startsWith(r))

/** Solo chi governa: sindaco o commissario, vicesindaco e assessori. I consiglieri no. */
function contactRole(carica: string, incarico: string): string | null {
  if (carica === 'Sindaco') return 'Sindaco'
  if (carica.startsWith('Commissario')) return carica
  if (/vice ?sindaco/i.test(`${carica} ${incarico}`)) return 'Vicesindaco'
  if (carica.startsWith('Assessore')) return 'Assessore'
  return null
}

// Nella categoria L6 ci sono anche unioni e consorzi; Roma si chiama Roma Capitale.
const COMUNE_ENTE = /^(?:comune\b|roma capitale$)/i

interface IstatComune {
  code: string
  name: string
  province: string
  regionKey: string
}

interface IpaEnte {
  address: string
  website: string | null
  pec: string | null
}

type FoundComune = FoundCompany & { contacts: FoundContact[] }

async function download(fetcher: Fetcher, url: string, label: string, encoding = 'utf-8'): Promise<string> {
  const res = await fetchOk(fetcher, url, {}, label, 180_000)
  return new TextDecoder(encoding).decode(await res.arrayBuffer())
}

export async function searchComuni(query: Extract<SegmentQuery, { source: 'it_comuni' }>, fetcher: Fetcher = fetch): Promise<SourceResult> {
  const [ammText, istatText, ipaText] = await Promise.all([
    download(fetcher, COMUNI_FILES.amministratori, 'Anagrafe degli amministratori'),
    download(fetcher, COMUNI_FILES.istat, 'Elenco ISTAT dei Comuni', 'windows-1252'),
    download(fetcher, COMUNI_FILES.ipa, 'IndicePA'),
  ])

  const comuni = new Map<string, IstatComune>()
  // Di riserva, per nome solo quando è unico: in Sardegna le sigle delle province sono cambiate.
  const byName = new Map<string, IstatComune | null>()
  const istat = table(istatText, ';', 'Elenco ISTAT dei Comuni', {
    code: 'Codice Comune formato alfanumerico',
    name: 'Denominazione in italiano',
    region: 'Denominazione Regione',
    province: 'Sigla automobilistica',
  })
  for (const r of istat) {
    const comune = { code: r.code, name: r.name, province: r.province, regionKey: nameKey(r.region) }
    const key = nameKey(r.name)
    comuni.set(`${r.province}|${key}`, comune)
    byName.set(key, byName.has(key) ? null : comune)
  }

  const enti = new Map<string, IpaEnte>()
  const ipa = table(ipaText, ',', 'IndicePA', {
    istat: 'Codice_comune_ISTAT',
    category: 'Codice_Categoria',
    name: 'Denominazione_ente',
    address: 'Indirizzo',
    cap: 'CAP',
    site: 'Sito_istituzionale',
    mail1: 'Mail1',
    type1: 'Tipo_Mail1',
    mail2: 'Mail2',
    type2: 'Tipo_Mail2',
    mail3: 'Mail3',
    type3: 'Tipo_Mail3',
    mail4: 'Mail4',
    type4: 'Tipo_Mail4',
    mail5: 'Mail5',
    type5: 'Tipo_Mail5',
  })
  for (const r of ipa) {
    if (r.category !== 'L6' || !COMUNE_ENTE.test(r.name)) continue
    const pec = ([1, 2, 3, 4, 5] as const).find(n => r[`type${n}`] === 'Pec' && r[`mail${n}`])
    enti.set(r.istat, {
      address: [r.address, r.cap].filter(Boolean).join(' '),
      website: normalizeWebsite(r.site),
      pec: pec ? r[`mail${pec}`] : null,
    })
  }

  const amm = table(ammText, ';', 'Anagrafe degli amministratori', {
    comune: 'denominazione_comune',
    province: 'sigla_provincia',
    population: 'popolazione_censita',
    surname: 'cognome',
    first: 'nome',
    carica: 'descrizione_carica',
    incarico: 'incarico',
    elected: 'data_elezione',
    since: 'data_entrata_in_carica',
    lists: 'lista_appartenenza',
  })
  const region = query.region ? nameKey(query.region) : null
  const bounded = query.minPopulation !== undefined || query.maxPopulation !== undefined
  const found = new Map<string, FoundComune>()
  for (const r of amm) {
    const key = nameKey(r.comune)
    const comune = comuni.get(`${r.province}|${key}`) ?? byName.get(key)
    if (!comune || (region && !comune.regionKey.startsWith(region))) continue
    // La sigla di ISTAT, non quella dell'Anagrafe, che in Sardegna è ancora la vecchia.
    if (query.province && comune.province !== query.province) continue
    const population = Number(r.population) || null
    if (bounded && (population === null || (query.minPopulation ?? 0) > population || population > (query.maxPopulation ?? Infinity))) continue

    let company = found.get(comune.code)
    if (!company) {
      const ente = enti.get(comune.code)
      company = {
        name: `Comune di ${comune.name}`,
        country: 'IT',
        city: comune.name,
        region: comune.province,
        address: ente?.address ? `${ente.address} ${comune.name}` : null,
        website: ente?.website ?? null,
        phone: null,
        registryId: istatId(comune.code),
        placeId: null,
        sectorCode: '84.11',
        sectorLabel: 'Comune',
        employeesMin: null,
        employeesMax: null,
        foundedAt: null,
        email: ente?.pec ?? null,
        population,
        electedAt: null,
        politicalSide: null,
        source: 'it_comuni',
        // Si scrive agli amministratori, ai loro indirizzi istituzionali.
        legalBasis: 'public_office',
        contacts: [],
      }
      found.set(comune.code, company)
    }

    const role = contactRole(r.carica, r.incarico)
    if (!role) continue
    let lists: string | null = null
    if (role === 'Sindaco') {
      lists = r.lists || null
      company.electedAt = isoDate(r.elected)
      company.politicalSide = politicalSide(r.lists)
    }
    const name = title(accented(`${r.first} ${r.surname}`))
    // La stessa persona compare una riga per carica: si tiene la più alta.
    const same = company.contacts.find(c => c.name === name)
    if (!same) company.contacts.push({ name, role, lists, since: isoDate(r.since) })
    else if (rank(role) < rank(same.role)) Object.assign(same, { role, lists })
  }

  const companies = [...found.values()]
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    .slice(0, query.limit)
  for (const c of companies) c.contacts.sort((a, b) => rank(a.role) - rank(b.role))
  return { companies, paidCalls: 0 }
}
