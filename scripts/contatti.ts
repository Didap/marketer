import { useDb } from '../server/db/client'
import { findGiunta } from '../server/lib/contacts'
import { enrichContacts, findComune, listContacts } from '../server/lib/prospects'

// pnpm contatti <Comune>: email istituzionali e deleghe di sindaco e giunta, dal sito del Comune,
// nelle persone già trovate dall'Anagrafe degli amministratori. Un Comune per volta.

const comune = process.argv.slice(2).join(' ').trim()
if (!comune) {
  console.error('Uso: pnpm contatti <Comune>, per esempio pnpm contatti Gallipoli')
  process.exit(1)
}
const db = useDb()
const prospect = findComune(db, comune)
if (!prospect?.website) {
  console.error(prospect ? `${prospect.name} non ha un sito` : `${comune} non è tra i Comuni trovati: prima una ricerca «Comuni italiani»`)
  process.exit(1)
}
const result = enrichContacts(db, await findGiunta(prospect.website, listContacts(db, prospect.id)))
for (const c of listContacts(db, prospect.id)) {
  console.log([c.role, c.name, c.email ?? 'email non trovata', c.angles.join(', ') || '-'].join(' | '))
}
console.log(`${prospect.name}: ${result.updated} persone aggiornate${result.notFound.length ? `, niente trovato per ${result.notFound.join(', ')}` : ''}`)
