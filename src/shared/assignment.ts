/**
 * Attribution, faite par le code (pas par l'IA). Partagée par l'API (tickets proposés) et le front.
 *
 * Un ticket entier va à UNE personne (toutes ses tâches) : la moins chargée, avec un bonus pour qui a
 * déjà travaillé sur la même partie du projet (« Finance », « Juridique »…), car elle y sera plus rapide.
 * La charge est RELATIVE à la capacité hebdomadaire : (heures ouvertes - bonus d'habitude + heures du
 * ticket) ÷ capacité, donc 20 h sur 35 h pèse autant que 10 h sur 17,5 h. Capacité 0, absente ou non
 * finie = jamais attribué automatiquement. Un membre indisponible aujourd'hui (jour de la semaine, fuseau
 * Europe/Paris, dans `unavailable_weekdays`) passe après tous les membres disponibles ; si tous le sont,
 * le moins chargé est choisi quand même.
 * La compétence (design / dev) reste une étiquette de tâche : chacun fait un peu des deux.
 * Aucune dépendance Node.
 */
import type { Member, Skill, Weekday } from './types.js'

export type AssignableMember = Pick<Member, 'id' | 'name' | 'skills'>

/** Membre avec sa capacité et ses jours indisponibles, tel que lu pour la charge relative. */
export type PickableMember = AssignableMember & {
  weekly_capacity_hours?: number | null
  unavailable_weekdays?: readonly Weekday[] | null
}

/** Jour de la semaine ISO (1 = lundi … 7 = dimanche) à Paris pour cet instant. */
export function parisWeekday(date: Date): Weekday {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' }).format(date)
  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(name)
  return (index + 1) as Weekday
}

/** Membre tel que lu pour choisir les candidats à l'attribution automatique. */
export type CandidateMember = Pick<Member, 'id' | 'role' | 'removed_at'>

/** Actif (pas retiré) et rôle admin ou membre : seul ce membre peut recevoir un ticket automatiquement. */
export function canBeAutoAssigned(member: { role: string; removed_at: string | null }): boolean {
  // Seuls admin et membre : exclut prospection, finance et tout rôle futur.
  return member.removed_at === null && (member.role === 'admin' || member.role === 'membre')
}

/**
 * Candidats à l'attribution automatique d'un projet : les membres actifs hors prospection.
 * Si le projet a des membres affectés (project_members), seulement ceux-là ; si aucun d'eux n'est
 * attribuable (tous retirés ou en prospection), retour à toute l'équipe attribuable.
 * Liste vide = les tickets restent sans personne.
 */
export function assignmentCandidates<T extends CandidateMember>(
  members: readonly T[],
  projectMemberIds: readonly string[],
): T[] {
  const eligible = members.filter(canBeAutoAssigned)
  if (projectMemberIds.length === 0) return eligible
  const onProject = new Set(projectMemberIds)
  const restricted = eligible.filter((m) => onProject.has(m.id))
  return restricted.length > 0 ? restricted : eligible
}

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
  const rounded = Math.round(hours * 100) / 100
  return `${String(rounded).replace('.', ',')} h`
}

/** Capacité hebdomadaire utilisable : un nombre fini strictement positif, sinon null (jamais attribué). */
function usableCapacity(member: PickableMember): number | null {
  const cap = member.weekly_capacity_hours
  return typeof cap === 'number' && Number.isFinite(cap) && cap > 0 ? cap : null
}

const SCORE_EPSILON = 1e-9

/**
 * Personne qui prend le ticket : charge relative la plus faible, soit
 * (heures ouvertes - bonus d'habitude sur la même partie + heures du ticket) ÷ capacité hebdomadaire.
 * Exclus : capacité 0, absente ou non finie. Les indisponibles aujourd'hui passent après les autres.
 * Égalité : nom puis id. `null` s'il n'y a aucun membre attribuable.
 * `options.weekday` (ou `options.today`) rend le jour injectable pour les tests ; par défaut, maintenant.
 */
export function pickTicketAssignee<T extends PickableMember>(
  members: readonly T[],
  ticket: { area: string | null; hours?: number },
  workload: TeamWorkload,
  options: { today?: Date; weekday?: Weekday } = {},
): TicketAssignment<T> | null {
  const key = areaKey(ticket.area)
  const weekday = options.weekday ?? parisWeekday(options.today ?? new Date())
  const ticketHoursValue = ticket.hours !== undefined && Number.isFinite(ticket.hours) ? ticket.hours : 0

  interface Scored {
    member: T
    score: number
    load: number
    capacity: number
    familiar: number
    away: boolean
  }
  const scored: Scored[] = []
  for (const member of members) {
    const capacity = usableCapacity(member)
    if (capacity === null) continue
    const load = workload.openHours.get(member.id) ?? 0
    const familiar = key ? (workload.areaTickets.get(member.id)?.get(key) ?? 0) : 0
    const bonus = FAMILIARITY_HOURS_PER_TICKET * Math.min(familiar, FAMILIARITY_MAX_TICKETS)
    const score = (load - bonus + ticketHoursValue) / capacity
    const away = member.unavailable_weekdays?.includes(weekday) ?? false
    scored.push({ member, score, load, capacity, familiar, away })
  }

  const better = (a: Scored, b: Scored): boolean => {
    if (a.away !== b.away) return !a.away
    if (Math.abs(a.score - b.score) > SCORE_EPSILON) return a.score < b.score
    return before(a.member, b.member)
  }
  let best: Scored | null = null
  for (const entry of scored) if (best === null || better(entry, best)) best = entry
  if (!best) return null

  const chosen = best
  const leastLoaded = scored.every((s) => s.member.id === chosen.member.id || s.score >= chosen.score - SCORE_EPSILON)
  const parts: string[] = []
  if (chosen.familiar > 0 && ticket.area) {
    parts.push(`a déjà travaillé sur « ${ticket.area.trim()} » (${chosen.familiar} ticket${chosen.familiar > 1 ? 's' : ''})`)
  }
  if (leastLoaded) parts.push(`le moins de travail en cours (${formatHours(chosen.load)})`)
  else parts.push(`${formatHours(chosen.load)} en cours`)
  parts.push(`capacité ${formatHours(chosen.capacity)} par semaine`)
  if (chosen.away) parts.push("indisponible aujourd'hui, mais tout le monde l'est")
  return { member: chosen.member, note: `${chosen.member.name} : ${parts.join(', ')}` }
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
