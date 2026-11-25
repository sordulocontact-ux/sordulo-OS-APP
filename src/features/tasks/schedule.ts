import { TASK_PRIORITIES, type Task, type TaskPriority } from '../../shared/types'

/** Jour AAAA-MM-JJ à Paris pour cet instant (même fuseau que l'attribution : src/shared/assignment.ts). */
export function parisDay(now: Date = new Date()): string {
  // Le format suédois donne AAAA-MM-JJ.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function parseDay(day: string): Date | null {
  const [y, m, d] = day.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d))
}

/** Ajoute des jours calendaires à un jour AAAA-MM-JJ. */
export function addDays(day: string, count: number): string {
  const date = parseDay(day)
  if (!date) return day
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

/** Dimanche de la semaine du jour donné (la semaine va du lundi au dimanche). */
export function endOfWeek(day: string): string {
  const date = parseDay(day)
  if (!date) return day
  const weekday = date.getUTCDay() // 0 = dimanche
  return addDays(day, weekday === 0 ? 0 : 7 - weekday)
}

export type DueState = 'overdue' | 'today' | 'week' | 'later' | 'none'

/** Où tombe une échéance par rapport à aujourd'hui (Paris). Une tâche faite n'est jamais en retard. */
export function dueState(due: string | null, today: string, done = false): DueState {
  if (!due) return 'none'
  if (due < today) return done ? 'later' : 'overdue'
  if (due === today) return 'today'
  return due <= endOfWeek(today) ? 'week' : 'later'
}

const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** « 12 déc. » ; null sans échéance. */
export function formatDueDay(due: string | null): string | null {
  const date = due ? parseDay(due) : null
  return date ? dayFormat.format(date) : null
}

/** Texte de la pastille d'échéance d'une carte. */
export function dueLabel(due: string | null, today: string, done = false): string | null {
  const text = formatDueDay(due)
  if (!text) return null
  const state = dueState(due, today, done)
  if (state === 'overdue') return `En retard : ${text}`
  if (state === 'today') return "Aujourd'hui"
  return text
}

export function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value)
}

/** Filtre Priorité : '' = toutes. */
export type PriorityFilter = '' | TaskPriority

export function parsePriorityParam(raw: string | null): PriorityFilter {
  return raw && isTaskPriority(raw) ? raw : ''
}

export function filterByPriority<T extends Pick<Task, 'priority'>>(tasks: T[], priority: PriorityFilter): T[] {
  return priority ? tasks.filter((t) => t.priority === priority) : tasks
}

/** Filtre Échéance : '' = toutes, `overdue` = en retard, `week` = d'ici dimanche (retard compris), `none` = sans échéance. */
export const DUE_FILTERS = ['overdue', 'today', 'week', 'none'] as const
export type DueFilter = '' | (typeof DUE_FILTERS)[number]

export function parseDueParam(raw: string | null): DueFilter {
  return (DUE_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as DueFilter) : ''
}

export function filterByDue<T extends Pick<Task, 'due_date' | 'status'>>(tasks: T[], due: DueFilter, today: string): T[] {
  if (!due) return tasks
  return tasks.filter((t) => {
    const state = dueState(t.due_date, today, t.status === 'done')
    if (due === 'overdue') return state === 'overdue'
    if (due === 'today') return state === 'today'
    if (due === 'none') return state === 'none'
    return state === 'overdue' || state === 'today' || state === 'week'
  })
}

/** Priorité d'abord (haute avant basse), puis échéance (sans échéance en dernier). */
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }

export function compareByUrgency(a: Pick<Task, 'priority' | 'due_date'>, b: Pick<Task, 'priority' | 'due_date'>): number {
  const dueA = a.due_date ?? '9999-12-31'
  const dueB = b.due_date ?? '9999-12-31'
  return dueA.localeCompare(dueB) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
}
