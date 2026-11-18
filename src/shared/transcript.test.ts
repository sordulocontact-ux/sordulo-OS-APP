import { describe, expect, it } from 'vitest'
import { formatTimestamp, formatTranscriptForPrompt, speakerLabel } from './transcript.js'

describe('speakerLabel', () => {
  it('utilise le nom donné', () => {
    expect(speakerLabel(0, { '0': 'Maël' })).toBe('Maël')
  })
  it('sinon « Voix N » avec N = index + 1', () => {
    expect(speakerLabel(0, {})).toBe('Voix 1')
    expect(speakerLabel(2, { '0': 'Maël' })).toBe('Voix 3')
    expect(speakerLabel(1, null)).toBe('Voix 2')
  })
  it('ignore un nom vide', () => {
    expect(speakerLabel(1, { '1': '   ' })).toBe('Voix 2')
  })
})

describe('formatTimestamp', () => {
  it('formate en m:ss', () => {
    expect(formatTimestamp(0)).toBe('0:00')
    expect(formatTimestamp(5.9)).toBe('0:05')
    expect(formatTimestamp(75)).toBe('1:15')
    expect(formatTimestamp(3599)).toBe('59:59')
  })
  it('formate en h:mm:ss au-delà d’une heure', () => {
    expect(formatTimestamp(3600)).toBe('1:00:00')
    expect(formatTimestamp(3725)).toBe('1:02:05')
  })
  it('ramène les valeurs invalides à 0', () => {
    expect(formatTimestamp(-3)).toBe('0:00')
    expect(formatTimestamp(Number.NaN)).toBe('0:00')
  })
})

describe('formatTranscriptForPrompt', () => {
  it('écrit une ligne par intervention', () => {
    const text = formatTranscriptForPrompt(
      {
        utterances: [
          { speaker: 0, start: 1.2, end: 4, text: ' Bonjour à tous. ' },
          { speaker: 1, start: 65, end: 70, text: 'Le bouton est trop petit.' },
          { speaker: 1, start: 71, end: 72, text: '   ' },
        ],
      },
      { '0': 'Maël' },
    )
    expect(text).toBe('[0:01] Maël : Bonjour à tous.\n[1:05] Voix 2 : Le bouton est trop petit.')
  })
})
