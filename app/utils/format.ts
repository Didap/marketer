// Etichette e formati della dashboard.

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled' | 'stopped'
export type JobPermission = 'read' | 'edit' | 'full'
type BadgeColor = 'neutral' | 'info' | 'success' | 'error' | 'warning' | 'primary'

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'In coda',
  running: 'In corso',
  done: 'Fatto',
  failed: 'Errore',
  canceled: 'Annullato',
  stopped: 'Fermato dal tetto',
}

export const STATUS_COLOR: Record<JobStatus, BadgeColor> = {
  queued: 'neutral',
  running: 'info',
  done: 'success',
  failed: 'error',
  canceled: 'neutral',
  stopped: 'warning',
}

export const PERMISSION_LABEL: Record<JobPermission, string> = {
  read: 'Solo lettura',
  edit: 'Lettura e modifica file',
  full: 'Completo (modalità auto, anche comandi)',
}

const number = new Intl.NumberFormat('it-IT')
const compact = new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 })
const usd = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const time = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
const dateTime = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })
// Le date AAAA-MM-GG sono mezzanotte UTC: lette in UTC, il giorno non cambia con il fuso.
const day = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const month = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export const formatNumber = (n: number) => number.format(n)
export const formatTokens = (n: number) => compact.format(n)
export const formatUsd = (n: number) => usd.format(n)
export const formatTime = (d: string | Date | null) => (d ? time.format(new Date(d)) : '')
export const formatDateTime = (d: string | Date | null) => (d ? dateTime.format(new Date(d)) : '')
/** Una data AAAA-MM-GG da leggere: 9 giugno 2024. */
export const formatDay = (d: string | null) => (d ? day.format(new Date(d)) : '')
/** Il mese di una data AAAA-MM-GG: giugno 2024. */
export const formatMonth = (d: string | null) => (d ? month.format(new Date(d)) : '')

export function formatDuration(from: string | Date | null, to: string | Date | null = null): string {
  if (!from) return ''
  const ms = (to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${s % 60} s`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

export function formatAgo(d: string | Date | null): string {
  if (!d) return 'mai'
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 5) return 'adesso'
  if (s < 60) return `${s} s fa`
  if (s < 3600) return `${Math.floor(s / 60)} min fa`
  return formatDateTime(d)
}
