import type { Task } from '../../shared/types'
import { compareByUrgency, dueState } from '../tasks/schedule'

export const DUE_GROUPS = ['overdue', 'today', 'week', 'later', 'none'] as const
export type DueGroup = (typeof DUE_GROUPS)[number]

export const DUE_GROUP_LABELS: Record<DueGroup, string> = {
  overdue: 'En retard',
  today: "Aujourd'hui",
  week: 'Cette semaine',
  later: 'Plus tard',
  none: 'Sans échéance',
}

/** Tâches non terminées regroupées par échéance (Paris), chaque groupe trié par échéance puis priorité. */
export function groupByDue<T extends Pick<Task, 'due_date' | 'priority' | 'status'>>(tasks: T[], today: string): Record<DueGroup, T[]> {
  const groups: Record<DueGroup, T[]> = { overdue: [], today: [], week: [], later: [], none: [] }
  for (const task of tasks) groups[dueState(task.due_date, today, task.status === 'done')].push(task)
  for (const key of DUE_GROUPS) groups[key].sort(compareByUrgency)
  return groups
}

/** Groupes non vides, dans l'ordre d'affichage. */
export function nonEmptyGroups<T>(groups: Record<DueGroup, T[]>): { group: DueGroup; label: string; tasks: T[] }[] {
  return DUE_GROUPS.filter((g) => groups[g].length > 0).map((g) => ({ group: g, label: DUE_GROUP_LABELS[g], tasks: groups[g] }))
}
