/**
 * Attribution, faite par le code (pas par l'IA). Partagée par l'API (tickets proposés) et le front.
 *
 * Un ticket entier va à UNE personne (toutes ses tâches) : la moins chargée, avec un bonus pour qui a
 * déjà travaillé sur la même partie du projet (« Finance », « Juridique »…), car elle y sera plus rapide.
 * La compétence (design / dev) reste une étiquette de tâche : chacun fait un peu des deux.
 * Aucune dépendance Node.
 */
import type { Member, Skill } from './types.js'

export type AssignableMember = Pick<Member, 'id' | 'name' | 'skills'>

/** Heures d'avance accordées par ticket déjà fait sur la même partie… */
export const FAMILIARITY_HOURS_PER_TICKET = 3
/** …dans la limite de ce nombre de tickets (au-delà, l'habitude n'accélère plus). */
export const FAMILIARITY_MAX_TICKETS = 3
/** Durée prise pour une tâche sans estimation. */
export const DEFAULT_TASK_HOURS = 1

/** Level of a member in a skill. Missing or invalid level = 0. */
export function skillLevel(member: Pick<Member, 'skills'>, skill: Skill): number {
  const level = member.skills?.[skill]
  return typeof level === 'number' && Number.isFinite(level) ? level : 0
}

function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function before(a: AssignableMember, b: AssignableMember): boolean {
  const byName = compareText(a.name, b.name)
  return byName < 0 || (byName === 0 && compareText(a.id, b.id) < 0)
}

/**
 * Best member for a skill (highest level). Ties: name, then id. `null` if there is no member.
 * Kept as a fallback when nothing else is known (no workload, no history).
 */
export function pickAssignee<T extends AssignableMember>(skill: Skill, members: readonly T[]): T | null {
  let best: T | null = null
  for (const member of members) {
    if (best === null) {
      best = member
      continue
    }
    const diff = skillLevel(member, skill) - skillLevel(best, skill)
    if (diff > 0 || (diff === 0 && before(member, best))) best = member
  }
  return best
}

/** Clé de comparaison d'une partie du produit : minuscules, sans accents ni espaces superflus. */
export function areaKey(area: string | null | undefined): string | null {
  const key = (area ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return key === '' ? null : key
}

/** Total d'heures d'un ticket (une tâche sans estimation compte DEFAULT_TASK_HOURS). */
export function ticketHours(tasks: readonly { estimate_hours: number | null }[]): number {
  return tasks.reduce(
    (sum, task) => sum + (task.estimate_hours !== null && Number.isFinite(task.estimate_hours) ? task.estimate_hours : DEFAULT_TASK_HOURS),
    0,
  )
}

export interface TeamWorkload {
  /** Heures de travail en cours par membre (tâches de tickets validés, pas encore faites). */
  openHours: Map<string, number>
  /** Tickets déjà faits ou validés par membre, par partie du produit (clé areaKey). */
  areaTickets: Map<string, Map<string, number>>
}

export function emptyWorkload(): TeamWorkload {
  return { openHours: new Map(), areaTickets: new Map() }
}

export interface TicketAssignment<T> {
  member: T
  /** Raison lisible, affichée sur l'écran de validation. */
  note: string
}

function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10
  return `${String(rounded).replace('.', ',')} h`
}

/**
 * Personne qui prend le ticket : charge actuelle la plus faible, moins un bonus d'habitude sur la même
 * partie. Égalité : nom puis id. `null` s'il n'y a aucun membre.
 */
export function pickTicketAssignee<T extends AssignableMember>(
  members: readonly T[],
  ticket: { area: string | null },
  workload: TeamWorkload,
): TicketAssignment<T> | null {
  const key = areaKey(ticket.area)
  let best: { member: T; score: number; load: number; familiar: number } | null = null
  for (const member of members) {
    const load = workload.openHours.get(member.id) ?? 0
    const familiar = key ? (workload.areaTickets.get(member.id)?.get(key) ?? 0) : 0
    const score = load - FAMILIARITY_HOURS_PER_TICKET * Math.min(familiar, FAMILIARITY_MAX_TICKETS)
    if (best === null || score < best.score || (score === best.score && before(member, best.member))) {
      best = { member, score, load, familiar }
    }
  }
  if (!best) return null

  const others = members.filter((m) => m.id !== best.member.id)
  const leastLoaded = others.every((m) => (workload.openHours.get(m.id) ?? 0) >= best.load)
  const parts: string[] = []
  if (best.familiar > 0 && ticket.area) {
    parts.push(`a déjà travaillé sur « ${ticket.area.trim()} » (${best.familiar} ticket${best.familiar > 1 ? 's' : ''})`)
  }
  if (leastLoaded) parts.push(`la moins chargée (${formatHours(best.load)} en cours)`)
  else parts.push(`${formatHours(best.load)} en cours`)
  return { member: best.member, note: `${best.member.name} : ${parts.join(', ')}` }
}

/** Ajoute un ticket attribué à la charge (pour répartir les tickets suivants d'une même analyse). */
export function addToWorkload(workload: TeamWorkload, memberId: string, hours: number, area: string | null): void {
  workload.openHours.set(memberId, (workload.openHours.get(memberId) ?? 0) + hours)
  const key = areaKey(area)
  if (!key) return
  const byArea = workload.areaTickets.get(memberId) ?? new Map<string, number>()
  byArea.set(key, (byArea.get(key) ?? 0) + 1)
  workload.areaTickets.set(memberId, byArea)
}
