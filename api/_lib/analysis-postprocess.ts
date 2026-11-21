/**
 * Pure post-processing of the AI analysis (no network): checks what the structured output
 * schema cannot express (known ids, finite estimates) and keeps one task per ticket.
 */
import type { Analysis } from '../../src/shared/analysis-schema.js'
import type { Skill, TicketPriority, TicketType } from '../../src/shared/types.js'

export interface ProcessedTask {
  title: string
  skill: Skill
  estimate_hours: number | null
  depends_on_index: number | null
}

export interface ProcessedTicket {
  title: string
  description: string
  type: TicketType
  priority: TicketPriority
  source_quote: string | null
  /** Partie du produit concernée, null si l'analyse n'en donne pas. */
  area: string | null
  related_ticket_id: string | null
  /** Personne désignée par les consignes du projet (id d'équipe vérifié), null = le code choisit. */
  assignee_member_id: string | null
  /** Raison de cette attribution, null si aucune personne n'est désignée. */
  assignment_reason: string | null
  tasks: ProcessedTask[]
}

/** Longueur maximale d'une partie du produit (« Finance », « Page d'accueil »). */
export const AREA_MAX_LENGTH = 40
/** Longueur maximale d'une raison d'attribution donnée par l'IA. */
export const ASSIGNMENT_REASON_MAX_LENGTH = 200

/** Index insensible à la casse : id normalisé -> id d'origine. */
export function idLookup(ids: readonly string[]): Map<string, string> {
  return new Map(ids.map((id) => [id.trim().toLowerCase(), id]))
}

/** Id connu (sans tenir compte de la casse ni des espaces), sinon null. */
export function knownId(lookup: ReadonlyMap<string, string>, value: string | null | undefined): string | null {
  return value ? (lookup.get(value.trim().toLowerCase()) ?? null) : null
}

/** Partie du produit sur une ligne, bornée, null si vide. */
export function cleanArea(value: string | null | undefined): string | null {
  const area = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, AREA_MAX_LENGTH).trim()
  return area === '' ? null : area
}

/** Raison d'attribution sur une ligne, bornée, null si vide. */
export function cleanAssignmentReason(value: string | null | undefined): string | null {
  const reason = (value ?? '').replace(/\s+/g, ' ').trim().slice(0, ASSIGNMENT_REASON_MAX_LENGTH).trim()
  return reason === '' ? null : reason
}

/** Personne désignée par l'IA, gardée seulement si son id est dans l'équipe ; la raison suit l'id. */
export function cleanAssignment(
  teamLookup: ReadonlyMap<string, string>,
  memberId: string | null | undefined,
  reason: string | null | undefined,
): { assignee_member_id: string | null; assignment_reason: string | null } {
  const id = knownId(teamLookup, memberId)
  return { assignee_member_id: id, assignment_reason: id ? cleanAssignmentReason(reason) : null }
}

export function validEstimate(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Un ticket = une tâche : l'équipe confie le ticket entier à Claude (skill « /ticket »), qui le découpe
 * lui-même. Si l'analyse renvoie plusieurs tâches, elles sont fusionnées : titre du ticket, compétence
 * qui pèse le plus d'heures (dev en cas d'égalité), durée totale. Aucune tâche : une tâche dev sans durée.
 */
export function mergeTasks(ticketTitle: string, tasks: Analysis['tickets'][number]['tasks']): ProcessedTask {
  const estimates = tasks.map((t) => validEstimate(t.estimate_hours))
  const known = estimates.filter((e): e is number => e !== null)
  const hoursBySkill = new Map<Skill, number>()
  tasks.forEach((t, i) => hoursBySkill.set(t.skill, (hoursBySkill.get(t.skill) ?? 0) + (estimates[i] ?? 0)))
  const design = hoursBySkill.get('design') ?? 0
  const dev = hoursBySkill.get('dev') ?? 0
  const skill: Skill = tasks.length > 0 && design > dev ? 'design' : tasks.length > 0 && !hoursBySkill.has('dev') ? 'design' : 'dev'
  const single = tasks.length === 1 ? tasks[0] : undefined
  return {
    title: single ? single.title.trim() || ticketTitle : ticketTitle,
    skill: single ? single.skill : skill,
    estimate_hours: known.length > 0 ? known.reduce((a, b) => a + b, 0) : null,
    depends_on_index: null,
  }
}

/**
 * `teamMemberIds` : les personnes qui peuvent recevoir un ticket (bloc <equipe> du prompt). Un
 * assignee_member_id hors de cette liste est ignoré (null), comme un related_ticket_id inconnu.
 */
export function postProcessAnalysis(
  analysis: Analysis,
  openTicketIds: readonly string[],
  teamMemberIds: readonly string[],
): ProcessedTicket[] {
  const knownIds = idLookup(openTicketIds)
  const team = idLookup(teamMemberIds)

  return analysis.tickets.map((ticket) => {
    const related = knownId(knownIds, ticket.related_ticket_id)
    const quote = ticket.source_quote.trim()
    const area = cleanArea(ticket.area)
    const title = ticket.title.trim()

    return {
      title,
      description: ticket.description.trim(),
      type: ticket.type,
      priority: ticket.priority,
      source_quote: quote === '' ? null : quote,
      area,
      related_ticket_id: related,
      ...cleanAssignment(team, ticket.assignee_member_id, ticket.assignment_reason),
      tasks: [mergeTasks(title, ticket.tasks)],
    }
  })
}
