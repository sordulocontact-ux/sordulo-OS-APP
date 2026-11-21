import { LABELS, type Ticket } from '../../shared/types'

export interface TicketBriefContext {
  projectName: string
  clientName: string | null
  /** Origine de la citation (« Réunion du 12 novembre 2026 · 01:15 · Sacha »), null si inconnue. */
  quoteSource: string | null
}

/**
 * Texte à coller dans Claude Code : commence par « /ticket » pour lancer le skill directement,
 * suivi du titre, du contexte du projet, de la description et du passage d'origine.
 */
export function ticketBrief(
  ticket: Pick<Ticket, 'title' | 'description' | 'type' | 'priority' | 'area' | 'source_quote'>,
  context: TicketBriefContext,
): string {
  const project = context.clientName ? `${context.projectName} (client : ${context.clientName})` : context.projectName
  const meta = [
    `Type : ${LABELS.ticketType[ticket.type]}`,
    `Priorité : ${LABELS.ticketPriority[ticket.priority].toLowerCase()}`,
    ...(ticket.area ? [`Partie : ${ticket.area}`] : []),
  ].join(' · ')

  const parts = [`/ticket ${ticket.title.trim()}`, `Projet : ${project}\n${meta}`]
  const description = ticket.description.trim()
  if (description) parts.push(description)
  const quote = ticket.source_quote?.trim()
  if (quote) {
    const label = context.quoteSource ? `Passage de l'entrée (${context.quoteSource}) :` : "Passage de l'entrée :"
    parts.push(`${label}\n« ${quote} »`)
  }
  return parts.join('\n\n')
}
