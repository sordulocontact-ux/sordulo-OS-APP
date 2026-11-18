import type { BadgeTone } from '../../components/ui'
import { LABELS, type Input, type InputStatus } from '../../shared/types'

/** Statuses during which the server is working: the front polls. */
export function isInputActive(status: InputStatus): boolean {
  return status === 'uploaded' || status === 'transcribing' || status === 'analyzing'
}

export const STATUS_TONES: Record<InputStatus, BadgeTone> = {
  uploaded: 'neutral',
  transcribing: 'info',
  analyzing: 'info',
  ready: 'success',
  error: 'danger',
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Title, else start of the text, else "Réunion du <date>". */
export function inputTitle(input: Pick<Input, 'kind' | 'title' | 'raw_text' | 'created_at'>): string {
  const title = input.title?.trim()
  if (title) return title
  if (input.kind === 'written') {
    const text = input.raw_text?.trim().replace(/\s+/g, ' ')
    if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text
    return `Retour écrit du ${new Date(input.created_at).toLocaleDateString('fr-FR')}`
  }
  return `Réunion du ${new Date(input.created_at).toLocaleDateString('fr-FR')}`
}

export function kindLabel(kind: Input['kind']): string {
  return LABELS.inputKind[kind]
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`
}

export function reviewPath(projectId: string, inputId: string): string {
  return `/projects/${projectId}/inputs/${inputId}/review`
}

/** « 1 tâche », « 3 tâches », « 0 ticket ». */
export function countLabel(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? 's' : ''}`
}
