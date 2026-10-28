// Etichette e moduli di identità, campagne e messaggi.

export type Channel = 'email' | 'linkedin' | 'phone' | 'whatsapp'
export type Language = 'it' | 'en' | 'fr' | 'es' | 'de'
export type CampaignStatus = 'draft' | 'active' | 'paused'
export type MessageStatus = 'pending' | 'approved' | 'discarded' | 'sent'
export type IdeaKind = 'product' | 'custom' | 'quick'
type BadgeColor = 'neutral' | 'info' | 'success' | 'error' | 'warning' | 'primary'

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'Email',
  linkedin: 'LinkedIn',
  phone: 'Telefono',
  whatsapp: 'WhatsApp',
}

export const CHANNEL_ICON: Record<Channel, string> = {
  email: 'i-lucide-mail',
  linkedin: 'i-lucide-linkedin',
  phone: 'i-lucide-phone',
  whatsapp: 'i-lucide-message-circle',
}

export const LANGUAGE_LABEL: Record<Language, string> = {
  it: 'Italiano',
  en: 'Inglese',
  fr: 'Francese',
  es: 'Spagnolo',
  de: 'Tedesco',
}

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: 'Bozza',
  active: 'Attiva',
  paused: 'In pausa',
}

export const CAMPAIGN_STATUS_COLOR: Record<CampaignStatus, BadgeColor> = {
  draft: 'neutral',
  active: 'success',
  paused: 'warning',
}

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  pending: 'Da approvare',
  approved: 'Approvato',
  discarded: 'Scartato',
  sent: 'Inviato',
}

export const MESSAGE_STATUS_COLOR: Record<MessageStatus, BadgeColor> = {
  pending: 'warning',
  approved: 'success',
  discarded: 'neutral',
  sent: 'info',
}

export const IDEA_KIND_LABEL: Record<IdeaKind, string> = {
  product: 'Prodotto didap',
  custom: 'Su misura',
  quick: 'Lavoro veloce',
}

export interface CampaignForm {
  name: string
  segmentId: number | undefined
  identityId: number | undefined
  language: Language
  steps: { day: number, channel: Channel }[]
  notes: string
}

export function emptyCampaignForm(): CampaignForm {
  return {
    name: '',
    segmentId: undefined,
    identityId: undefined,
    language: 'it',
    steps: [{ day: 0, channel: 'email' }, { day: 3, channel: 'linkedin' }, { day: 7, channel: 'email' }, { day: 10, channel: 'phone' }],
    notes: '',
  }
}

/** La lingua che si parla nel mercato, come proposta per una campagna nuova. */
export const MARKET_LANGUAGE: Record<string, Language> = { IT: 'it', ES: 'es', FR: 'fr', US: 'en', CA: 'en', CH: 'de', DE: 'de', AT: 'de' }
