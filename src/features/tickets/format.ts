import { LABELS, type Input, type TicketStatus } from '../../shared/types'
import type { BadgeTone } from '../../components/ui'

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

export function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date)
}

/** Title of an input, or "Réunion du …" / "Retour écrit du …". */
export function inputLabel(input: Pick<Input, 'title' | 'kind' | 'created_at'>): string {
  const title = input.title?.trim()
  if (title) return title
  return `${LABELS.inputKind[input.kind]} du ${formatDate(input.created_at)}`
}

export const STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  proposed: 'warning',
  validated: 'info',
  rejected: 'neutral',
  done: 'success',
}

export const PRIORITY_TONE = { low: 'neutral', medium: 'info', high: 'danger' } as const satisfies Record<string, BadgeTone>
