import { describe, expect, it } from 'vitest'
import { findQuoteUtterance } from './quote'

const transcript = {
  utterances: [
    { speaker: 0, start: 5, end: 9, text: 'Bonjour, on commence.' },
    { speaker: 1, start: 75, end: 82, text: "Le bouton « Payer » n'est pas assez visible, il faudrait le mettre en vert." },
  ],
}

describe('findQuoteUtterance', () => {
  it('finds a quote despite accents and punctuation', () => {
    expect(findQuoteUtterance(transcript, 'le bouton Payer n est pas assez visible')?.start).toBe(75)
    expect(findQuoteUtterance(transcript, "IL FAUDRAIT LE METTRE EN VERT")?.speaker).toBe(1)
  })
  it('returns null when not found or empty', () => {
    expect(findQuoteUtterance(transcript, 'le logo est trop petit')).toBeNull()
    expect(findQuoteUtterance(transcript, '')).toBeNull()
    expect(findQuoteUtterance(null, 'x')).toBeNull()
  })
})
