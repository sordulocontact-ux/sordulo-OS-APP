import type { InputStatus, SpeakerNames } from '../../shared/types'

/** Une ligne de la liste : un appel (entrée « meeting »), sans la transcription complète. */
export interface CallRow {
  id: string
  project_id: string
  title: string | null
  status: InputStatus
  created_at: string
  speaker_names: SpeakerNames | null
  /** Durée en secondes, lue dans `transcript->duration_seconds`. */
  duration: number | null
  project: { id: string; name: string; client: { id: string; name: string } | null } | null
  /** Agrégat PostgREST : `[{ count: n }]`. */
  tickets: { count: number }[] | null
}

export type StatusFilter = '' | 'ready' | 'processing' | 'error'
export type PeriodFilter = '' | '7d' | '30d'

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  '': 'Tous les statuts',
  ready: 'Prêt',
  processing: 'En cours de traitement',
  error: 'Erreur',
}

export const PERIOD_FILTER_LABELS: Record<PeriodFilter, string> = {
  '': 'Tout',
  '7d': '7 derniers jours',
  '30d': '30 derniers jours',
}

export interface CallsFilters {
  query: string
  project: string
  client: string
  status: StatusFilter
  period: PeriodFilter
}

export function parseStatusParam(value: string | null): StatusFilter {
  return value === 'ready' || value === 'processing' || value === 'error' ? value : ''
}

export function parsePeriodParam(value: string | null): PeriodFilter {
  return value === '7d' || value === '30d' ? value : ''
}

const DAY_MS = 24 * 60 * 60 * 1000

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function dayLabel(date: Date): string {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

function timeLabel(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Titre saisi, sinon « Appel du 20/11/2026 à 14:42 ». */
export function callTitle(call: Pick<CallRow, 'title' | 'created_at'>): string {
  const title = call.title?.trim()
  if (title) return title
  const date = new Date(call.created_at)
  return `Appel du ${dayLabel(date)} à ${timeLabel(date)}`
}

/** « 1 h 25 », « 4 min », « < 1 min » ; « — » si la durée est inconnue. */
export function formatCallDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '—'
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return '< 1 min'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${pad(minutes % 60)}`
}

/** Noms donnés aux voix, dans l'ordre des voix. Vide si aucun nom. */
export function participants(call: Pick<CallRow, 'speaker_names'>): string {
  const names = Object.entries(call.speaker_names ?? {})
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, name]) => name.trim())
    .filter(Boolean)
  return names.join(', ')
}

export function ticketCount(call: Pick<CallRow, 'tickets'>): number {
  return call.tickets?.[0]?.count ?? 0
}

/** « Aujourd'hui, 14:42 », « Hier, 09:10 », sinon « 18/11/2026 ». */
export function formatCallDate(iso: string, now: Date): string {
  const date = new Date(iso)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round((startOfToday.getTime() - startOfDate.getTime()) / DAY_MS)
  if (days === 0) return `Aujourd’hui, ${timeLabel(date)}`
  if (days === 1) return `Hier, ${timeLabel(date)}`
  return dayLabel(date)
}

export function matchesStatus(status: InputStatus, filter: StatusFilter): boolean {
  if (filter === '') return true
  if (filter === 'processing') return status === 'uploaded' || status === 'transcribing' || status === 'analyzing'
  return status === filter
}

export function matchesPeriod(iso: string, period: PeriodFilter, now: Date): boolean {
  if (period === '') return true
  const days = period === '7d' ? 7 : 30
  return now.getTime() - new Date(iso).getTime() <= days * DAY_MS
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export function matchesQuery(call: CallRow, query: string): boolean {
  const q = normalize(query.trim())
  if (!q) return true
  const haystack = [callTitle(call), call.project?.name ?? '', call.project?.client?.name ?? '', participants(call)]
  return haystack.some((value) => normalize(value).includes(q))
}

/** Filtre puis trie du plus récent au plus ancien. */
export function filterCalls(calls: CallRow[], filters: CallsFilters, now: Date): CallRow[] {
  return calls
    .filter(
      (call) =>
        (!filters.project || call.project_id === filters.project) &&
        (!filters.client || call.project?.client?.id === filters.client) &&
        matchesStatus(call.status, filters.status) &&
        matchesPeriod(call.created_at, filters.period, now) &&
        matchesQuery(call, filters.query),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export interface CallStats {
  count: number
  seconds: number
  tickets: number
}

/** Chiffres du mois civil en cours. */
export function callStats(calls: CallRow[], now: Date): CallStats {
  const stats: CallStats = { count: 0, seconds: 0, tickets: 0 }
  for (const call of calls) {
    const date = new Date(call.created_at)
    if (date.getFullYear() !== now.getFullYear() || date.getMonth() !== now.getMonth()) continue
    stats.count += 1
    stats.seconds += call.duration ?? 0
    stats.tickets += ticketCount(call)
  }
  return stats
}

/** Projets présents dans les appels, par ordre alphabétique. */
export function projectOptions(calls: CallRow[]): { id: string; name: string }[] {
  const map = new Map<string, string>()
  for (const call of calls) if (call.project) map.set(call.project.id, call.project.name)
  return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

/** Clients présents dans les appels, par ordre alphabétique. */
export function clientOptions(calls: CallRow[]): { id: string; name: string }[] {
  const map = new Map<string, string>()
  for (const call of calls) if (call.project?.client) map.set(call.project.client.id, call.project.client.name)
  return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}
