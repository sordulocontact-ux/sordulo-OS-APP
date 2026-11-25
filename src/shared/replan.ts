/**
 * Réorganisation du planning (action IA « replan ») : analyse DÉTERMINISTE, faite par le code avant Claude.
 *
 * Trois problèmes détectés sur les tâches non faites :
 * - semaine qui déborde : heures dues d'ici la fin de la semaine (retards compris) > heures encore disponibles
 *   cette semaine pour la personne (capacité hebdo ÷ jours travaillés, moins les jours passés, indisponibles et
 *   absents) ;
 * - tâche bloquante : une tâche dépend d'une tâche non faite dont l'échéance est après la sienne ;
 * - urgence : priorité haute en retard, sans personne, ou due avant que la personne attribuée soit disponible.
 *
 * Pour chaque problème, des opérations candidates (réattribuer à un membre compétent qui a de la place,
 * décaler une échéance) avec leurs valeurs avant / après exactes. Claude choisit seulement parmi elles
 * (vérifié par `buildProposals`) et rédige titre et explication.
 *
 * Semaine : du lundi au dimanche de la date du jour (Paris) ; le samedi et le dimanche, la semaine suivante.
 * Jours travaillés : lundi à vendredi, hors `unavailable_weekdays` et absences datées.
 * Aucune dépendance Node.
 */
import { assignmentCandidates, canBeAutoAssigned, DEFAULT_TASK_HOURS, isAbsentOn, skillLevel, type AbsencePeriod } from './assignment.js'
import type { AiAutonomyRule, AiProposalKind, AiProposalOperation, AiProposalTaskValues, Member, Task, TaskPriority } from './types.js'

export type ReplanTask = Pick<
  Task,
  'id' | 'project_id' | 'title' | 'skill' | 'estimate_hours' | 'assignee_member_id' | 'status' | 'depends_on_task_id' | 'due_date' | 'priority'
>

export type ReplanMember = Pick<Member, 'id' | 'name' | 'role' | 'removed_at' | 'skills' | 'weekly_capacity_hours' | 'unavailable_weekdays'> & {
  absences?: readonly AbsencePeriod[] | null
}

export interface ReplanInput {
  /** Date du jour AAAA-MM-JJ (Paris). */
  today: string
  /** Tâches de l'organisation, faites comprises (charge de chacun et état des dépendances). */
  tasks: readonly ReplanTask[]
  members: readonly ReplanMember[]
  /** Membres affectés par projet (project_members) : la réattribution se limite à eux s'il y en a. */
  projectMembers?: ReadonlyMap<string, readonly string[]>
  /** Noms des projets (textes lisibles). */
  projectNames?: ReadonlyMap<string, string>
  /** Limite les problèmes et les opérations aux tâches de ce projet. */
  projectId?: string | null
  /** Tâches déjà couvertes par une proposition en attente : aucune nouvelle opération sur elles. */
  excludedTaskIds?: ReadonlySet<string>
}

export const REPLAN_ISSUE_TYPES = ['overload', 'blocked', 'urgent'] as const
export type ReplanIssueType = (typeof REPLAN_ISSUE_TYPES)[number]

export type ReplanCandidateKind = Extract<AiProposalKind, 'reassign_task' | 'move_due_date'>

export interface ReplanCandidate {
  /** Identifiant stable : `reassign:<tâche>:<membre>` ou `due:<tâche>:<date>`. */
  id: string
  kind: ReplanCandidateKind
  taskId: string
  projectId: string
  before: AiProposalTaskValues
  after: AiProposalTaskValues
  /** Personnes concernées : ancienne et nouvelle personne attribuée. */
  memberIds: string[]
  /** Description lisible (pour Claude et les journaux). */
  label: string
}

export interface ReplanIssue {
  id: string
  type: ReplanIssueType
  /** Constat lisible. */
  summary: string
  memberId: string | null
  taskIds: string[]
  candidateIds: string[]
}

export interface ReplanAnalysis {
  weekStart: string
  weekEnd: string
  issues: ReplanIssue[]
  candidates: ReplanCandidate[]
}

/** Nombre maximal de personnes proposées pour reprendre une même tâche. */
export const MAX_REASSIGN_CANDIDATES = 2
/** Recherche d'un jour travaillé : au plus ce nombre de jours. */
const SEARCH_DAYS = 90
const EPSILON = 1e-6

/* ---------- Dates (AAAA-MM-JJ, calculées en UTC pour ignorer les changements d'heure) ---------- */

function toUtc(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`)
}

export function addDays(iso: string, days: number): string {
  const date = toUtc(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** 1 = lundi … 7 = dimanche. */
export function isoWeekday(iso: string): number {
  const day = toUtc(iso).getUTCDay()
  return day === 0 ? 7 : day
}

/** Semaine analysée : lundi et dimanche de la date du jour ; le week-end, la semaine suivante. */
export function planningWeek(today: string): { start: string; end: string } {
  const weekday = isoWeekday(today)
  const start = weekday >= 6 ? addDays(today, 8 - weekday) : addDays(today, 1 - weekday)
  return { start, end: addDays(start, 6) }
}

const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** « 3 déc. » */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return 'sans échéance'
  const date = toUtc(iso)
  return Number.isNaN(date.getTime()) ? iso : shortDate.format(date)
}

function formatHours(hours: number): string {
  return `${String(Math.round(hours * 10) / 10).replace('.', ',')} h`
}

/* ---------- Capacité ---------- */

export function taskHours(task: Pick<ReplanTask, 'estimate_hours'>): number {
  const value = task.estimate_hours
  return value !== null && Number.isFinite(value) && value >= 0 ? value : DEFAULT_TASK_HOURS
}

/** Jour travaillé : lundi à vendredi, hors jours indisponibles et absences. */
export function isWorkingDay(member: ReplanMember, iso: string): boolean {
  const weekday = isoWeekday(iso)
  if (weekday > 5) return false
  if ((member.unavailable_weekdays as readonly number[] | null | undefined)?.includes(weekday)) return false
  return !isAbsentOn(member.absences, iso)
}

/** Heures par jour travaillé : capacité hebdo ÷ jours travaillés d'une semaine type (0 si aucun). */
export function dailyCapacity(member: ReplanMember): number {
  const capacity = member.weekly_capacity_hours
  if (typeof capacity !== 'number' || !Number.isFinite(capacity) || capacity <= 0) return 0
  const unavailable = (member.unavailable_weekdays ?? []) as readonly number[]
  const days = [1, 2, 3, 4, 5].filter((d) => !unavailable.includes(d)).length
  return days === 0 ? 0 : capacity / days
}

/** Heures disponibles du membre entre deux dates (bornes comprises). */
export function availableHours(member: ReplanMember, from: string, to: string): number {
  const perDay = dailyCapacity(member)
  if (perDay === 0 || from > to) return 0
  let total = 0
  for (let day = from; day <= to; day = addDays(day, 1)) if (isWorkingDay(member, day)) total += perDay
  return total
}

/** Premier jour travaillé du membre à partir de `from` (compris), ou null. */
export function nextWorkingDay(member: ReplanMember | null, from: string): string | null {
  for (let i = 0, day = from; i < SEARCH_DAYS; i++, day = addDays(day, 1)) {
    if (member ? isWorkingDay(member, day) : isoWeekday(day) <= 5) return day
  }
  return null
}

/** Dernier jour travaillé du membre jusqu'à `to` (compris) et pas avant `min`, ou null. */
function previousWorkingDay(member: ReplanMember | null, to: string, min: string): string | null {
  for (let day = to; day >= min; day = addDays(day, -1)) {
    if (member ? isWorkingDay(member, day) : isoWeekday(day) <= 5) return day
  }
  return null
}

function worksBetween(member: ReplanMember, from: string, to: string): boolean {
  for (let day = from; day <= to; day = addDays(day, 1)) if (isWorkingDay(member, day)) return true
  return false
}

const PRIORITY_RANK: Record<TaskPriority, number> = { low: 0, medium: 1, high: 2 }

/* ---------- Analyse ---------- */

export function analyzePlanning(input: ReplanInput): ReplanAnalysis {
  const { today } = input
  const week = planningWeek(today)
  const fromDay = today > week.start ? today : week.start
  const friday = addDays(week.start, 4)
  const excluded = input.excludedTaskIds ?? new Set<string>()
  const members = new Map(input.members.map((m) => [m.id, m]))
  const tasksById = new Map(input.tasks.map((t) => [t.id, t]))
  const open = input.tasks.filter((t) => t.status !== 'done')
  const inScope = (task: ReplanTask) => !input.projectId || task.project_id === input.projectId
  const editable = (task: ReplanTask) => inScope(task) && !excluded.has(task.id)
  const projectName = (task: ReplanTask) => input.projectNames?.get(task.project_id) ?? null
  const taskRef = (task: ReplanTask) => `« ${task.title.trim()} »${projectName(task) ? ` (${projectName(task)})` : ''}`
  const nameOf = (id: string | null) => (id ? (members.get(id)?.name ?? 'un ancien membre') : 'personne')

  // Heures dues d'ici la fin de la semaine (retards compris), par membre.
  const dueHours = new Map<string, number>()
  for (const task of open) {
    if (!task.assignee_member_id || !task.due_date || task.due_date > week.end) continue
    dueHours.set(task.assignee_member_id, (dueHours.get(task.assignee_member_id) ?? 0) + taskHours(task))
  }
  const weekAvailable = new Map<string, number>()
  const availableOf = (member: ReplanMember) => {
    let value = weekAvailable.get(member.id)
    if (value === undefined) {
      value = availableHours(member, fromDay, friday)
      weekAvailable.set(member.id, value)
    }
    return value
  }
  const roomOf = (member: ReplanMember) => availableOf(member) - (dueHours.get(member.id) ?? 0)

  const candidates = new Map<string, ReplanCandidate>()
  const issues: ReplanIssue[] = []

  function addCandidate(candidate: ReplanCandidate): string {
    if (!candidates.has(candidate.id)) candidates.set(candidate.id, candidate)
    return candidate.id
  }

  /** Membres compétents qui peuvent reprendre la tâche : travaillent avant l'échéance et ont la place. */
  function reassignCandidates(task: ReplanTask): string[] {
    const hours = taskHours(task)
    const deadline = task.due_date && task.due_date >= fromDay ? task.due_date : null
    const pool = assignmentCandidates(input.members, input.projectMembers?.get(task.project_id) ?? [])
    const ranked = pool
      .filter((m) => m.id !== task.assignee_member_id)
      .filter((m) => skillLevel(m, task.skill) >= 1)
      .filter((m) => roomOf(m) + EPSILON >= hours)
      .filter((m) => worksBetween(m, fromDay, deadline ?? friday))
      .sort((a, b) => skillLevel(b, task.skill) - skillLevel(a, task.skill) || roomOf(b) - roomOf(a) || a.name.localeCompare(b.name, 'fr') || a.id.localeCompare(b.id))
      .slice(0, MAX_REASSIGN_CANDIDATES)
    return ranked.map((m) =>
      addCandidate({
        id: `reassign:${task.id}:${m.id}`,
        kind: 'reassign_task',
        taskId: task.id,
        projectId: task.project_id,
        before: { assignee_member_id: task.assignee_member_id },
        after: { assignee_member_id: m.id },
        memberIds: [task.assignee_member_id, m.id].filter((id): id is string => id !== null),
        label: `Réattribuer ${taskRef(task)} de ${nameOf(task.assignee_member_id)} à ${m.name} (niveau ${task.skill} ${skillLevel(m, task.skill)}/5, ${formatHours(roomOf(m))} libres cette semaine)`,
      }),
    )
  }

  function moveDueCandidate(task: ReplanTask, newDate: string | null, why: string): string[] {
    if (!newDate || newDate === task.due_date || newDate < today) return []
    return [
      addCandidate({
        id: `due:${task.id}:${newDate}`,
        kind: 'move_due_date',
        taskId: task.id,
        projectId: task.project_id,
        before: { due_date: task.due_date },
        after: { due_date: newDate },
        memberIds: task.assignee_member_id ? [task.assignee_member_id] : [],
        label: `Décaler l'échéance de ${taskRef(task)} du ${formatShortDate(task.due_date)} au ${formatShortDate(newDate)} (${why})`,
      }),
    ]
  }

  // 1. Semaine qui déborde.
  for (const member of input.members) {
    if (member.removed_at !== null) continue
    const due = dueHours.get(member.id) ?? 0
    const available = availableOf(member)
    if (due <= available + EPSILON) continue
    const movable = open
      .filter((t) => t.assignee_member_id === member.id && t.status === 'todo' && t.due_date && t.due_date <= week.end && editable(t))
      .sort(
        (a, b) =>
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          (b.due_date ?? '').localeCompare(a.due_date ?? '') ||
          taskHours(b) - taskHours(a) ||
          a.id.localeCompare(b.id),
      )
    if (movable.length === 0) continue
    const excess = due - available
    const chosen: ReplanTask[] = []
    let freed = 0
    for (const task of movable) {
      if (freed + EPSILON >= excess) break
      chosen.push(task)
      freed += taskHours(task)
    }
    const nextWeekDay = nextWorkingDay(member, addDays(week.end, 1))
    const ids = chosen.flatMap((task) => [
      ...reassignCandidates(task),
      ...(task.priority === 'high' ? [] : moveDueCandidate(task, nextWeekDay, 'semaine suivante')),
    ])
    if (ids.length === 0) continue
    issues.push({
      id: `overload:${member.id}`,
      type: 'overload',
      summary: `${member.name} a ${formatHours(due)} de tâches dues d'ici le ${formatShortDate(week.end)} pour ${formatHours(available)} disponibles cette semaine (${formatHours(excess)} de trop).`,
      memberId: member.id,
      taskIds: chosen.map((t) => t.id),
      candidateIds: ids,
    })
  }

  // 2. Tâche bloquante : dépend d'une tâche non faite dont l'échéance est après la sienne.
  for (const task of open) {
    if (!task.depends_on_task_id || !task.due_date || !inScope(task)) continue
    const dependency = tasksById.get(task.depends_on_task_id)
    if (!dependency || dependency.status === 'done' || !dependency.due_date || dependency.due_date <= task.due_date) continue
    const depAssignee = dependency.assignee_member_id ? (members.get(dependency.assignee_member_id) ?? null) : null
    const taskAssignee = task.assignee_member_id ? (members.get(task.assignee_member_id) ?? null) : null
    const ids: string[] = []
    if (editable(dependency)) {
      const earlier = previousWorkingDay(depAssignee, addDays(task.due_date, -1), today)
      ids.push(...moveDueCandidate(dependency, earlier, `pour être finie avant ${taskRef(task)}`))
    }
    if (editable(task)) {
      const later = nextWorkingDay(taskAssignee, addDays(dependency.due_date, 1))
      ids.push(...moveDueCandidate(task, later, `après ${taskRef(dependency)}`))
    }
    if (ids.length === 0) continue
    issues.push({
      id: `blocked:${task.id}`,
      type: 'blocked',
      summary: `${taskRef(task)} (échéance ${formatShortDate(task.due_date)}) dépend de ${taskRef(dependency)}, pas terminée, dont l'échéance est le ${formatShortDate(dependency.due_date)}.`,
      memberId: task.assignee_member_id,
      taskIds: [task.id, dependency.id],
      candidateIds: ids,
    })
  }

  // 3. Urgence : priorité haute en retard, sans personne, ou due avant que la personne soit disponible.
  for (const task of open) {
    if (task.priority !== 'high' || !task.due_date || !editable(task)) continue
    const assignee = task.assignee_member_id ? (members.get(task.assignee_member_id) ?? null) : null
    const activeAssignee = assignee && canBeAutoAssigned(assignee) ? assignee : null
    let summary: string | null = null
    let newDate: string | null = null
    if (task.due_date < today) {
      summary = `${taskRef(task)} est en priorité haute et en retard (échéance ${formatShortDate(task.due_date)}).`
      newDate = activeAssignee ? nextWorkingDay(activeAssignee, today) : null
    } else if (!activeAssignee) {
      summary = `${taskRef(task)} est en priorité haute, échéance ${formatShortDate(task.due_date)}, et personne de disponible n'y est attribué.`
    } else if (!worksBetween(activeAssignee, today, task.due_date)) {
      summary = `${taskRef(task)} est en priorité haute, échéance ${formatShortDate(task.due_date)}, mais ${activeAssignee.name} n'est pas disponible d'ici là.`
      newDate = nextWorkingDay(activeAssignee, addDays(task.due_date, 1))
    }
    if (!summary) continue
    const ids = [...reassignCandidates(task), ...moveDueCandidate(task, newDate, `prochain jour disponible de ${activeAssignee?.name ?? 'la personne'}`)]
    if (ids.length === 0) continue
    issues.push({ id: `urgent:${task.id}`, type: 'urgent', summary, memberId: task.assignee_member_id, taskIds: [task.id], candidateIds: ids })
  }

  return { weekStart: week.start, weekEnd: week.end, issues, candidates: [...candidates.values()] }
}

/* ---------- Choix de Claude → propositions ---------- */

/** Une proposition telle que rédigée par Claude : ids de candidats + textes. */
export interface ReplanChoice {
  candidate_ids: readonly string[]
  title: string
  explanation: string
}

export interface ReplanDraft {
  kind: AiProposalKind
  projectId: string | null
  title: string
  explanation: string
  operations: AiProposalOperation[]
  memberIds: string[]
}

export const PROPOSAL_TITLE_MAX = 200
export const PROPOSAL_EXPLANATION_MAX = 4000

const clean = (text: string) => text.replace(/\s+/g, ' ').replace(/\s*—\s*/g, ', ').trim()

/**
 * Valide le choix de Claude : chaque id doit être un candidat de l'analyse (sinon la proposition est rejetée),
 * un candidat ne sert qu'une fois, une tâche n'a qu'une opération par proposition. Type : celui des opérations
 * s'il est unique, sinon « reorder ». Projet : celui de toutes les tâches s'il est commun.
 */
export function buildProposals(
  analysis: Pick<ReplanAnalysis, 'candidates'>,
  choices: readonly ReplanChoice[],
): { drafts: ReplanDraft[]; rejected: { choice: ReplanChoice; reason: string }[] } {
  const byId = new Map(analysis.candidates.map((c) => [c.id, c]))
  const used = new Set<string>()
  const drafts: ReplanDraft[] = []
  const rejected: { choice: ReplanChoice; reason: string }[] = []

  for (const choice of choices) {
    const ids = [...new Set(choice.candidate_ids)]
    if (ids.length === 0) {
      rejected.push({ choice, reason: 'aucune opération' })
      continue
    }
    const unknown = ids.filter((id) => !byId.has(id))
    if (unknown.length > 0) {
      rejected.push({ choice, reason: `opération hors liste : ${unknown.join(', ')}` })
      continue
    }
    const picked = ids.map((id) => byId.get(id) as ReplanCandidate)
    if (ids.some((id) => used.has(id))) {
      rejected.push({ choice, reason: 'opération déjà utilisée par une autre proposition' })
      continue
    }
    const taskIds = picked.map((c) => c.taskId)
    if (new Set(taskIds).size !== taskIds.length) {
      rejected.push({ choice, reason: 'deux opérations sur la même tâche' })
      continue
    }
    for (const id of ids) used.add(id)

    const kinds = new Set(picked.map((c) => c.kind))
    const projects = new Set(picked.map((c) => c.projectId))
    const title = clean(choice.title).slice(0, PROPOSAL_TITLE_MAX) || clean(picked[0]?.label ?? 'Réorganisation').slice(0, PROPOSAL_TITLE_MAX)
    const explanation = choice.explanation.replace(/\s*—\s*/g, ', ').trim().slice(0, PROPOSAL_EXPLANATION_MAX) || picked.map((c) => c.label).join('\n')
    drafts.push({
      kind: kinds.size === 1 ? (picked[0] as ReplanCandidate).kind : 'reorder',
      projectId: projects.size === 1 ? (picked[0] as ReplanCandidate).projectId : null,
      title,
      explanation,
      operations: picked.map((c) => ({ task_id: c.taskId, before: { ...c.before }, after: { ...c.after } })),
      memberIds: [...new Set(picked.flatMap((c) => c.memberIds))],
    })
  }
  return { drafts, rejected }
}

/** Empreinte des opérations (tâche + valeurs après) : deux propositions identiques ont la même. */
export function operationsSignature(operations: readonly AiProposalOperation[] | null | undefined): string {
  return (operations ?? [])
    .map((op) => {
      const after = Object.entries(op.after ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${JSON.stringify(value ?? null)}`)
        .join('&')
      return `${op.task_id}|${after}`
    })
    .sort()
    .join(';')
}

/** La règle « Toujours » active couvre ce type de proposition et ce projet ({} = toute l'organisation). */
export function ruleCovers(rule: Pick<AiAutonomyRule, 'kind' | 'scope' | 'revoked_at'>, kind: AiProposalKind, projectId: string | null): boolean {
  if (rule.revoked_at !== null || rule.kind !== kind) return false
  const scoped = rule.scope?.project_id
  if (scoped === undefined || scoped === null) return true
  return projectId !== null && scoped === projectId
}
