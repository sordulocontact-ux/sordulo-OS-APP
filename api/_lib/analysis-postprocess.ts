/**
 * Pure post-processing of the AI analysis (no network): checks what the structured output
 * schema cannot express (known ids, index bounds, finite estimates).
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

/** Valid index of another task of the same ticket, else null. */
function validDependency(index: number | null, self: number, count: number): number | null {
  if (index === null || !Number.isInteger(index)) return null
  if (index < 0 || index >= count || index === self) return null
  return index
}

/** Breaks dependency cycles (a -> b -> a): the first task of a cycle loses its dependency. */
function breakCycles(deps: (number | null)[]): (number | null)[] {
  const result = [...deps]
  for (let start = 0; start < result.length; start++) {
    const seen = new Set<number>([start])
    let current = result[start] ?? null
    while (current !== null) {
      if (seen.has(current)) {
        if (current === start) result[start] = null
        break
      }
      seen.add(current)
      current = result[current] ?? null
    }
  }
  return result
}

export function postProcessAnalysis(analysis: Analysis, openTicketIds: readonly string[]): ProcessedTicket[] {
  const knownIds = new Map(openTicketIds.map((id) => [id.trim().toLowerCase(), id]))

  return analysis.tickets.map((ticket) => {
    const count = ticket.tasks.length
    const deps = breakCycles(ticket.tasks.map((task, i) => validDependency(task.depends_on_index, i, count)))
    const related = ticket.related_ticket_id ? (knownIds.get(ticket.related_ticket_id.trim().toLowerCase()) ?? null) : null
    const quote = ticket.source_quote.trim()
    const area = ticket.area.replace(/\s+/g, ' ').trim().slice(0, AREA_MAX_LENGTH).trim()

    return {
      title: ticket.title.trim(),
      description: ticket.description.trim(),
      type: ticket.type,
      priority: ticket.priority,
      source_quote: quote === '' ? null : quote,
      area: area === '' ? null : area,
      related_ticket_id: related,
      tasks: ticket.tasks.map((task, i) => ({
        title: task.title.trim(),
        skill: task.skill,
        estimate_hours: Number.isFinite(task.estimate_hours) && task.estimate_hours >= 0 ? task.estimate_hours : null,
        depends_on_index: deps[i] ?? null,
      })),
    }
  })
}
