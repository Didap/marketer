// Markdown delle strategie in HTML: titoli, elenchi (anche annidati), tabelle, grassetto e link http.
// Tutto il testo passa prima dall'escape, così l'HTML scritto da un job resta testo.

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(s: string): string {
  return escape(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Un livello di parentesi nell'indirizzo: https://it.wikipedia.org/wiki/Lecce_(LE).
    .replace(/\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()\s]*\))+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="underline">$1</a>')
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/
const ITEM = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/

/** Un elenco dalla riga i in poi: le righe più rientrate diventano un elenco dentro la voce di sopra. */
function list(lines: string[], i: number): { html: string, next: number } {
  const indent = ITEM.exec(lines[i]!)![1]!.length
  // Un elenco numerato spezzato da paragrafi riparte dal suo numero, non da 1.
  const start = /^\s*(\d+)\./.exec(lines[i]!)?.[1]
  const items: string[] = []
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]!)
    if (!m || m[1]!.length < indent) break
    if (m[1]!.length > indent && items.length) {
      const nested = list(lines, i)
      items[items.length - 1] += nested.html
      i = nested.next
      continue
    }
    items.push(inline(m[2]!))
    i++
  }
  const tag = start ? 'ol' : 'ul'
  return { html: `<${tag}${start && start !== '1' ? ` start="${start}"` : ''} class="my-1 ml-5 ${start ? 'list-decimal' : 'list-disc'} space-y-0.5">${items.map(it => `<li>${it}</li>`).join('')}</${tag}>`, next: i }
}

export function renderMarkdown(md: string): string {
  const out: string[] = []
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = Math.min(heading[1]!.length + 1, 4)
      out.push(`<h${level} class="mt-4 mb-1 font-semibold">${inline(heading[2]!)}</h${level}>`)
      i++
    }
    else if (/^\s*\|/.test(line) && SEPARATOR.test(lines[i + 1] ?? '')) {
      const head = cells(line)
      const body: string[][] = []
      for (i += 2; i < lines.length && /^\s*\|/.test(lines[i]!); i++) body.push(cells(lines[i]!))
      out.push(`<table class="my-2 w-full text-sm"><thead><tr>${head.map(c => `<th class="border-b border-default p-1 text-left">${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td class="border-b border-default p-1 align-top">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
    }
    else if (ITEM.test(line)) {
      const { html, next } = list(lines, i)
      out.push(html)
      i = next
    }
    else {
      if (line.trim()) out.push(`<p class="my-1">${inline(line)}</p>`)
      i++
    }
  }
  return out.join('\n')
}

/** Le sezioni di un testo, divise ai titoli di secondo livello; quello che sta prima del primo titolo è «In breve». */
export function markdownSections(md: string): { title: string, body: string }[] {
  const parts = md.replace(/\r\n?/g, '\n').split(/^##[ \t]+/m)
  const lead = parts.shift()!.trim()
  return [
    ...(lead ? [{ title: 'In breve', body: lead }] : []),
    ...parts.map((part) => {
      const [title, ...rest] = part.split('\n')
      return { title: title!.trim(), body: rest.join('\n').trim() }
    }),
  ]
}
