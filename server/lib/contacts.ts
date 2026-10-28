import { decodeEntities, fetchPage, fetchSite, htmlText, pageLinks } from './audit'
import { nameKey } from './comuni'
import type { Fetcher } from './sources'
import { siteDomain, stripAccents } from './sources'

// Le persone della giunta sul sito del Comune: email istituzionale e deleghe, con la pagina da cui
// vengono. I siti sono fatti in tanti modi: si seguono i link a giunta, sindaco e assessori, e da lì
// le pagine che portano il cognome di qualcuno della giunta.

/** Quello che il sito dice di una persona già nota (id del contatto). */
export interface SitePerson {
  id: number
  name: string
  email: string | null
  delegations: string | null
  sourceUrl: string
}

const MAX_PAGES = 25
const GIUNTA_LINK = /giunta|sindaco|assessor|organi[-_ ]di[-_ ]governo|organi[-_ ]politici|amministratori/i
// Notizie, atti e archivi parlano della giunta ma non sono le sue pagine, e consumano il limite.
const NOT_A_PROFILE = /notizi|news|comunicat|eventi|delibere|determin|albo|atti\b|documenti|\.pdf$/i
// Caselle dell'ente, non di una persona: per scrivere a qualcuno della giunta non servono.
const GENERIC = /^(?:protocollo|info|urp|ufficio|segreteria|servizi|tributi|polizia|comune|webmaster|noreply|no-reply|posta|redazione|staff)\b/i
const PEC = /(?:^|[@.])(?:pec|legalmail|postacert|cert)\b|pec\.[a-z]+$/i
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi

/** Il cognome: l'Anagrafe dà prima il nome. */
const surname = (name: string) => name.split(/\s+/).at(-1)!

/** Un percorso leggibile; i vecchi siti hanno escape Latin-1 che decodeURIComponent rifiuta. */
function readablePath(url: string): string {
  const path = new URL(url).pathname
  try {
    return decodeURIComponent(path)
  }
  catch {
    return path
  }
}

/** Email in chiaro, nei mailto, scritte con [at] e quelle che Joomla nasconde agli spambot (il browser le rimonta da pezzi). */
export function pageEmails(html: string): string[] {
  const found = new Set<string>()
  const pieces = (code: string) => decodeEntities([...code.matchAll(/'([^']*)'/g)].map(x => x[1]).join(''))
  for (const m of html.matchAll(/var (addy[0-9a-f]+) = ((?:\s*'[^']*'\s*\+?)+);\s*\1 = \1((?:\s*\+\s*'[^']*')+);/g)) {
    found.add(pieces(m[2]! + m[3]!))
  }
  const text = decodeEntities(html).replace(/\s*[[(]at[\])]\s*/gi, '@')
  for (const m of text.matchAll(EMAIL)) found.add(m[0])
  const all = [...found].map(e => e.toLowerCase()).filter(e => e.match(EMAIL)?.[0] === e)
  // Una copia troncata accanto all'indirizzo intero (sindaco@comune.x.le e sindaco@comune.x.le.it) non è un indirizzo.
  return all.filter(e => !all.some(o => o !== e && o.startsWith(e)))
}

/** La casella di una persona: non generica, non PEC, con il suo cognome (sindaco@ per il sindaco, sulla sua pagina). */
export function personalEmail(emails: string[], name: string, role: string, ownPage: boolean): string | null {
  const last = nameKey(surname(name))
  // Un cognome corto da solo è dentro troppe parole: allora serve anche il nome.
  const needle = last.length >= 3 ? last : nameKey(name)
  const own = emails.filter(e => !GENERIC.test(e) && !PEC.test(e))
  const named = own.find(e => nameKey(e.split('@')[0]!).includes(needle))
  if (named || !ownPage) return named ?? null
  return role === 'Sindaco' ? own.find(e => e.startsWith('sindaco@')) ?? null : null
}

/** Le deleghe dopo «Deleghe», fino alla sezione successiva. */
export function delegations(text: string): string | null {
  const m = /Deleghe(?: correnti)?\s*:?\s*(.{2,600}?)(?=\s(?:Recapiti|Curriculum|Documenti|Gruppo politico|Indirizzo|Email|Telefono|Assessori|Vicesindaco|Consiglier)|$)/i.exec(text)
  return m ? m[1]!.replace(/^Il Sindaco mantiene la titolarità delle seguenti deleghe:\s*/i, '').trim() : null
}

/** Una pagina letta una volta sola: testo visibile, email e chiave del titolo. */
interface Page {
  url: string
  text: string
  emails: string[]
  /** Indirizzo, <title> e <h1>, per riconoscere la pagina di una persona. */
  heading: string
}

function readPage(url: string, html: string): Page {
  const visible = html.replace(/<(script|style|nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ')
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ''
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? ''
  return { url, text: htmlText(visible).normalize('NFC'), emails: pageEmails(html), heading: nameKey(htmlText(`${readablePath(url)} ${title} ${h1}`)) }
}

/** La pagina è di questa persona: tutte le parti del nome nell'indirizzo, nel titolo o nel primo titolo. */
function about(name: string, page: Page): boolean {
  const tokens = name.split(/\s+/).map(nameKey).filter(t => t.length >= 2)
  return tokens.length > 0 && tokens.every(t => page.heading.includes(t))
}

/** Il pezzo di una pagina con tutta la giunta che riguarda la persona: dal suo cognome a quello di chi viene dopo. */
function section(text: string, person: string, everyone: string[]): string | null {
  // Su testo NFC togliere gli accenti non cambia la lunghezza: le posizioni valgono anche sull'originale.
  const folded = stripAccents(text).toUpperCase()
  const at = (who: string) => folded.search(new RegExp(`\\b${stripAccents(surname(who)).toUpperCase().replace(/[^A-Z0-9]/g, '.')}\\b`))
  const start = at(person)
  if (start < 0) return null
  const next = everyone.filter(p => p !== person).map(at).filter(i => i > start).sort((a, b) => a - b)[0]
  return text.slice(start, next ?? start + 700)
}

/** Sindaco e assessori sul sito: per ognuno la pagina sua se c'è, l'email personale e le deleghe. */
export async function findGiunta(website: string, people: { id: number, name: string, role: string }[], fetcher: Fetcher = fetch): Promise<SitePerson[]> {
  const home = await fetchSite(website, fetcher)
  const domain = siteDomain(home.finalUrl)
  const surnames = people.map(p => nameKey(surname(p.name))).filter(s => s.length >= 4)
  const follow = (url: string, text: string) => {
    if (siteDomain(url) !== domain || NOT_A_PROFILE.test(readablePath(url))) return false
    const hay = nameKey(`${readablePath(url)} ${text}`)
    return GIUNTA_LINK.test(`${url} ${text}`) || surnames.some(s => hay.includes(s))
  }
  const pages: Page[] = []
  const seen = new Set([home.finalUrl])
  const queue = pageLinks(home.html, home.finalUrl).filter(l => follow(l.url, l.text)).map(l => l.url)
  for (const url of queue) seen.add(url)
  // Ci si ferma quando ognuno ha la sua pagina, o al limite.
  while (queue.length && pages.length < MAX_PAGES && !people.every(p => pages.some(page => about(p.name, page)))) {
    const url = queue.shift()!
    const fetched = await fetchPage(url, fetcher).catch(() => null)
    if (!fetched) continue
    pages.push(readPage(url, fetched.html))
    for (const l of pageLinks(fetched.html, fetched.finalUrl)) {
      if (!seen.has(l.url) && follow(l.url, l.text)) {
        seen.add(l.url)
        queue.push(l.url)
      }
    }
  }

  const lists = pages.filter(p => GIUNTA_LINK.test(p.url))
  const names = people.map(p => p.name)
  return people.map((person) => {
    const own = pages.find(page => about(person.name, page))
    if (own) {
      return { id: person.id, name: person.name, email: personalEmail(own.emails, person.name, person.role, true), delegations: delegations(own.text), sourceUrl: own.url }
    }
    // Senza una pagina sua: la prima pagina della giunta che lo nomina, dal suo cognome a quello di chi viene dopo.
    for (const page of lists) {
      const part = section(page.text, person.name, names)
      if (part) return { id: person.id, name: person.name, email: personalEmail(page.emails, person.name, person.role, false), delegations: delegations(part), sourceUrl: page.url }
    }
    return { id: person.id, name: person.name, email: null, delegations: null, sourceUrl: home.finalUrl }
  })
}

/** Perché quella persona conta per CityFix, dalle deleghe. */
export function cityfixAngle(delegationsText: string | null): string[] {
  const d = delegationsText ?? ''
  return [
    /lavori pubblici|manutenz|arredo urbano|verde pubblico|decoro|viabilit|strade|patrimonio/i.test(d) && 'interventi sul territorio',
    /innovazione|agenda digitale|digitale|smart city/i.test(d) && 'innovazione e digitale',
    /risorse comunitarie|fondi|bandi|finanziament|pnrr|bilancio/i.test(d) && 'fondi e bilancio',
    /ambiente|igiene urbana|rifiuti/i.test(d) && 'ambiente e rifiuti',
    /polizia locale|sicurezza urbana/i.test(d) && 'sicurezza urbana',
  ].filter((x): x is string => !!x)
}
