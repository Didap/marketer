import type { AuditIssue, StackItem } from '../db/schema'
import type { Fetcher } from './sources'

// L'audit del sito di un prospect, senza LLM: verifiche sull'HTML della home e punteggi Lighthouse.
// I difetti escono già scritti in italiano, concreti, pronti per diventare l'aggancio di un messaggio.

export class SiteError extends Error {}

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const MAX_HTML = 2_000_000

export interface SiteCheck {
  finalUrl: string
  https: boolean
  /** http:// porta su https://. null se non si è potuto verificare. */
  httpsRedirect: boolean | null
  certError: boolean
  html: string
  headers: Headers
}

function errorCode(err: unknown): string {
  const cause = (err as { cause?: { code?: string } })?.cause
  return cause?.code ?? (err instanceof Error ? err.message : String(err))
}

async function get(fetcher: Fetcher, url: string, redirect: RequestRedirect = 'follow'): Promise<Response> {
  return fetcher(url, { redirect, headers: { 'user-agent': USER_AGENT, 'accept-language': 'it,en;q=0.8' }, signal: AbortSignal.timeout(20_000) })
}

/**
 * Apre la home in https, e se non va in http, con e senza www (capita che solo una delle due
 * risponda); poi guarda se http porta su https.
 */
export async function fetchSite(website: string, fetcher: Fetcher = fetch): Promise<SiteCheck> {
  const host = new URL(website).hostname
  const hosts = host.startsWith('www.') ? [host, host.slice(4)] : [host, `www.${host}`]
  let res: Response | null = null
  let certError = false
  let lastError = ''
  for (const url of [...hosts.map(h => `https://${h}/`), ...hosts.map(h => `http://${h}/`)]) {
    try {
      const attempt = await get(fetcher, url)
      if (attempt.status < 400) {
        res = attempt
        break
      }
      lastError = `HTTP ${attempt.status}`
    }
    catch (err) {
      const code = errorCode(err)
      if (url.startsWith('https:') && /CERT|SSL|TLS/i.test(code)) certError = true
      lastError = code
    }
  }
  if (!res) throw new SiteError(`Il sito non risponde (${lastError})`)
  const finalUrl = res.url || `https://${host}/`
  const https = finalUrl.startsWith('https:')
  // Un certificato rotto su una variante conta solo se il sito non si apre in https da nessuna parte.
  certError &&= !https
  const html = (await res.text()).slice(0, MAX_HTML)

  let httpsRedirect: boolean | null = null
  if (https) {
    try {
      const plain = await get(fetcher, `http://${new URL(finalUrl).hostname}/`, 'manual')
      const location = plain.headers.get('location') ?? ''
      httpsRedirect = plain.status >= 300 && plain.status < 400 ? location.startsWith('https:') : false
    }
    catch {}
  }
  return { finalUrl, https, httpsRedirect, certError, html, headers: res.headers }
}

// Le entità con nome che si trovano sui siti italiani; i trattini diventano trattini semplici.
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', rsquo: '\'', lsquo: '\'', ldquo: '"', rdquo: '"',
  laquo: '«', raquo: '»', hellip: '...', ndash: '-', mdash: '-', euro: '€', deg: '°', copy: '©',
  agrave: 'à', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò', oacute: 'ó', ugrave: 'ù',
  Agrave: 'À', Egrave: 'È', Eacute: 'É', Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù',
}

/** Il testo di un frammento HTML con le entità sciolte (&#64; è @). */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? m)
}

/** Il testo di un frammento HTML: senza tag, con le entità sciolte e gli spazi compattati. */
export function htmlText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** I link http e https di una pagina, con il testo senza tag. */
export function pageLinks(html: string, base: string): { url: string, text: string }[] {
  const out: { url: string, text: string }[] = []
  for (const [, raw, label] of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    // Gli href hanno le entità dell'HTML: ?option=a&amp;view=b è ?option=a&view=b.
    const href = decodeEntities(raw!).trim()
    if (!URL.canParse(href, base)) continue
    const url = new URL(href, base)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
    url.hash = ''
    out.push({ url: url.href, text: htmlText(label!) })
  }
  return out
}

/** Una pagina qualsiasi del sito, per seguire un link dalla home. */
export async function fetchPage(url: string, fetcher: Fetcher = fetch): Promise<{ finalUrl: string, html: string }> {
  const res = await get(fetcher, url)
  if (res.status >= 400) throw new SiteError(`HTTP ${res.status}`)
  // Curriculum, PDF e allegati: si scaricherebbero interi per niente.
  if (!/html/i.test(res.headers.get('content-type') ?? 'text/html')) {
    await res.body?.cancel()
    throw new SiteError('Non è una pagina HTML')
  }
  return { finalUrl: res.url || url, html: (await res.text()).slice(0, MAX_HTML) }
}

/** true se la versione a è più vecchia di b (confronto numero per numero). */
export function olderThan(a: string, b: string): boolean {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d < 0
  }
  return false
}

interface StackRule {
  name: string
  /** Riconosce la tecnologia; il primo gruppo, se c'è, è la versione. */
  match: RegExp[]
  /** Più vecchia di questa: non riceve più aggiornamenti di sicurezza (o li ha fermi da tempo). */
  outdatedBelow?: string
  severity?: 2 | 3
  /** Uno strumento con cui i cittadini segnalano al Comune: chi ne ha già uno ha meno bisogno di CityFix. */
  reporting?: true
}

// Soglie aggiornate a ottobre 2026: vanno riviste quando escono le versioni nuove.
const STACK_RULES: StackRule[] = [
  { name: 'WordPress', match: [/<meta[^>]+generator[^>]+WordPress (\d+\.\d+(?:\.\d+)?)/i, /wp-includes\/[^"']+\?ver=(\d+\.\d+(?:\.\d+)?)/i, /wp-content|wp-includes/i], outdatedBelow: '6.0', severity: 3 },
  { name: 'Joomla', match: [/<meta[^>]+generator[^>]+Joomla! (\d+\.\d+)/i, /\/media\/(jui)\//i, /<meta[^>]+generator[^>]+Joomla/i], outdatedBelow: '4.0', severity: 3 },
  { name: 'Drupal', match: [/<meta[^>]+generator[^>]+Drupal (\d+)/i, /Drupal\.settings/, /drupalSettings|\/sites\/default\/files\//i], outdatedBelow: '10', severity: 3 },
  { name: 'Magento', match: [/Mage\.Cookies|\/skin\/frontend\//, /mage\/cookies|Magento_/i], severity: 3 },
  { name: 'PrestaShop', match: [/<meta[^>]+generator[^>]+PrestaShop/i, /prestashop/i] },
  { name: 'TYPO3', match: [/<meta[^>]+generator[^>]+TYPO3 CMS/i] },
  { name: 'Wix', match: [/static\.wixstatic\.com|wix-code|X-Wix/i] },
  { name: 'Squarespace', match: [/static1\.squarespace\.com|Squarespace/] },
  { name: 'Shopify', match: [/cdn\.shopify\.com|Shopify\.theme/] },
  { name: 'Webflow', match: [/webflow\.(?:js|css|com)|data-wf-page/i] },
  { name: 'Jimdo', match: [/jimdo|jimstatic/i] },
  { name: 'GoDaddy Website Builder', match: [/img1\.wsimg\.com/i] },
  { name: 'Next.js', match: [/__NEXT_DATA__|\/_next\/static\//] },
  { name: 'Nuxt', match: [/__NUXT__|\/_nuxt\//] },
  { name: 'jQuery', match: [/jquery[-.]?(\d+\.\d+\.\d+)(?:\.min)?\.js/i, /jquery(?:\.min)?\.js\?ver=(\d+\.\d+\.\d+)/i, /jquery(?:\.min)?\.js/i], outdatedBelow: '3.5.0', severity: 2 },
  { name: 'Bootstrap', match: [/bootstrap[-.]?(\d+\.\d+\.\d+)(?:\.min)?\.(?:css|js)/i, /bootstrap(?:\.min)?\.(?:css|js)\?ver=(\d+\.\d+(?:\.\d+)?)/i] , outdatedBelow: '4.0', severity: 2 },
  { name: 'Flash', match: [/\.swf["'?]|application\/x-shockwave-flash/i], outdatedBelow: '999', severity: 3 },
  { name: 'ComuniChiamo', match: [/comuni-?chiamo/i], reporting: true },
  // Non la parola latina, che compare nella storia di tanti Comuni: l'app.
  { name: 'Municipium', match: [/municipium ?app|app ?municipium|municipiumapp/i], reporting: true },
  { name: 'ePart', match: [/\bepart\b/i], reporting: true },
  { name: 'Decoro Urbano', match: [/decorourbano\./i], reporting: true },
  // Municipium fa le segnalazioni su /it/new-issue: quel percorso non basta a dire OpenSegnalazioni.
  { name: 'OpenSegnalazioni', match: [/opensegnalazioni/i], reporting: true },
  { name: 'BaRisolve', match: [/barisolve/i], reporting: true },
]

/** I nomi dello stack che sono strumenti di segnalazione per i Comuni. */
export const REPORTING_TOOLS = new Set(STACK_RULES.filter(r => r.reporting).map(r => r.name))

export function detectStack(html: string, headers: Headers): StackItem[] {
  const found: StackItem[] = []
  for (const rule of STACK_RULES) {
    let hit: RegExpMatchArray | null = null
    for (const re of rule.match) {
      hit = html.match(re)
      if (hit) break
    }
    if (!hit) continue
    // Joomla 3 si riconosce dalla cartella media/jui, Drupal 7 da Drupal.settings.
    let version = hit[1] === 'jui' ? '3' : hit[1] ?? null
    if (rule.name === 'Drupal' && !version && /Drupal\.settings/.test(html)) version = '7'
    const outdated = rule.name === 'Flash' || (!!rule.outdatedBelow && !!version && olderThan(version, rule.outdatedBelow))
      || (rule.name === 'Magento' && /Mage\.Cookies|\/skin\/frontend\//.test(html))
    found.push({ name: rule.name === 'Magento' && outdated ? 'Magento 1' : rule.name, version, outdated })
  }
  const php = headers.get('x-powered-by')?.match(/PHP\/(\d+\.\d+)/)
  if (php) found.push({ name: 'PHP', version: php[1]!, outdated: olderThan(php[1]!, '8.2') })
  const apache = headers.get('server')?.match(/Apache\/(\d+\.\d+)/)
  if (apache) found.push({ name: 'Apache', version: apache[1]!, outdated: olderThan(apache[1]!, '2.4') })
  return found
}

const BOOKING = /calendly\.com|cal\.com\/|acuityscheduling|simplybook|setmore|youcanbook\.me|booksy|fresha|treatwell|uala\.it|planity|doctolib|miodottore|docplanner|thefork|lafourchette|quandoo|opentable|resy\.com|zenchef|sevenrooms|bookingkit|prenota(?:zion[ei]|\s+ora|\s+online)|r[ée]server en ligne|reservar|book (?:now|online|an appointment)/i
const FORM_TOOLS = /wpcf7|wpforms|typeform\.com|hsforms|jotform|tally\.so|formspree|gravityforms|elementor-form|ninja-forms/i

export interface HtmlAnalysis {
  mobile: boolean
  hasForm: boolean
  hasBooking: boolean
  title: string | null
  description: string | null
  copyrightYear: number | null
  stack: StackItem[]
}

export function analyzeHtml(html: string, headers: Headers): HtmlAnalysis {
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || null
  const description = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]?.trim()
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i)?.[1]?.trim()
    || null
  const years = [...html.matchAll(/(?:©|&copy;|&#169;|copyright)\s*(?:\d{4}\s*[-/]\s*)?((?:19|20)\d{2})/gi)].map(m => Number(m[1]))
  return {
    mobile: /<meta[^>]+name=["']viewport["']/i.test(html),
    hasForm: /<form[\s\S]{0,5000}?(?:<textarea|type=["']?email)/i.test(html) || FORM_TOOLS.test(html),
    hasBooking: BOOKING.test(html),
    title,
    description,
    copyrightYear: years.length ? Math.max(...years) : null,
    stack: detectStack(html, headers),
  }
}

export interface LighthouseScores {
  performance: number | null
  accessibility: number | null
  seo: number | null
  bestPractices: number | null
  lcpMs: number | null
}

function stackIssue(item: StackItem, severity: 2 | 3): AuditIssue {
  const what = item.version ? `${item.name} ${item.version}` : item.name
  if (item.name === 'Flash') return { code: 'flash', severity: 3, text: 'Usa ancora Flash, che i browser non aprono più dal 2021: quella parte del sito non si vede' }
  return severity === 3
    ? { code: `outdated_${item.name.toLowerCase().replace(/\W+/g, '_')}`, severity, text: `Gira su ${what}, una versione che non riceve più aggiornamenti di sicurezza` }
    : { code: `outdated_${item.name.toLowerCase().replace(/\W+/g, '_')}`, severity, text: `Usa ${what}, una versione vecchia con problemi di sicurezza noti` }
}

/** Tutti i difetti, dal più grave. */
export function buildIssues(site: Pick<SiteCheck, 'https' | 'httpsRedirect' | 'certError'>, page: HtmlAnalysis, lh: LighthouseScores | null, today: Date): AuditIssue[] {
  const issues: AuditIssue[] = []
  const add = (code: string, severity: AuditIssue['severity'], text: string) => issues.push({ code, severity, text })

  if (site.certError) add('bad_certificate', 3, 'Il certificato HTTPS non è valido: chi apre il sito vede un avviso di sicurezza')
  else if (!site.https) add('no_https', 3, 'Il sito non usa HTTPS: Chrome lo segna come «Non sicuro» accanto all\'indirizzo')
  else if (site.httpsRedirect === false) add('no_https_redirect', 2, 'Chi scrive l\'indirizzo senza https resta sulla versione non protetta del sito')

  if (!page.mobile) add('not_mobile', 3, 'Il sito non è pensato per il telefono: su mobile si vede in piccolo e va ingrandito')

  for (const item of page.stack.filter(s => s.outdated)) {
    const rule = STACK_RULES.find(r => item.name.startsWith(r.name))
    issues.push(stackIssue(item, item.name === 'PHP' ? 3 : rule?.severity ?? 2))
  }

  if (lh?.performance != null) {
    const lcp = lh.lcpMs ? `, e il contenuto principale compare dopo ${(lh.lcpMs / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} secondi` : ''
    if (lh.performance < 50) add('slow_mobile', 3, `Su telefono il sito è lento: Google gli dà ${lh.performance} su 100${lcp}`)
    else if (lh.performance < 75) add('slow_mobile', 2, `Su telefono il sito carica piano: Google gli dà ${lh.performance} su 100${lcp}`)
  }
  if (lh?.seo != null && lh.seo < 80) add('weak_seo', 2, `La SEO di base ha delle lacune: Lighthouse le dà ${lh.seo} su 100`)
  if (lh?.accessibility != null && lh.accessibility < 70) add('weak_accessibility', 2, `L'accessibilità è bassa (${lh.accessibility} su 100): chi usa uno screen reader o ingrandisce i testi fa fatica`)
  if (lh?.bestPractices != null && lh.bestPractices < 70) add('weak_best_practices', 1, `Lighthouse segnala errori tecnici nella pagina: ${lh.bestPractices} su 100 per le buone pratiche`)

  if (!page.title) add('no_title', 1, 'La home non ha un titolo: su Google e nelle schede del browser compare l\'indirizzo')
  if (!page.description) add('no_meta_description', 1, 'Manca la descrizione per Google: nei risultati compare un pezzo di testo preso a caso dalla pagina')
  if (page.copyrightYear && page.copyrightYear <= today.getFullYear() - 3) add('stale_copyright', 1, `Il sito sembra fermo: in fondo alla pagina c'è ancora © ${page.copyrightYear}`)
  if (!page.hasForm && !page.hasBooking) add('no_contact_form', 1, 'In home non c\'è un modulo di contatto né di prenotazione: chi vuole scrivere deve cercare l\'email')

  return issues.sort((a, b) => b.severity - a.severity)
}
