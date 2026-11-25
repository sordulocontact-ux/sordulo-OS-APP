/**
 * Logique pure de l'état `review` (validation des tickets dans l'île) et des moments marqués : ce que montre la
 * carte, textes raccourcis, position « 2 sur 5 », gestes du clavier.
 */
import { LABELS } from '../../../shared/types'
import type { IslandMarkers, IslandReview, IslandReviewAction, IslandReviewTicket } from './types'

/** Description raccourcie de la carte : au plus 160 caractères (deux lignes de 12 px environ), puis « … ». */
export const REVIEW_DESCRIPTION_MAX = 160

/** Extrait de la réunion : au plus 140 caractères (deux lignes, entre guillemets). */
export const REVIEW_QUOTE_MAX = 140

/** Étoile brève après un repère ajouté (ms). */
export const MARK_FLASH_MS = 1200

/**
 * Texte sur une ligne (espaces et retours à la ligne fusionnés), coupé à `max` caractères sur une fin de mot si
 * possible, avec « … ». La CSS coupe aussi à deux lignes : ceci évite d'envoyer un long texte dans l'île.
 */
export function shortenText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  // La coupe tombe déjà sur une fin de mot : on la garde ; sinon, dernier espace s'il ne fait pas trop perdre.
  const space = flat[max - 1] === ' ' ? cut.length : cut.lastIndexOf(' ')
  const head = space >= max * 0.6 ? cut.slice(0, space) : cut
  return `${head.replace(/[\s,;:.!?]+$/, '')}…`
}

/** Ce que montre la carte : chargement, erreur sans ticket, tout traité, ou un ticket. */
export type ReviewView = 'loading' | 'error' | 'done' | 'ticket'

export function reviewView(review: IslandReview): ReviewView {
  if (review.tickets.length > 0) return 'ticket'
  if (review.loading) return 'loading'
  if (review.error) return 'error'
  return 'done'
}

/** Index affiché, ramené dans la liste (la liste peut raccourcir pendant un enregistrement). */
export function reviewIndex(review: IslandReview): number {
  if (review.tickets.length === 0) return 0
  return Math.min(Math.max(0, review.index), review.tickets.length - 1)
}

/** Ticket affiché ; null : aucun (chargement, tout traité). */
export function currentTicket(review: IslandReview): IslandReviewTicket | null {
  return review.tickets[reviewIndex(review)] ?? null
}

/** « 2 sur 5 ». */
export function reviewPosition(review: IslandReview): string {
  return `${reviewIndex(review) + 1} sur ${review.tickets.length}`
}

/** Libellé du type de ticket (« Bug », « Modification », « Nouvelle demande »). */
export function ticketTypeLabel(ticket: Pick<IslandReviewTicket, 'type'>): string {
  return LABELS.ticketType[ticket.type]
}

/** Annonce aria-live de l'état `review` : « Ticket 2 sur 5 : titre », chargement, tout traité. */
export function reviewLabel(review: IslandReview | null | undefined): string {
  if (!review) return 'Tickets à valider'
  const view = reviewView(review)
  if (view === 'loading') return 'Tickets à valider : chargement'
  if (view === 'error') return `Tickets à valider : ${review.error ?? 'erreur'}`
  if (view === 'done') return 'Tous les tickets sont traités'
  const ticket = currentTicket(review)
  const star = ticket?.fromMarker ? ', moment marqué' : ''
  return `Ticket ${reviewPosition(review)} : ${ticket?.title ?? ''}${star}`
}

/** Ce que fait une touche dans l'état `review`, ou null : la touche garde son effet normal. */
export function reviewKeyAction(
  key: string,
  review: IslandReview,
  /** Le focus est sur un bouton (autre que la carte elle-même) : Entrée appuie sur ce bouton. */
  onButton: boolean,
): IslandReviewAction | null {
  if (key === 'Escape') return { type: 'close' }
  if (review.busy) return null
  const hasTicket = currentTicket(review) !== null
  const index = reviewIndex(review)
  switch (key) {
    case 'ArrowLeft':
      return hasTicket && index > 0 ? { type: 'previous' } : null
    case 'ArrowRight':
      return hasTicket && index < review.tickets.length - 1 ? { type: 'next' } : null
    case 'Enter':
      return hasTicket && !onButton ? { type: 'validate' } : null
    case 'Backspace':
      return hasTicket ? { type: 'reject' } : null
    default:
      return null
  }
}

/** Nombre de repères pour un lecteur d'écran : « 1 moment marqué », « 3 moments marqués ». */
export function markersLabel(count: number): string {
  return `${count} ${count > 1 ? 'moments marqués' : 'moment marqué'}`
}

/** Fin de l'étoile brève du dernier repère (epoch ms) ; null : aucun repère. */
export function markFlashUntil(markers: IslandMarkers | null | undefined): number | null {
  return markers?.lastAddedAt == null ? null : markers.lastAddedAt + MARK_FLASH_MS
}
