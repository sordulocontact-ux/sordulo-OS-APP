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
  tasks: ProcessedTask[]
}

/** Longueur maximale d'une partie du produit (« Finance », « Page d'accueil »). */
export const AREA_MAX_LENGTH = 40

function validEstimate(value: number): number | null {
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

export function postProcessAnalysis(analysis: Analysis, openTicketIds: readonly string[]): ProcessedTicket[] {
  const knownIds = new Map(openTicketIds.map((id) => [id.trim().toLowerCase(), id]))

  return analysis.tickets.map((ticket) => {
    const related = ticket.related_ticket_id ? (knownIds.get(ticket.related_ticket_id.trim().toLowerCase()) ?? null) : null
    const quote = ticket.source_quote.trim()
    const area = ticket.area.replace(/\s+/g, ' ').trim().slice(0, AREA_MAX_LENGTH).trim()
    const title = ticket.title.trim()

    return {
      title,
      description: ticket.description.trim(),
      type: ticket.type,
      priority: ticket.priority,
      source_quote: quote === '' ? null : quote,
      area: area === '' ? null : area,
      related_ticket_id: related,
      tasks: [mergeTasks(title, ticket.tasks)],
    }
  })
}
