import { describe, expect, it } from 'vitest'
import { formatTimestamp, formatTranscriptForPrompt, isNearMarker, MARKER_WINDOW_SECS, speakerLabel } from './transcript.js'

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

describe('isNearMarker', () => {
  it('fenêtre de 30 s de chaque côté du repère', () => {
    expect(MARKER_WINDOW_SECS).toBe(30)
    expect(isNearMarker(100, 105, [100])).toBe(true)
    expect(isNearMarker(125, 140, [100])).toBe(true) // commence dans la fenêtre
    expect(isNearMarker(60, 70, [100])).toBe(true) // finit pile au bord (70 = 100 - 30)
    expect(isNearMarker(130, 135, [100])).toBe(true) // commence pile au bord
    expect(isNearMarker(131, 140, [100])).toBe(false)
    expect(isNearMarker(50, 69.9, [100])).toBe(false)
  })

  it('une longue intervention qui englobe la fenêtre compte', () => {
    expect(isNearMarker(0, 300, [150])).toBe(true)
  })

  it('n’importe quel repère suffit', () => {
    expect(isNearMarker(500, 510, [10, 520])).toBe(true)
    expect(isNearMarker(200, 210, [10, 520])).toBe(false)
  })

  it('sans repère, ou valeurs invalides : faux', () => {
    expect(isNearMarker(0, 10, [])).toBe(false)
    expect(isNearMarker(0, 10, null)).toBe(false)
    expect(isNearMarker(0, 10, undefined)).toBe(false)
    expect(isNearMarker(Number.NaN, 10, [5])).toBe(false)
    expect(isNearMarker(0, 10, [Number.NaN])).toBe(false)
  })

  it('intervalle à l’envers ou fin invalide : seulement le début', () => {
    expect(isNearMarker(100, 10, [100])).toBe(true)
    expect(isNearMarker(100, 10, [50])).toBe(false)
    expect(isNearMarker(100, Number.NaN, [120])).toBe(true)
  })
})

describe('formatTranscriptForPrompt : moments marqués', () => {
  const utterances = [
    { speaker: 0, start: 0, end: 5, text: 'Bonjour à tous.' },
    { speaker: 1, start: 100, end: 110, text: 'Le bouton est trop petit.' },
    { speaker: 0, start: 112, end: 115, text: 'Noté.' },
    { speaker: 1, start: 116, end: 117, text: '  ' },
    { speaker: 1, start: 200, end: 205, text: 'Et le logo est flou.' },
    { speaker: 0, start: 300, end: 302, text: 'Au revoir.' },
  ]

  it('entoure les lignes proches d’un repère, consécutives dans un seul bloc', () => {
    const text = formatTranscriptForPrompt({ utterances }, { '0': 'Maël' }, [105, 290])
    expect(text).toBe(
      [
        '[0:00] Maël : Bonjour à tous.',
        '<moment_marque>',
        '[1:40] Voix 2 : Le bouton est trop petit.',
        '[1:52] Maël : Noté.',
        '</moment_marque>',
        '[3:20] Voix 2 : Et le logo est flou.',
        '<moment_marque>',
        '[5:00] Maël : Au revoir.',
        '</moment_marque>',
      ].join('\n'),
    )
  })

  it('sans repère : texte identique à avant', () => {
    const plain = formatTranscriptForPrompt({ utterances }, null)
    expect(formatTranscriptForPrompt({ utterances }, null, [])).toBe(plain)
    expect(plain).not.toContain('moment_marque')
  })
})
