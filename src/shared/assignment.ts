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
 * Niveau : à charge comparable (écart de score <= LOAD_TOLERANCE), celui qui a le meilleur niveau dans la
 * compétence du ticket passe devant. Absences datées (member_absences) : absent aujourd'hui, ou à
 * l'échéance de la tâche si elle en a une, = en dernier, comme un jour indisponible. Affinités : départage
 * seulement, quand niveau et charge comparables ne tranchent pas (affinité contenue dans la partie ou le
 * titre du ticket, sans accents ni casse).
 * Aucune dépendance Node.
 */
import type { Member, MemberAbsence, Skill, Weekday } from './types.js'

export type AssignableMember = Pick<Member, 'id' | 'name' | 'skills'>

/** Membre avec sa capacité et ses jours indisponibles, tel que lu pour la charge relative. */
export type PickableMember = AssignableMember & {
  weekly_capacity_hours?: number | null
  unavailable_weekdays?: readonly Weekday[] | null
  /** Sujets aimés (members.affinities) : départage seulement. */
  affinities?: readonly string[] | null
  /** Absences datées (member_absences), bornes comprises. */
  absences?: readonly AbsencePeriod[] | null
}

/** Période d'absence, AAAA-MM-JJ bornes comprises. */
export type AbsencePeriod = Pick<MemberAbsence, 'start_date' | 'end_date'>

/** Date AAAA-MM-JJ à Paris pour cet instant. */
export function parisDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** Le jour (AAAA-MM-JJ) tombe dans une des absences. Date invalide ou absente = faux. */
export function isAbsentOn(absences: readonly AbsencePeriod[] | null | undefined, day: string | null | undefined): boolean {
  if (!day || !absences) return false
  const iso = day.slice(0, 10)
  return absences.some((a) => a.start_date <= iso && iso <= a.end_date)
}

/** Première affinité contenue dans la partie ou le titre (sans accents ni casse), sinon null. */
export function matchingAffinity(affinities: readonly string[] | null | undefined, ...texts: (string | null | undefined)[]): string | null {
  if (!affinities) return null
  const haystacks = texts.map((t) => areaKey(t)).filter((t): t is string => t !== null)
  if (haystacks.length === 0) return null
  for (const affinity of affinities) {
    const key = areaKey(affinity)
    if (key && haystacks.some((h) => h.includes(key))) return affinity.trim()
  }
  return null
}

/** Écart de charge relative en dessous duquel deux membres ont une « charge comparable ». */
export const LOAD_TOLERANCE = 0.1

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
export function skillLevel(member: Pick<Member, 'skills'>, skill: Skill | string): number {
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
  ticket: {
    area: string | null
    hours?: number
    /** Titre du ticket : sert seulement aux affinités. */
    title?: string | null
    /** Compétence du ticket (« design », « dev », « motion »…) : le niveau départage à charge comparable. */
    skill?: string | null
    /** Échéance des tâches (AAAA-MM-JJ), si elle existe : un membre absent ce jour-là passe en dernier. */
    dueDate?: string | null
  },
  workload: TeamWorkload,
  options: { today?: Date; weekday?: Weekday } = {},
): TicketAssignment<T> | null {
  const key = areaKey(ticket.area)
  const now = options.today ?? new Date()
  const weekday = options.weekday ?? parisWeekday(now)
  const todayIso = parisDate(now)
  const skillKey = ticket.skill ? ticket.skill.trim().toLowerCase() : null
  const ticketHoursValue = ticket.hours !== undefined && Number.isFinite(ticket.hours) ? ticket.hours : 0

  interface Scored {
    member: T
    score: number
    load: number
    capacity: number
    familiar: number
    away: boolean
    absent: boolean
    level: number
    affinity: string | null
  }
  const scored: Scored[] = []
  for (const member of members) {
    const capacity = usableCapacity(member)
    if (capacity === null) continue
    const load = workload.openHours.get(member.id) ?? 0
    const familiar = key ? (workload.areaTickets.get(member.id)?.get(key) ?? 0) : 0
    const bonus = FAMILIARITY_HOURS_PER_TICKET * Math.min(familiar, FAMILIARITY_MAX_TICKETS)
    const score = (load - bonus + ticketHoursValue) / capacity
    const absent = isAbsentOn(member.absences, todayIso) || isAbsentOn(member.absences, ticket.dueDate)
    const away = (member.unavailable_weekdays?.includes(weekday) ?? false) || absent
    const level = skillKey ? skillLevel(member, skillKey) : 0
    const affinity = matchingAffinity(member.affinities, ticket.area, ticket.title)
    scored.push({ member, score, load, capacity, familiar, away, absent, level, affinity })
  }
  if (scored.length === 0) return null

  // Les disponibles d'abord ; si personne ne l'est, tout le monde reste en lice.
  const available = scored.filter((s) => !s.away)
  const pool = available.length > 0 ? available : scored
  const minScore = Math.min(...pool.map((s) => s.score))
  // Charge comparable : écart au moins chargé <= LOAD_TOLERANCE. Là, niveau puis affinité, puis charge, nom, id.
  const comparable = pool.filter((s) => s.score <= minScore + LOAD_TOLERANCE + SCORE_EPSILON)
  const better = (a: Scored, b: Scored): boolean => {
    if (a.level !== b.level) return a.level > b.level
    if ((a.affinity !== null) !== (b.affinity !== null)) return a.affinity !== null
    if (Math.abs(a.score - b.score) > SCORE_EPSILON) return a.score < b.score
    return before(a.member, b.member)
  }
  let best: Scored | null = null
  for (const entry of comparable) if (best === null || better(entry, best)) best = entry
  if (!best) return null

  const chosen = best
  const leastLoaded = scored.every((s) => s.member.id === chosen.member.id || s.score >= chosen.score - SCORE_EPSILON)
  const parts: string[] = []
  if (chosen.familiar > 0 && ticket.area) {
    parts.push(`a déjà travaillé sur « ${ticket.area.trim()} » (${chosen.familiar} ticket${chosen.familiar > 1 ? 's' : ''})`)
  }
  if (chosen.level > 0 && skillKey && comparable.length > 1) parts.push(`niveau ${chosen.level}/5 en ${skillKey}`)
  if (chosen.affinity) parts.push(`aime « ${chosen.affinity} »`)
  if (leastLoaded) parts.push(`le moins de travail en cours (${formatHours(chosen.load)})`)
  else parts.push(`${formatHours(chosen.load)} en cours`)
  parts.push(`capacité ${formatHours(chosen.capacity)} par semaine`)
  if (chosen.absent) parts.push("absent à la date concernée, mais tout le monde est indisponible")
  else if (chosen.away) parts.push("indisponible aujourd'hui, mais tout le monde l'est")
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
