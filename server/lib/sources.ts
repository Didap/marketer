import type { LegalBasis, Market, PoliticalSide, ProspectSource, SegmentQuery } from '../db/schema'
import { openapiToken, placesKey } from './env'

// Le fonti dei prospect. Ognuna traduce i suoi risultati in un'azienda trovata, sempre della stessa forma.
// Places e OpenAPI.it sono a pagamento: ogni chiamata si conta.

export class SourceError extends Error {}

export interface FoundCompany {
  name: string
  country: string
  city: string | null
  region: string | null
  address: string | null
  website: string | null
  phone: string | null
  registryId: string | null
  placeId: string | null
  sectorCode: string | null
  sectorLabel: string | null
  employeesMin: number | null
  employeesMax: number | null
  foundedAt: string | null
  source: ProspectSource
  // Solo le fonti che li conoscono: i Comuni.
  email?: string | null
  population?: number | null
  electedAt?: string | null
  politicalSide?: PoliticalSide | null
  legalBasis?: LegalBasis
  /** Le persone da contattare: sostituiscono quelle salvate dalla stessa fonte. */
  contacts?: FoundContact[]
}

export interface FoundContact {
  name: string
  role: string
  lists: string | null
  since: string | null
}

export interface SourceResult {
  companies: FoundCompany[]
  paidCalls: number
}

export type Fetcher = typeof fetch

/** Quali fonti si possono usare adesso: le altre aspettano la chiave in .env. */
export function sourcesAvailable(): Record<Exclude<ProspectSource, 'manual'>, boolean> {
  return { places: placesKey() !== '', it_registry: openapiToken() !== '', fr_registry: true, it_comuni: true }
}

/** Pagine social e vetrine: non sono il sito dell'azienda, e non si possono analizzare. */
const NOT_A_SITE = /(^|\.)((facebook|instagram|linkedin|tiktok|twitter|youtube|linktr|whatsapp|google|paginegialle|tripadvisor|booking|thefork|treatwell)\.[a-z.]+|x\.com|wa\.me|business\.site)$/

/** Origine del sito (https://dominio), o null se non è un sito vero. */
export function normalizeWebsite(raw: string | null | undefined): string | null {
  const text = raw?.trim()
  if (!text) return null
  const withProtocol = /^https?:\/\//i.test(text) ? text : `http://${text}`
  if (!URL.canParse(withProtocol)) return null
  const url = new URL(withProtocol)
  const host = url.hostname.toLowerCase()
  if (!host.includes('.') || NOT_A_SITE.test(host)) return null
  return `${url.protocol}//${host}`
}

/** Dominio senza www, per riconoscere la stessa azienda trovata da due fonti. */
export function siteDomain(website: string | null): string | null {
  if (!website || !URL.canParse(website)) return null
  return new URL(website).hostname.replace(/^www\./, '')
}

/** Toglie gli accenti, per confrontare nomi scritti in modi diversi. */
export const stripAccents = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** Una richiesta che deve riuscire: l'errore dice quale fonte e perché. */
export async function fetchOk(fetcher: Fetcher, url: string, init: RequestInit, label: string, timeoutMs = 30_000): Promise<Response> {
  let res: Response
  try {
    res = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  }
  catch (err) {
    throw new SourceError(`${label}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) throw new SourceError(`${label}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res
}

async function getJson(fetcher: Fetcher, url: string, init: RequestInit, label: string): Promise<any> {
  const text = await (await fetchOk(fetcher, url, init, label)).text()
  try {
    return JSON.parse(text)
  }
  catch {
    throw new SourceError(`${label}: risposta non JSON`)
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Google Maps, con Places API (New).

const PLACES_LANGUAGE: Record<Market, string> = { IT: 'it', ES: 'es', FR: 'fr', US: 'en', CA: 'en', CH: 'de', DE: 'de', AT: 'de' }
const PLACES_FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents',
  'places.internationalPhoneNumber', 'places.websiteUri', 'places.primaryType', 'places.primaryTypeDisplayName',
  'places.businessStatus', 'nextPageToken',
].join(',')

interface Place {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  addressComponents?: { shortText: string, longText: string, types: string[] }[]
  internationalPhoneNumber?: string
  websiteUri?: string
  primaryType?: string
  primaryTypeDisplayName?: { text: string }
  businessStatus?: string
}

function placeToCompany(place: Place, market: Market): FoundCompany {
  const part = (type: string) => place.addressComponents?.find(c => c.types.includes(type))
  return {
    name: place.displayName?.text ?? place.id,
    country: part('country')?.shortText ?? market,
    city: part('locality')?.longText ?? part('administrative_area_level_3')?.longText ?? null,
    region: part('administrative_area_level_2')?.shortText ?? part('administrative_area_level_1')?.shortText ?? null,
    address: place.formattedAddress ?? null,
    website: normalizeWebsite(place.websiteUri),
    phone: place.internationalPhoneNumber ?? null,
    registryId: null,
    placeId: place.id,
    sectorCode: place.primaryType ?? null,
    sectorLabel: place.primaryTypeDisplayName?.text ?? null,
    employeesMin: null,
    employeesMax: null,
    foundedAt: null,
    source: 'places',
  }
}

async function placesPage(fetcher: Fetcher, body: object): Promise<{ places?: Place[], nextPageToken?: string }> {
  return getJson(fetcher, 'https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': placesKey(), 'x-goog-fieldmask': PLACES_FIELDS },
    body: JSON.stringify(body),
  }, 'Google Places')
}

export async function searchPlaces(query: Extract<SegmentQuery, { source: 'places' }>, market: Market, fetcher: Fetcher = fetch): Promise<SourceResult> {
  if (!placesKey()) throw new SourceError('Google Places è spento: manca GOOGLE_PLACES_API_KEY in .env')
  const companies: FoundCompany[] = []
  let paidCalls = 0
  let pageToken: string | undefined
  do {
    const page = await placesPage(fetcher, {
      textQuery: query.text,
      languageCode: PLACES_LANGUAGE[market],
      regionCode: market,
      pageSize: Math.min(20, query.limit - companies.length),
      pageToken,
    })
    paidCalls++
    for (const place of page.places ?? []) {
      if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') continue
      companies.push(placeToCompany(place, market))
    }
    pageToken = page.nextPageToken
  } while (pageToken && companies.length < query.limit)
  return { companies: companies.slice(0, query.limit), paidCalls }
}

const LEGAL_FORMS = new Set(['srl', 'srls', 'spa', 'sas', 'snc', 'sapa', 'sarl', 'sasu', 'eurl', 'sa', 'sl', 'slu', 'gmbh', 'ag', 'kg', 'llc', 'inc', 'ltd', 'corp', 'societa', 'cooperativa', 'soc', 'coop', 'di', 'e', 'de', 'la', 'le', 'il', 'the', 'and', 'et'])

function nameTokens(name: string): Set<string> {
  return new Set(stripAccents(name).toLowerCase().split(/[^a-z0-9]+/)
    .filter(t => t.length > 2 && !LEGAL_FORMS.has(t)))
}

/** Lo stesso nome a parte la forma giuridica: almeno metà delle parole del nome cercato. */
export function sameBusiness(wanted: string, found: string): boolean {
  const a = nameTokens(wanted)
  const b = nameTokens(found)
  if (!a.size) return false
  const shared = [...a].filter(t => b.has(t)).length
  return shared / a.size >= 0.5
}

/** Cerca su Google Maps sito e telefono di un'azienda trovata in un registro. Una chiamata a pagamento. */
export async function findOnPlaces(company: Pick<FoundCompany, 'name' | 'city'>, market: Market, fetcher: Fetcher = fetch): Promise<Place | null> {
  const page = await placesPage(fetcher, {
    textQuery: [company.name, company.city].filter(Boolean).join(' '),
    languageCode: PLACES_LANGUAGE[market],
    regionCode: market,
    pageSize: 1,
  })
  const place = page.places?.[0]
  return place && sameBusiness(company.name, place.displayName?.text ?? '') ? place : null
}

export function enrichFromPlace(company: FoundCompany, place: Place): FoundCompany {
  return {
    ...company,
    placeId: place.id,
    website: company.website ?? normalizeWebsite(place.websiteUri),
    phone: company.phone ?? place.internationalPhoneNumber ?? null,
  }
}

// Registro Imprese, con l'API Company di OpenAPI.it.

interface OpenapiCompany {
  id: string
  companyName: string
  vatCode?: string
  taxCode?: string
  registrationDate?: string
  address?: { registeredOffice?: { streetName?: string, zipCode?: string, town?: string, province?: string } }
}

export function title(text: string): string {
  return text.toLowerCase().replace(/(^|[\s'(.-])\p{L}/gu, m => m.toUpperCase())
}

export async function searchItRegistry(query: Extract<SegmentQuery, { source: 'it_registry' }>, fetcher: Fetcher = fetch): Promise<SourceResult> {
  if (!openapiToken()) throw new SourceError('Il Registro Imprese è spento: manca OPENAPI_COMPANY_TOKEN in .env')
  const params = new URLSearchParams({ atecoCode: query.atecoCode, activityStatus: 'ATTIVA', dataEnrichment: 'start', limit: String(query.limit) })
  if (query.province) params.set('province', query.province)
  if (query.minEmployees !== undefined) params.set('minEmployees', String(query.minEmployees))
  if (query.maxEmployees !== undefined) params.set('maxEmployees', String(query.maxEmployees))
  const body = await getJson(fetcher, `https://company.openapi.com/IT-search?${params}`, {
    headers: { authorization: `Bearer ${openapiToken()}` },
  }, 'OpenAPI.it')
  if (body.success === false) throw new SourceError(`OpenAPI.it: ${body.message || 'ricerca rifiutata'}`)
  const companies = ((body.data ?? []) as OpenapiCompany[]).map((c): FoundCompany => {
    const office = c.address?.registeredOffice
    const id = c.vatCode || c.taxCode || c.id
    return {
      name: c.companyName,
      country: 'IT',
      city: office?.town ? title(office.town) : null,
      region: office?.province ?? null,
      address: office ? [office.streetName, office.zipCode, office.town, office.province].filter(Boolean).join(' ') : null,
      website: null,
      phone: null,
      registryId: `IT:${id}`,
      placeId: null,
      sectorCode: query.atecoCode,
      sectorLabel: null,
      employeesMin: query.minEmployees ?? null,
      employeesMax: query.maxEmployees ?? null,
      foundedAt: c.registrationDate ?? null,
      source: 'it_registry',
    }
  })
  return { companies, paidCalls: 1 }
}

// Francia, con l'API Recherche d'entreprises (gratuita, 7 richieste al secondo).

/** Fasce di dipendenti dell'INSEE. */
const FR_HEADCOUNT: Record<string, [number, number | null]> = {
  '00': [0, 0], '01': [1, 2], '02': [3, 5], '03': [6, 9], '11': [10, 19], '12': [20, 49], '21': [50, 99],
  '22': [100, 199], '31': [200, 249], '32': [250, 499], '41': [500, 999], '42': [1000, 1999],
  '51': [2000, 4999], '52': [5000, 9999], '53': [10000, null],
}

interface FrCompany {
  siren: string
  nom_complet: string
  nom_raison_sociale: string | null
  nature_juridique: string | null
  activite_principale: string | null
  date_creation: string | null
  tranche_effectif_salarie: string | null
  siege?: { adresse?: string, libelle_commune?: string, departement?: string, activite_principale?: string }
}

/** I codici delle fasce che toccano l'intervallo di dipendenti chiesto. */
export function frHeadcountCodes(min: number | undefined, max: number | undefined): string[] {
  if (min === undefined && max === undefined) return []
  return Object.entries(FR_HEADCOUNT)
    .filter(([, [lo, hi]]) => (hi ?? Infinity) >= (min ?? 0) && lo <= (max ?? Infinity))
    .map(([code]) => code)
}

/** Pagine lette al massimo: le aziende con la sede fuori dal dipartimento si scartano, e possono essere tante. */
const FR_MAX_PAGES = 10

export async function searchFrRegistry(query: Extract<SegmentQuery, { source: 'fr_registry' }>, fetcher: Fetcher = fetch): Promise<SourceResult> {
  const companies: FoundCompany[] = []
  const headcount = frHeadcountCodes(query.minEmployees, query.maxEmployees)
  for (let page = 1; companies.length < query.limit && page <= FR_MAX_PAGES; page++) {
    const params = new URLSearchParams({ activite_principale: query.naf, etat_administratif: 'A', per_page: '25', page: String(page) })
    if (query.departement) params.set('departement', query.departement)
    if (headcount.length) params.set('tranche_effectif_salarie', headcount.join(','))
    const body = await getJson(fetcher, `https://recherche-entreprises.api.gouv.fr/search?${params}`, {}, 'Recherche d\'entreprises')
    for (const c of (body.results ?? []) as FrCompany[]) {
      // Gli imprenditori individuali sono persone fisiche: solo inbound o con consenso.
      if (c.nature_juridique?.startsWith('1')) continue
      // Il filtro del dipartimento prende anche le filiali: conta la sede, dove si decide.
      if (query.departement && c.siege?.departement !== query.departement) continue
      const headcount = c.tranche_effectif_salarie ? FR_HEADCOUNT[c.tranche_effectif_salarie] : undefined
      companies.push({
        name: c.nom_raison_sociale ?? c.nom_complet,
        country: 'FR',
        city: c.siege?.libelle_commune ? title(c.siege.libelle_commune) : null,
        region: c.siege?.departement ?? null,
        address: c.siege?.adresse ?? null,
        website: null,
        phone: null,
        registryId: `FR:${c.siren}`,
        placeId: null,
        sectorCode: c.activite_principale ?? query.naf,
        sectorLabel: null,
        employeesMin: headcount?.[0] ?? null,
        employeesMax: headcount?.[1] ?? null,
        foundedAt: c.date_creation,
        source: 'fr_registry',
      })
    }
    if (page >= (body.total_pages ?? 0)) break
    await sleep(200)
  }
  return { companies: companies.slice(0, query.limit), paidCalls: 0 }
}
