/**
 * Pure logic of the validation screen: local drafts, validation and the diff
 * "drafts vs. what is stored" turned into Supabase operations. No React, no Supabase.
 */
import { pickAssignee, type AssignableMember } from '../../shared/assignment'
import type { ReviseTicketState, ReviseTicketsResponse } from '../../shared/api-contract'
import type { Skill, Task, Ticket, TicketPriority, TicketStatus, TicketType } from '../../shared/types'

export interface TaskDraft {
  /** Task id, or a temporary id ("new-…") for a task added locally. */
  id: string
  title: string
  skill: Skill
  /** Text of the number input, in hours. Empty = no estimate. */
  estimate: string
  assigneeId: string | null
  dependsOnId: string | null
  isNew: boolean
}

export interface TicketDraft {
  title: string
  type: TicketType
  priority: TicketPriority
  description: string
  tasks: TaskDraft[]
}

export interface TicketPatch {
  title?: string
  type?: TicketType
  priority?: TicketPriority
  description?: string
  status?: TicketStatus
}

export interface TaskPatch {
  title?: string
  skill?: Skill
  estimate_hours?: number | null
  assignee_member_id?: string | null
  depends_on_task_id?: string | null
}

export interface NewTaskRow {
  project_id: string
  ticket_id: string
  title: string
  skill: Skill
  estimate_hours: number | null
  assignee_member_id: string | null
  status: 'todo'
  depends_on_task_id: null
  position: number
}

export interface SavePlan {
  ticketPatch: TicketPatch
  taskUpdates: { id: string; patch: TaskPatch }[]
  taskInserts: NewTaskRow[]
  taskDeletes: string[]
}

export function estimateToText(value: number | null): string {
  return value === null ? '' : String(value)
}

/** '' -> null (no estimate), valid number >= 0 -> number, anything else -> undefined (invalid). */
export function parseEstimate(text: string): number | null | undefined {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

export function makeTicketDraft(ticket: Ticket, tasks: readonly Task[]): TicketDraft {
  return {
    title: ticket.title,
    type: ticket.type,
    priority: ticket.priority,
    description: ticket.description,
    tasks: [...tasks]
      .sort((a, b) => a.position - b.position)
      .map((task) => ({
        id: task.id,
        title: task.title,
        skill: task.skill,
        estimate: estimateToText(task.estimate_hours),
        assigneeId: task.assignee_member_id,
        dependsOnId: task.depends_on_task_id,
        isNew: false,
      })),
  }
}

/**
 * A new task: dev by default. It goes to the person who already holds the ticket (a ticket = one
 * person); with no one yet, the best member for the skill.
 */
export function makeNewTaskDraft(
  id: string,
  members: readonly AssignableMember[],
  skill: Skill = 'dev',
  ticketAssigneeId: string | null = null,
): TaskDraft {
  return {
    id,
    title: '',
    skill,
    estimate: '',
    assigneeId: ticketAssigneeId ?? pickAssignee(skill, members)?.id ?? null,
    dependsOnId: null,
    isNew: true,
  }
}

/** Changing the skill of a task keeps its assignee: the whole ticket stays with one person. */
export function changeTaskSkill(task: TaskDraft, skill: Skill): TaskDraft {
  if (task.skill === skill) return task
  return { ...task, skill }
}

/** The person holding the ticket: the assignee shared by its tasks, null if none or mixed. */
export function ticketAssigneeOf(draft: Pick<TicketDraft, 'tasks'>): string | null {
  const ids = new Set(draft.tasks.map((task) => task.assigneeId))
  return ids.size === 1 ? ([...ids][0] ?? null) : null
}

/** Gives the whole ticket (all its tasks) to one person. */
export function assignTicket<D extends Pick<TicketDraft, 'tasks'>>(draft: D, memberId: string | null): D {
  return { ...draft, tasks: draft.tasks.map((task) => ({ ...task, assigneeId: memberId })) }
}

export interface TicketErrors {
  title?: string
  tasks: Record<string, { title?: string; estimate?: string }>
  valid: boolean
}

export function validateDraft(draft: TicketDraft): TicketErrors {
  const errors: TicketErrors = { tasks: {}, valid: true }
  if (draft.title.trim() === '') {
    errors.title = 'Le titre est obligatoire.'
    errors.valid = false
  }
  for (const task of draft.tasks) {
    const taskErrors: { title?: string; estimate?: string } = {}
    if (task.title.trim() === '') taskErrors.title = 'Le titre de la tâche est obligatoire.'
    if (parseEstimate(task.estimate) === undefined) taskErrors.estimate = "L'estimation doit être un nombre positif ou vide."
    if (taskErrors.title || taskErrors.estimate) {
      errors.tasks[task.id] = taskErrors
      errors.valid = false
    }
  }
  return errors
}

/**
 * Operations needed to store the draft. `status` is the status to give the ticket (omit to
 * only save the edits). `startPosition` is the position of the first inserted task.
 * Assumes the draft is valid (see validateDraft).
 */
export function planSave(
  ticket: Ticket,
  originalTasks: readonly Task[],
  draft: TicketDraft,
  options: { startPosition: number; status?: TicketStatus },
): SavePlan {
  const ticketPatch: TicketPatch = {}
  const title = draft.title.trim()
  if (title !== ticket.title) ticketPatch.title = title
  if (draft.type !== ticket.type) ticketPatch.type = draft.type
  if (draft.priority !== ticket.priority) ticketPatch.priority = draft.priority
  if (draft.description !== ticket.description) ticketPatch.description = draft.description
  if (options.status !== undefined && options.status !== ticket.status) ticketPatch.status = options.status

  const draftIds = new Set(draft.tasks.map((task) => task.id))
  const originals = new Map(originalTasks.map((task) => [task.id, task]))
  const taskUpdates: SavePlan['taskUpdates'] = []
  const taskInserts: NewTaskRow[] = []
  let position = options.startPosition

  for (const task of draft.tasks) {
    const estimate = parseEstimate(task.estimate) ?? null
    const taskTitle = task.title.trim()
    const original = task.isNew ? undefined : originals.get(task.id)
    if (!original) {
      taskInserts.push({
        project_id: ticket.project_id,
        ticket_id: ticket.id,
        title: taskTitle,
        skill: task.skill,
        estimate_hours: estimate,
        assignee_member_id: task.assigneeId,
        status: 'todo',
        depends_on_task_id: null,
        position: position++,
      })
      continue
    }
    // A dependency on a task removed in this draft is dropped.
    const dependsOn = task.dependsOnId !== null && draftIds.has(task.dependsOnId) ? task.dependsOnId : null
    const patch: TaskPatch = {}
    if (taskTitle !== original.title) patch.title = taskTitle
    if (task.skill !== original.skill) patch.skill = task.skill
    if (estimate !== original.estimate_hours) patch.estimate_hours = estimate
    if (task.assigneeId !== original.assignee_member_id) patch.assignee_member_id = task.assigneeId
    if (dependsOn !== original.depends_on_task_id) patch.depends_on_task_id = dependsOn
    if (Object.keys(patch).length > 0) taskUpdates.push({ id: task.id, patch })
  }

  const taskDeletes = originalTasks.filter((task) => !draftIds.has(task.id)).map((task) => task.id)
  return { ticketPatch, taskUpdates, taskInserts, taskDeletes }
}

export function isPlanEmpty(plan: SavePlan): boolean {
  return (
    Object.keys(plan.ticketPatch).length === 0 &&
    plan.taskUpdates.length === 0 &&
    plan.taskInserts.length === 0 &&
    plan.taskDeletes.length === 0
  )
}

/** True when the draft differs from what is stored (unsaved changes). */
export function hasChanges(ticket: Ticket, originalTasks: readonly Task[], draft: TicketDraft): boolean {
  return !isPlanEmpty(planSave(ticket, originalTasks, draft, { startPosition: 0 }))
}

/** Position of the next inserted task: max of the loaded positions + 1. */
export function nextPosition(tasks: readonly Pick<Task, 'position'>[]): number {
  return tasks.reduce((max, task) => Math.max(max, task.position), -1) + 1
}

/** Total of the valid task estimates, in hours; null if none of the tasks has one. */
export function draftHours(draft: Pick<TicketDraft, 'tasks'>): number | null {
  const values = draft.tasks
    .map((task) => parseEstimate(task.estimate))
    .filter((value): value is number => typeof value === 'number')
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0)
}

/** State of a ticket as shown on screen (unsaved edits included), sent with a note to the AI. */
export function toReviseState(ticket: Pick<Ticket, 'id' | 'area'>, draft: TicketDraft): ReviseTicketState {
  return {
    id: ticket.id,
    title: draft.title,
    description: draft.description,
    type: draft.type,
    priority: draft.priority,
    area: ticket.area,
    assigneeMemberId: ticketAssigneeOf(draft),
    estimateHours: draftHours(draft),
  }
}

/** Toast after a note to the AI. */
export function reviseSummary(result: Pick<ReviseTicketsResponse, 'updated' | 'created' | 'deleted' | 'memoryChanged'>): string {
  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`
  const counts = `${plural(result.updated, 'modifié')}, ${plural(result.created, 'créé')}, ${plural(result.deleted, 'supprimé')}`
  return `Tickets mis à jour (${counts}).${result.memoryChanged ? ' Mémoire du projet mise à jour.' : ''}`
}
