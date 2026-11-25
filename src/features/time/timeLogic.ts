import type { Task, TimeEntry } from '../../shared/types'

/** Durée écoulée en minutes (décimales) d'une entrée : durée enregistrée, ou temps depuis le début pour un minuteur en cours. */
export function entryMinutes(entry: Pick<TimeEntry, 'started_at' | 'ended_at' | 'duration_minutes'>, now: Date): number {
  if (entry.duration_minutes !== null) return entry.duration_minutes
  if (entry.ended_at !== null) return Math.max(0, (Date.parse(entry.ended_at) - Date.parse(entry.started_at)) / 60_000)
  return Math.max(0, (now.getTime() - Date.parse(entry.started_at)) / 60_000)
}

export function isRunning(entry: Pick<TimeEntry, 'ended_at'>): boolean {
  return entry.ended_at === null
}

/** 150 -> « 2 h 30 », 45 -> « 45 min », 0 -> « 0 min », 120 -> « 2 h ». */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
}

/** Minuteur qui défile : 3725 s -> « 1:02:05 ». */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * Lit une durée saisie : « 90 » (minutes), « 1h30 », « 1 h », « 1:30 », « 45min », « 1,5h » (heures décimales).
 * Renvoie des minutes entières (> 0, 100 000 au plus : contrainte de la base), ou null si illisible.
 */
export function parseDuration(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(',', '.').replace(/\s+/g, '')
  if (!text) return null
  let minutes: number | null = null
  let match = /^(\d+):(\d{1,2})$/.exec(text)
  if (match) minutes = Number(match[1]) * 60 + Number(match[2])
  else if ((match = /^(\d+(?:\.\d+)?)h(?:(\d{1,2})(?:min|m)?)?$/.exec(text))) {
    minutes = Math.round(Number(match[1]) * 60 + (match[2] ? Number(match[2]) : 0))
  } else if ((match = /^(\d+)(?:min|m)?$/.exec(text))) minutes = Number(match[1])
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0 || minutes > 100_000) return null
  return minutes
}

/** Début d'une entrée manuelle saisie à une date AAAA-MM-JJ : 9 h, heure locale. */
export function manualStart(day: string): string | null {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d, 9, 0, 0).toISOString()
}

/** Jour AAAA-MM-JJ (heure locale) d'un instant ISO, pour préremplir le champ date. */
export function localDay(iso: string): string {
  const date = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

/** Minutes passées par clé (tâche, membre), minuteur en cours compris. `keyOf` null = entrée ignorée. */
function sumBy(entries: TimeEntry[], now: Date, keyOf: (e: TimeEntry) => string | null): Map<string, number> {
  const totals = new Map<string, number>()
  for (const entry of entries) {
    const key = keyOf(entry)
    if (key === null) continue
    totals.set(key, (totals.get(key) ?? 0) + entryMinutes(entry, now))
  }
  return totals
}

export const minutesByTask = (entries: TimeEntry[], now: Date) => sumBy(entries, now, (e) => e.task_id)
export const minutesByMember = (entries: TimeEntry[], now: Date) => sumBy(entries, now, (e) => e.member_id)

export function totalMinutes(entries: TimeEntry[], now: Date): number {
  let sum = 0
  for (const entry of entries) sum += entryMinutes(entry, now)
  return sum
}

/** Temps vendu : somme des estimations des tâches, en minutes. */
export function soldMinutes(tasks: Pick<Task, 'estimate_hours'>[]): number {
  return Math.round(tasks.reduce((sum, t) => sum + (t.estimate_hours ?? 0), 0) * 60)
}

export type BudgetState = 'unknown' | 'ok' | 'over'

export interface Budget {
  spent: number
  sold: number
  /** sold - spent : négatif = dépassement. */
  remaining: number
  state: BudgetState
  /** spent / sold en %, null sans temps vendu. */
  percent: number | null
}

/** Temps réel contre temps vendu : sert à savoir si une prestation est rentable. */
export function budget(spentMinutes: number, soldMin: number): Budget {
  const spent = Math.round(spentMinutes)
  return {
    spent,
    sold: soldMin,
    remaining: soldMin - spent,
    state: soldMin <= 0 ? 'unknown' : spent > soldMin ? 'over' : 'ok',
    percent: soldMin <= 0 ? null : Math.round((spent / soldMin) * 100),
  }
}

/** « 2 h 30 sur 4 h » ; « 2 h 30 (non estimée) » sans estimation. */
export function budgetLabel(b: Budget): string {
  return b.state === 'unknown' ? `${formatDuration(b.spent)} (non estimée)` : `${formatDuration(b.spent)} sur ${formatDuration(b.sold)}`
}

export interface TaskTimeRow {
  taskId: string
  title: string
  budget: Budget
}

/** Une ligne par tâche (estimées ou avec du temps), les plus dépassées d'abord. */
export function taskTimeRows(tasks: Pick<Task, 'id' | 'title' | 'estimate_hours'>[], entries: TimeEntry[], now: Date): TaskTimeRow[] {
  const spent = minutesByTask(entries, now)
  return tasks
    .map((t) => ({ taskId: t.id, title: t.title, budget: budget(spent.get(t.id) ?? 0, Math.round((t.estimate_hours ?? 0) * 60)) }))
    .filter((row) => row.budget.spent > 0 || row.budget.sold > 0)
    .sort((a, b) => a.budget.remaining - b.budget.remaining)
}

/** Une entrée est modifiable par son auteur ou par un admin. */
export function canEditEntry(entry: Pick<TimeEntry, 'member_id'>, memberId: string | null, isAdmin: boolean): boolean {
  return isAdmin || (memberId !== null && entry.member_id === memberId)
}
