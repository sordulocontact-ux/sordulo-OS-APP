import type { Input, Ticket } from '../../shared/types'

export type RoundInput = Pick<Input, 'id' | 'quote_id'>
export type RoundTicket = Pick<Ticket, 'input_id' | 'status'>

/**
 * Un round de retours = une entrée du projet (réunion ou retour écrit) qui a donné au moins un ticket
 * validé ou fait. Les entrées créées depuis un devis (quote_id non nul) n'en sont pas : c'est le devis
 * lui-même, pas un retour du client.
 */
export function countFeedbackRounds(inputs: RoundInput[], tickets: RoundTicket[]): number {
  const productive = new Set<string>()
  for (const t of tickets) {
    if (t.input_id !== null && (t.status === 'validated' || t.status === 'done')) productive.add(t.input_id)
  }
  return inputs.filter((i) => i.quote_id === null && productive.has(i.id)).length
}

export interface RoundsState {
  count: number
  included: number
  /** Rounds au-delà de ceux prévus (0 si rien de dépassé). */
  extra: number
  exceeded: boolean
  /** Dernier round compris : le prochain sera hors devis. */
  atLimit: boolean
}

export function roundsState(count: number, included: number): RoundsState {
  const extra = Math.max(0, count - included)
  return { count, included, extra, exceeded: extra > 0, atLimit: count === included && included > 0 }
}

/** « Retours : 3 sur 2 prévus ». */
export function roundsLabel(state: RoundsState): string {
  return `Retours : ${state.count} sur ${state.included} prévu${state.included > 1 ? 's' : ''}`
}

/** « 1 round hors devis : à facturer ou à négocier. » ; null tant que rien n'est dépassé. */
export function roundsAlert(state: RoundsState): string | null {
  if (!state.exceeded) return null
  return `${state.extra} round${state.extra > 1 ? 's' : ''} de retours au-delà du devis : à facturer ou à négocier.`
}
