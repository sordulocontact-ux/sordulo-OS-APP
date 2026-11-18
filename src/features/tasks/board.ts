import { TASK_STATUSES, type Task, type TaskStatus, type Ticket } from '../../shared/types'
import { LABELS } from '../../shared/types'

/** Ticket fields embedded in a task by the query. */
export type TaskTicket = Pick<Ticket, 'id' | 'title' | 'type' | 'priority' | 'status'>

export type BoardTask = Task & { ticket: TaskTicket | null }

/** Search param value for "unassigned tasks" in the person filter. */
export const PERSON_NONE = 'none'

export type TaskColumns<T extends Task = BoardTask> = Record<TaskStatus, T[]>

/** A task is shown when it has no ticket, or when its ticket is validated or done. */
export function isVisibleTask(task: BoardTask): boolean {
  return task.ticket === null || task.ticket.status === 'validated' || task.ticket.status === 'done'
}

export function filterVisible(tasks: BoardTask[]): BoardTask[] {
  return tasks.filter(isVisibleTask)
}

/** person: null = everyone, 'none' = unassigned, otherwise a member id. */
export function filterByPerson<T extends Task>(tasks: T[], person: string | null): T[] {
  if (!person) return tasks
  if (person === PERSON_NONE) return tasks.filter((t) => t.assignee_member_id === null)
  return tasks.filter((t) => t.assignee_member_id === person)
}

export function sortByPosition<T extends Task>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
}

export function groupByStatus<T extends Task>(tasks: T[]): TaskColumns<T> {
  const columns = { todo: [], in_progress: [], review: [], done: [] } as TaskColumns<T>
  for (const task of sortByPosition(tasks)) columns[task.status].push(task)
  return columns
}

export function totalHours(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + (t.estimate_hours ?? 0), 0)
}

const hoursFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

/** 1.5 -> "1,5 h". */
export function formatHours(hours: number | null): string {
  return hours === null ? 'Non estimée' : `${hoursFormat.format(hours)} h`
}

/**
 * Position for a task dropped in `columnTasks` (the target column, sorted by position).
 * beforeTaskId = card dropped on, or null to append. The moved task is ignored among the neighbours.
 * Average of the two neighbours, max + 1 at the end, first - 1 at the start.
 */
export function computeDropPosition(columnTasks: Task[], movedId: string, beforeTaskId: string | null): number {
  const others = columnTasks.filter((t) => t.id !== movedId)
  const index = beforeTaskId === null ? -1 : others.findIndex((t) => t.id === beforeTaskId)
  if (index === -1) {
    return others.length === 0 ? 1 : Math.max(...others.map((t) => t.position)) + 1
  }
  const next = others[index]!
  const prev = others[index - 1]
  return prev ? (prev.position + next.position) / 2 : next.position - 1
}

/** Apply a status/position (or assignee) change to the cached list. */
export function patchTask<T extends Task>(tasks: T[], id: string, patch: Partial<Task>): T[] {
  return tasks.map((t) => (t.id === id ? { ...t, ...patch } : t))
}

export interface DependencyInfo {
  dependsOn: Task | null
  /** True when the dependency exists and is not done yet. */
  blocked: boolean
}

/** `allTasks` must be the full list, not the filtered one: the dependency can be filtered out. */
export function getDependency(task: Task, allTasks: Task[]): DependencyInfo {
  if (!task.depends_on_task_id) return { dependsOn: null, blocked: false }
  const dependsOn = allTasks.find((t) => t.id === task.depends_on_task_id) ?? null
  return { dependsOn, blocked: dependsOn !== null && dependsOn.status !== 'done' }
}

/** Number of tasks that depend on `taskId` and are not done. */
export function countBlocked(taskId: string, allTasks: Task[]): number {
  return allTasks.filter((t) => t.depends_on_task_id === taskId && t.status !== 'done').length
}

export function dependencyLabel(info: DependencyInfo): string | null {
  if (!info.dependsOn) return null
  return info.blocked
    ? `Bloquée par : ${info.dependsOn.title} (${LABELS.taskStatus[info.dependsOn.status]})`
    : `Après : ${info.dependsOn.title}`
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value)
}
