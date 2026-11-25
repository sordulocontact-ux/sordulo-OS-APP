/**
 * Événement de l'app de bureau : l'île a validé ou refusé des tickets, la fenêtre principale relit les
 * tickets, les tâches et les entrées du projet (useIslandReviewSync). Émis par le front de l'île
 * (`emitTo('main', …)`), sans passer par Rust.
 */
export const REVIEW_CHANGED_EVENT = 'sordulo://review-changed'

export interface ReviewChangedPayload {
  projectId: string
  inputId: string
}

/** Écran de validation d'une entrée, sur un ticket (`?ticket=`) s'il est donné. */
export function reviewTicketRoute(projectId: string, inputId: string, ticketId?: string | null): string {
  const base = `/projects/${projectId}/inputs/${inputId}/review`
  return ticketId ? `${base}?ticket=${encodeURIComponent(ticketId)}` : base
}

/** Id DOM de la carte d'un ticket sur l'écran de validation (défilement depuis `?ticket=`). */
export function ticketCardId(ticketId: string): string {
  return `review-ticket-${ticketId}`
}
