import type { Channel, LegalBasis, Market } from '../db/schema'
import { CHANNELS, MARKETS } from '../db/schema'

// La matrice legale: base legale del contatto, paese e canale dicono se un messaggio si può preparare.
// Sono i default prudenti di PRODUCT.md, da far verificare a un legale prima della Fase 5 (invio).

export interface LegalVerdict {
  allowed: boolean
  /** Il motivo, o la condizione da rispettare quando è ammesso. */
  reason: string
}

/** Email a freddo B2B (base b2b_optout): dove si può e a quale condizione. */
const COLD_EMAIL: Record<Market, LegalVerdict> = {
  IT: { allowed: false, reason: 'Italia: l\'email a freddo chiede il consenso, anche per indirizzi pubblici (art. 130 Codice Privacy)' },
  ES: { allowed: false, reason: 'Spagna: l\'email a freddo chiede il consenso (LSSI)' },
  DE: { allowed: false, reason: 'Germania: l\'email a freddo chiede il consenso (UWG)' },
  AT: { allowed: false, reason: 'Austria: l\'email a freddo chiede il consenso (TKG)' },
  CH: { allowed: false, reason: 'Svizzera: l\'email a freddo chiede il consenso (UWG)' },
  FR: { allowed: true, reason: 'Francia: ammessa se riguarda il ruolo del destinatario, con opt-out (CNIL)' },
  US: { allowed: true, reason: 'USA: ammessa con opt-out e indirizzo fisico del mittente (CAN-SPAM)' },
  CA: { allowed: true, reason: 'Canada: solo a indirizzi pubblicati e con un messaggio pertinente al ruolo (CASL, consenso implicito)' },
}

/** Telefonate B2B a freddo: in Germania e Austria serve almeno un consenso presunto. */
const COLD_CALL: Record<Market, LegalVerdict> = {
  IT: { allowed: true, reason: 'Solo il numero dell\'azienda, dopo aver controllato il Registro pubblico delle opposizioni' },
  ES: { allowed: true, reason: 'Solo il numero dell\'azienda, se non è nella Lista Robinson' },
  FR: { allowed: true, reason: 'Solo il numero dell\'azienda, se non è su Bloctel' },
  US: { allowed: true, reason: 'Solo numeri aziendali, a mano, mai con chiamate automatiche (TCPA)' },
  CA: { allowed: true, reason: 'Solo numeri aziendali (le aziende sono fuori dalla DNCL)' },
  CH: { allowed: true, reason: 'Solo se l\'azienda non ha l\'asterisco nell\'elenco telefonico' },
  DE: { allowed: false, reason: 'Germania: una telefonata B2B a freddo chiede almeno un consenso presunto (UWG §7)' },
  AT: { allowed: false, reason: 'Austria: una telefonata a freddo chiede il consenso (TKG)' },
}

export function checkChannel(basis: LegalBasis, country: string, channel: Channel): LegalVerdict {
  const market = (MARKETS as readonly string[]).includes(country) ? country as Market : null
  if (basis === 'inbound_only') return { allowed: false, reason: 'Contatto solo inbound: si risponde quando scrive lui, nessun primo messaggio' }
  if (channel === 'whatsapp') {
    return basis === 'consent'
      ? { allowed: true, reason: 'Con il consenso, dal link wa.me' }
      : { allowed: false, reason: 'WhatsApp solo con chi ha dato il consenso' }
  }
  if (channel === 'linkedin') return { allowed: true, reason: 'A mano dal profilo del mittente, nessuna automazione' }
  if (basis === 'consent') return { allowed: true, reason: 'Con il consenso, e l\'opt-out in ogni messaggio' }
  // Solo in Italia: altrove vale la regola B2B del mercato.
  if (basis === 'public_office' && market === 'IT') {
    // Decisione di William del 24/10/2026: da far verificare a un legale prima di scalare gli invii.
    if (channel === 'email') return { allowed: true, reason: 'Amministratore pubblico: solo il suo indirizzo istituzionale pubblicato per il ruolo (mai la PEC o il protocollo dell\'ente), un messaggio sul suo ruolo, con la riga per non ricevere altro' }
    return { allowed: true, reason: 'Amministratore pubblico: il numero del Comune o della segreteria, non quello personale' }
  }
  if (basis === 'existing_customer') {
    return channel === 'email'
      ? { allowed: true, reason: 'Cliente: solo servizi simili, con l\'opt-out in ogni messaggio (soft spam, art. 130 c.4)' }
      : { allowed: true, reason: 'Cliente: chiamata per servizi simili' }
  }
  if (!market) return { allowed: false, reason: `Paese ${country} fuori dalla matrice: prima va aggiunto` }
  return channel === 'email' ? COLD_EMAIL[market] : COLD_CALL[market]
}

/** La matrice per la dashboard: per ogni mercato, cosa si può fare con un'azienda trovata dall'agente. */
export function legalMatrix() {
  return MARKETS.map(market => ({
    market,
    channels: Object.fromEntries(CHANNELS.map(c => [c, checkChannel('b2b_optout', market, c)])) as Record<Channel, LegalVerdict>,
  }))
}
