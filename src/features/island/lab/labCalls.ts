/**
 * Labo : données et simulation des états ajoutés par le ticket « appels dans l'île » (validation des tickets,
 * moments marqués, raison de la présélection d'après l'agenda). Pur : le LabRuntime garde l'état et l'affiche.
 */
import type { IslandMarkers, IslandReview, IslandReviewAction, IslandReviewTicket } from '../view/types'

/** Durée pendant laquelle « Annuler » retire le dernier repère (comme la source d'appel). */
export const LAB_MARKER_UNDO_MS = 5000

export const LAB_CALL_REASON = "D'après l'agenda : Point hebdo Ibé"

export const LAB_REVIEW_TICKETS: readonly IslandReviewTicket[] = [
  {
    id: 'lab-t1',
    type: 'modification',
    title: 'Agrandir le bouton « Réserver » sur mobile',
    description:
      "Sur l'écran d'accueil de l'app, le bouton principal est trop petit sur les petits téléphones : la cliente rate souvent la cible et ouvre le menu à la place. Le passer en pleine largeur sous la photo.",
    quote: 'Le bouton pour réserver, on le rate tout le temps sur mon téléphone, il faudrait qu’il soit plus gros.',
    assignee: { name: 'Sacha', initials: 'SA' },
    fromMarker: true,
  },
  {
    id: 'lab-t2',
    type: 'bug',
    title: 'La date de rendez-vous s’affiche en anglais',
    description: 'Dans la confirmation, le mois apparaît en anglais (« March ») alors que l’app est en français.',
    quote: 'Et là c’est écrit March, ce n’est pas normal.',
    assignee: { name: 'Maël', initials: 'MA' },
    fromMarker: false,
  },
  {
    id: 'lab-t3',
    type: 'new_request',
    title: 'Ajouter un rappel la veille du rendez-vous',
    description: 'Notification la veille à 18 h avec l’heure et l’adresse du rendez-vous, désactivable dans les réglages.',
    quote: null,
    assignee: null,
    fromMarker: false,
  },
]

export type LabReviewVariant = 'tickets' | 'loading' | 'done' | 'error' | 'busy'

/** État `review` d'exemple. */
export function labReview(variant: LabReviewVariant): IslandReview {
  const base: IslandReview = {
    inputTitle: 'Point hebdo Ibé',
    projectName: 'App Ibé',
    tickets: LAB_REVIEW_TICKETS,
    index: 0,
    loading: false,
    busy: false,
    error: null,
    undo: null,
  }
  switch (variant) {
    case 'tickets':
      return base
    case 'loading':
      return { ...base, tickets: [], loading: true }
    case 'done':
      return { ...base, tickets: [] }
    case 'error':
      return { ...base, tickets: [], error: "Impossible de lire les tickets de l'entrée." }
    case 'busy':
      return { ...base, busy: true, error: "L'enregistrement a échoué : réessaie." }
  }
}

/** Effet d'un geste : nouvel état, ou null pour fermer l'état `review`. */
export function reduceLabReview(review: IslandReview, action: IslandReviewAction): IslandReview | null {
  const count = review.tickets.length
  const current = review.tickets[review.index]
  const without = (id: string) => review.tickets.filter((t) => t.id !== id)
  const clampIndex = (tickets: readonly IslandReviewTicket[]) => Math.min(review.index, Math.max(0, tickets.length - 1))
  switch (action.type) {
    case 'previous':
      return { ...review, index: Math.max(0, review.index - 1) }
    case 'next':
      return { ...review, index: Math.min(Math.max(0, count - 1), review.index + 1) }
    case 'validate': {
      if (!current) return review
      const tickets = without(current.id)
      return { ...review, tickets, index: clampIndex(tickets), undo: null, error: null }
    }
    case 'reject': {
      if (!current) return review
      const tickets = without(current.id)
      return { ...review, tickets, index: clampIndex(tickets), undo: { ticketTitle: current.title }, error: null }
    }
    case 'validateAll':
      return { ...review, tickets: [], index: 0, undo: null }
    case 'undo':
      return { ...review, tickets: LAB_REVIEW_TICKETS.slice(0, count + 1), undo: null }
    case 'openInApp':
    case 'close':
      return null
  }
}

/** Repère posé à `now`. */
export function labMarkerAdded(markers: IslandMarkers | null, now: number): IslandMarkers {
  return { count: (markers?.count ?? 0) + 1, lastAddedAt: now, undoUntil: now + LAB_MARKER_UNDO_MS }
}

/** « Annuler » : le dernier repère est retiré. */
export function labMarkerRemoved(markers: IslandMarkers | null): IslandMarkers {
  return { count: Math.max(0, (markers?.count ?? 0) - 1), lastAddedAt: markers?.lastAddedAt ?? null, undoUntil: null }
}
