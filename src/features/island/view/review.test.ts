import { describe, expect, it } from 'vitest'
import {
  MARK_FLASH_MS,
  currentTicket,
  markFlashUntil,
  markersLabel,
  reviewIndex,
  reviewKeyAction,
  reviewPosition,
  reviewView,
  shortenText,
  ticketTypeLabel,
} from './review'
import type { IslandReview, IslandReviewTicket } from './types'

const ticket = (n: number, over: Partial<IslandReviewTicket> = {}): IslandReviewTicket => ({
  id: `t${n}`,
  type: 'modification',
  title: `Ticket ${n}`,
  description: 'Description',
  quote: null,
  assignee: null,
  fromMarker: false,
  ...over,
})

const review = (over: Partial<IslandReview> = {}): IslandReview => ({
  inputTitle: 'Call Ibé',
  projectName: 'App Ibé',
  tickets: [ticket(1), ticket(2), ticket(3)],
  index: 0,
  loading: false,
  busy: false,
  error: null,
  undo: null,
  ...over,
})

describe('shortenText', () => {
  it('garde un texte court tel quel, sur une ligne', () => {
    expect(shortenText('  Le bouton\n\n est  trop petit ', 160)).toBe('Le bouton est trop petit')
  })

  it('coupe sur une fin de mot, sans ponctuation pendante, avec « … »', () => {
    const text = 'Le bouton de validation est trop petit, sur mobile surtout, et il faut le rendre plus visible'
    const short = shortenText(text, 40)
    expect(short.length).toBeLessThanOrEqual(40)
    expect(short).toBe('Le bouton de validation est trop petit…')
  })

  it('coupe au milieu d’un très long mot plutôt que de presque tout perdre', () => {
    const short = shortenText(`${'a'.repeat(10)} ${'b'.repeat(60)}`, 40)
    expect(short).toHaveLength(40)
    expect(short.endsWith('…')).toBe(true)
  })
})

describe('reviewView', () => {
  it('distingue ticket, chargement, erreur et tout traité', () => {
    expect(reviewView(review())).toBe('ticket')
    expect(reviewView(review({ tickets: [], loading: true }))).toBe('loading')
    expect(reviewView(review({ tickets: [], error: 'Tu n’as plus accès à cette entrée' }))).toBe('error')
    expect(reviewView(review({ tickets: [], loading: true, error: 'x' }))).toBe('loading')
    expect(reviewView(review({ tickets: [] }))).toBe('done')
    // Une erreur d'enregistrement avec des tickets restants : le ticket reste affiché (bandeau d'erreur).
    expect(reviewView(review({ error: 'Pas de réseau' }))).toBe('ticket')
  })
})

describe('position', () => {
  it('donne « 2 sur 5 » et ramène l’index dans la liste quand elle raccourcit', () => {
    expect(reviewPosition(review({ index: 1 }))).toBe('2 sur 3')
    expect(reviewIndex(review({ index: 7 }))).toBe(2)
    expect(currentTicket(review({ index: 7 }))?.id).toBe('t3')
    expect(reviewIndex(review({ index: -1 }))).toBe(0)
    expect(currentTicket(review({ tickets: [] }))).toBeNull()
  })

  it('nomme le type en français', () => {
    expect(ticketTypeLabel({ type: 'bug' })).toBe('Bug')
    expect(ticketTypeLabel({ type: 'new_request' })).toBe('Nouvelle demande')
  })
})

describe('reviewKeyAction', () => {
  it('flèches : précédent et suivant, sans dépasser les bouts', () => {
    expect(reviewKeyAction('ArrowRight', review(), false)).toEqual({ type: 'next' })
    expect(reviewKeyAction('ArrowLeft', review(), false)).toBeNull()
    expect(reviewKeyAction('ArrowLeft', review({ index: 2 }), false)).toEqual({ type: 'previous' })
    expect(reviewKeyAction('ArrowRight', review({ index: 2 }), false)).toBeNull()
  })

  it('Entrée valide, sauf sur un bouton (le bouton répond lui-même) ; Retour arrière refuse', () => {
    expect(reviewKeyAction('Enter', review(), false)).toEqual({ type: 'validate' })
    expect(reviewKeyAction('Enter', review(), true)).toBeNull()
    expect(reviewKeyAction('Backspace', review(), true)).toEqual({ type: 'reject' })
  })

  it('Échap ferme toujours ; occupé ou sans ticket, le reste ne fait rien', () => {
    expect(reviewKeyAction('Escape', review({ busy: true }), true)).toEqual({ type: 'close' })
    expect(reviewKeyAction('Enter', review({ busy: true }), false)).toBeNull()
    expect(reviewKeyAction('Backspace', review({ tickets: [] }), false)).toBeNull()
    expect(reviewKeyAction('Enter', review({ tickets: [] }), false)).toBeNull()
    expect(reviewKeyAction('a', review(), false)).toBeNull()
  })
})

describe('moments marqués', () => {
  it('accorde le nombre de repères', () => {
    expect(markersLabel(1)).toBe('1 moment marqué')
    expect(markersLabel(3)).toBe('3 moments marqués')
  })

  it('fait durer l’éclat MARK_FLASH_MS après le dernier repère', () => {
    expect(markFlashUntil(null)).toBeNull()
    expect(markFlashUntil({ count: 0, lastAddedAt: null, undoUntil: null })).toBeNull()
    expect(markFlashUntil({ count: 2, lastAddedAt: 1000, undoUntil: 6000 })).toBe(1000 + MARK_FLASH_MS)
  })
})
