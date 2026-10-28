import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { markdownSections, renderMarkdown } from '../app/utils/markdown'
import type { Db } from '../server/db/client'
import { jobs, prospectContacts, prospects } from '../server/db/schema'

const root = mkdtempSync(join(tmpdir(), 'marketer-strategies-'))

beforeAll(() => {
  process.env.MARKETER_DATA_DIR = join(root, 'data')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('strategie', () => {
  let db: Db
  let lib: typeof import('../server/lib/strategies')
  let gallipoli: number
  let lecce: number

  beforeAll(async () => {
    const client = await import('../server/db/client')
    db = client.useDb()
    migrate(db, { migrationsFolder: resolve('drizzle') })
    lib = await import('../server/lib/strategies')
    const add = (name: string) => db.insert(prospects).values({ name, country: 'IT', source: 'it_comuni' }).returning({ id: prospects.id }).get().id
    gallipoli = add('Comune di Gallipoli')
    lecce = add('Comune di Lecce')
  })

  it('una strategia nasce vuota con il suo job, e il prompt porta i verdetti della matrice', () => {
    const { strategy, job } = lib.enqueueStrategy(db, [gallipoli], 'dashboard')
    expect(strategy).toMatchObject({ title: 'Comune di Gallipoli', prospectIds: [gallipoli], status: 'draft', body: '', jobId: job.id })
    expect(job.kind).toBe(lib.STRATEGY_JOB_KIND)
    expect(job.prompt).toContain(`strategyId ${strategy.id}`)
    expect(job.prompt).toMatch(/email: non ammesso \(Italia: l'email a freddo chiede il consenso/)
    expect(job.prompt).toContain('se l\'email non è ammessa dillo')
    expect(job.prompt).not.toContain('Differenze tra i target')
    expect(job.prompt).toContain('contact_linkedin_save')
    expect(job.prompt).toContain('chiamata di 10 minuti')
    expect(() => lib.enqueueStrategy(db, [], 'dashboard')).toThrow(/Nessun target/)
    expect(() => lib.enqueueStrategy(db, [9999], 'dashboard')).toThrow(/non esistono: 9999/)
  })

  it('il job la salva, solo con persone dei suoi target; si ritrova per prospect', () => {
    // A un Comune si scrive come amministratore pubblico, all'indirizzo istituzionale.
    db.update(prospects).set({ legalBasis: 'public_office' }).where(eq(prospects.id, lecce)).run()
    const { strategy, job } = lib.enqueueStrategy(db, [gallipoli, lecce], 'mcp', { title: 'Salento', notes: 'Non citare i Comuni in prova' })
    expect(job.prompt).toContain('Differenze tra i target')
    expect(job.prompt).toContain('Indicazioni di William: Non citare i Comuni in prova')
    expect(job.prompt).toMatch(/Comune di Lecce \(prospect \d+\)\n  - email: ammesso \(Amministratore pubblico: solo il suo indirizzo istituzionale/)
    const body = '## In breve\n' + 'Testo della strategia. '.repeat(12)
    const fields = { strategyId: strategy.id, title: 'Salento', summary: 'Due Comuni del Salento.', body, openingSubject: 'Segnalazioni a {Comune}', openingBody: 'Gentile {Nome}, ...' }
    expect(() => lib.saveStrategy(db, { ...fields, firstContacts: [{ prospectId: 4242, name: 'X', role: 'Sindaco', why: 'perché' }] }, job.id)).toThrow(/fuori dalla strategia/)
    expect(() => lib.saveStrategy(db, { ...fields, firstContacts: [] }, job.id + 100)).toThrow(/la sta scrivendo il job/)
    // Mentre Opus scrive non si approva, non si ritocca il messaggio e non si riscrive.
    expect(() => lib.editStrategy(db, strategy.id, { status: 'approved' })).toThrow(/quando Opus ha finito/)
    expect(() => lib.editStrategy(db, strategy.id, { openingBody: 'Buongiorno' })).toThrow(/quando Opus ha finito/)
    expect(() => lib.enqueueStrategy(db, strategy.prospectIds, 'dashboard', { strategyId: strategy.id })).toThrow(/sta già scrivendo/)
    // Il titolo # lo toglie: la pagina e il file .md hanno già il loro.
    const saved = lib.saveStrategy(db, { ...fields, body: `# Salento\n\n${body}`, firstContacts: [{ prospectId: lecce, name: 'Adriana Poli Bortone', role: 'Sindaco', why: 'decide' }] }, job.id)
    expect(saved).toMatchObject({ title: 'Salento', status: 'draft', body: body.trim() })
    db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, job.id)).run()
    expect(lib.editStrategy(db, saved.id, { status: 'approved' }).status).toBe('approved')

    const brief = lib.listStrategies(db, { prospectId: lecce })
    expect(brief.map(s => s.id)).toEqual([strategy.id])
    expect(brief[0]).toMatchObject({ state: 'ready', targets: [{ id: gallipoli, name: 'Comune di Gallipoli' }, { id: lecce, name: 'Comune di Lecce' }] })
    expect('body' in brief[0]!).toBe(false)
    expect(lib.listStrategies(db, { prospectId: gallipoli }).map(s => s.state)).toEqual(['ready', 'writing'])
    // Ai job serve quella da seguire: l'approvata, con il testo; quella ancora vuota no.
    expect(lib.strategiesFor(db, gallipoli).map(s => [s.id, s.status])).toEqual([[strategy.id, 'approved']])
    expect(lib.strategyDetail(db, strategy.id).state).toBe('ready')

    // Nella pagina: a chi va il primo messaggio, con l'email presa dalle persone del prospect.
    db.insert(prospectContacts).values({ prospectId: lecce, name: 'Adriana Poli Bortone', role: 'Sindaco', email: 'sindaco@comune.lecce.it', linkedinActivity: 'assente', source: 'it_comuni' }).run()
    const detail = lib.strategyDetail(db, strategy.id)
    expect(detail.contacts[0]).toMatchObject({ name: 'Adriana Poli Bortone', why: 'decide', email: 'sindaco@comune.lecce.it', linkedinActivity: 'assente' })
    // Il testo di gruppo si apre nella posta solo quando è adattato.
    expect(detail.mail).toMatchObject({ href: null, note: expect.stringMatching(/^Adatta/) })
    // William ritocca il primo messaggio senza toccare il resto del testo.
    const edited = lib.editStrategy(db, strategy.id, { openingSubject: 'Un piccolo regalo per Lecce', openingBody: 'Buongiorno Sindaca, ...' })
    expect(() => lib.editStrategy(db, strategy.id, { openingBody: '  ' })).toThrow()
    expect(edited).toMatchObject({ openingSubject: 'Un piccolo regalo per Lecce', summary: 'Due Comuni del Salento.' })
    expect(lib.strategyDetail(db, strategy.id).mail?.href).toMatch(/^mailto:sindaco@comune\.lecce\.it\?subject=Un%20piccolo/)
    // Solo dove la matrice ammette l'email.
    db.update(prospects).set({ country: 'DE' }).where(eq(prospects.id, lecce)).run()
    expect(lib.strategyDetail(db, strategy.id).mail).toMatchObject({ href: null, note: expect.stringMatching(/^Email non ammessa/) })
    db.update(prospects).set({ country: 'IT' }).where(eq(prospects.id, lecce)).run()

    const md = lib.strategyMarkdown(saved, lib.strategyTargets(db, saved))
    expect(md).toMatch(/^# Salento\n\nTarget: Comune di Gallipoli, Comune di Lecce/)
    expect(md).toContain('**Oggetto:** Segnalazioni a {Comune}')

    // Riscrivere tiene la riga, il titolo e le note di William, e la rimette da rivedere.
    lib.editStrategy(db, saved.id, { notes: 'Prima Lecce' })
    const again = lib.enqueueStrategy(db, saved.prospectIds, 'dashboard', { strategyId: saved.id })
    expect(again.strategy).toMatchObject({ id: saved.id, title: 'Salento', status: 'draft' })
    expect(again.job.title).toBe('Strategia: Salento')
    expect(again.job.prompt).toContain('Indicazioni di William: Prima Lecce')
    expect(lib.strategyDetail(db, saved.id).mail?.note).toMatch(/dopo l'approvazione/)
  })

  it('un amministratore pubblico si contatta all\'indirizzo istituzionale, solo in Italia', async () => {
    const { checkChannel } = await import('../server/lib/legal')
    expect(checkChannel('public_office', 'IT', 'email').allowed).toBe(true)
    expect(checkChannel('public_office', 'IT', 'phone').allowed).toBe(true)
    expect(checkChannel('public_office', 'IT', 'whatsapp').allowed).toBe(false)
    // Fuori dall'Italia vale la regola B2B del mercato.
    expect(checkChannel('public_office', 'DE', 'email').allowed).toBe(false)
    expect(checkChannel('public_office', 'DE', 'phone').allowed).toBe(false)
  })

  it('divide la strategia nelle sue sezioni', () => {
    expect(markdownSections('Premessa\n## Chi contattare\n- Stasi\n### dettaglio\n## Canali\nemail')).toEqual([
      { title: 'In breve', body: 'Premessa' },
      { title: 'Chi contattare', body: '- Stasi\n### dettaglio' },
      { title: 'Canali', body: 'email' },
    ])
    expect(markdownSections('## In breve\nTesto').map(s => s.title)).toEqual(['In breve'])
    // Un elenco numerato spezzato da un paragrafo riparte dal suo numero.
    expect(renderMarkdown('1. Stasi\nEmail: x\n2. Cartenì')).toContain('<ol start="2"')
    // Un ## vuoto non si prende come titolo la riga dopo.
    expect(markdownSections('## In breve\nTesto\n##\nRiga').map(s => s.title)).toEqual(['In breve'])
  })

  it('il markdown diventa HTML sicuro', () => {
    const html = renderMarkdown('## Chi contattare\n- **Cartenì**, lavori pubblici\n- <script>alert(1)</script>\n\n| Target | Canale |\n|---|---|\n| Gallipoli | telefono |\n\n[fonte](https://www.opencup.gov.it/x) [no](javascript:alert(1))')
    expect(html).toContain('<h3 class="mt-4 mb-1 font-semibold">Chi contattare</h3>')
    expect(html).toContain('<strong>Cartenì</strong>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<td class="border-b border-default p-1 align-top">telefono</td>')
    expect(html).toContain('href="https://www.opencup.gov.it/x"')
    expect(html).not.toContain('href="javascript')

    // Sotto-elenchi nella voce di sopra, separatori allineati, parentesi negli indirizzi.
    const steps = renderMarkdown('1. Telefono\n   - quando: lunedì\n2. PEC')
    expect(steps).toBe('<ol class="my-1 ml-5 list-decimal space-y-0.5"><li>Telefono<ul class="my-1 ml-5 list-disc space-y-0.5"><li>quando: lunedì</li></ul></li><li>PEC</li></ol>')
    expect(renderMarkdown('| A | B |\n| :-: | --: |\n| 1 | 2 |')).toContain('<td class="border-b border-default p-1 align-top">2</td>')
    expect(renderMarkdown('[Lecce](https://it.wikipedia.org/wiki/Lecce_(LE))')).toContain('href="https://it.wikipedia.org/wiki/Lecce_(LE)"')
  })
})
