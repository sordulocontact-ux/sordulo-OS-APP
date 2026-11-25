import { describe, expect, it } from 'vitest'
import { findQuoteUtterance, normalizeText } from './quote.js'

const transcript = {
  utterances: [
    { speaker: 0, start: 5, end: 9, text: 'Bonjour, on commence.' },
    { speaker: 1, start: 75, end: 82, text: "Le bouton « Payer » n'est pas assez visible, il faudrait le mettre en vert." },
    { speaker: 1, start: 83, end: 88, text: 'Et sur mobile la page de connexion met longtemps à charger.' },
  ],
}

describe('normalizeText', () => {
  it('retire accents, ponctuation et majuscules', () => {
    expect(normalizeText("  L'Été, déjà !  ")).toBe('l ete deja')
  })
})

describe('findQuoteUtterance', () => {
  it('trouve une citation malgré les accents et la ponctuation', () => {
    expect(findQuoteUtterance(transcript, 'le bouton Payer n est pas assez visible')?.start).toBe(75)
  })

  it('citation sur deux interventions : celle qui la commence', () => {
    const quote = "il faudrait le mettre en vert. Et sur mobile la page de connexion met longtemps à charger."
    expect(findQuoteUtterance(transcript, quote)?.start).toBe(83)
    const startsFirst = "Le bouton « Payer » n'est pas assez visible, il faudrait le mettre en vert. Et sur mobile"
    expect(findQuoteUtterance(transcript, startsFirst)?.start).toBe(75)
  })

  it('reconnaît le début d’une citation légèrement reformulée à la fin', () => {
    expect(findQuoteUtterance(transcript, 'Et sur mobile la page de connexion met beaucoup trop de temps')?.start).toBe(83)
  })

  it('null si introuvable ou vide', () => {
    expect(findQuoteUtterance(transcript, 'le logo est trop petit')).toBeNull()
    expect(findQuoteUtterance(transcript, '   ')).toBeNull()
    expect(findQuoteUtterance(undefined, 'x')).toBeNull()
  })
})
