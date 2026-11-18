import { describe, expect, it } from 'vitest'
import { firstProcessingStatus, isProcessingInProgress, STALE_PROCESSING_MS } from './process.js'

describe('isProcessingInProgress', () => {
  const now = Date.parse('2026-11-18T18:00:00Z')
  it('bloque un traitement récent', () => {
    const updated_at = new Date(now - 60_000).toISOString()
    expect(isProcessingInProgress({ status: 'analyzing', updated_at }, now)).toBe(true)
    expect(isProcessingInProgress({ status: 'transcribing', updated_at }, now)).toBe(true)
  })
  it('laisse relancer un traitement bloqué depuis plus de 5 min, ou terminé', () => {
    const old = new Date(now - STALE_PROCESSING_MS - 1).toISOString()
    expect(isProcessingInProgress({ status: 'analyzing', updated_at: old }, now)).toBe(false)
    const recent = new Date(now - 1000).toISOString()
    expect(isProcessingInProgress({ status: 'error', updated_at: recent }, now)).toBe(false)
    expect(isProcessingInProgress({ status: 'ready', updated_at: recent }, now)).toBe(false)
  })
})

describe('firstProcessingStatus', () => {
  it('transcrit une réunion sans transcription, analyse sinon', () => {
    expect(firstProcessingStatus({ kind: 'meeting', transcript: null })).toBe('transcribing')
    expect(
      firstProcessingStatus({
        kind: 'meeting',
        transcript: { provider: 'x', language: 'fr', duration_seconds: 1, utterances: [{ speaker: 0, start: 0, end: 1, text: 'a' }] },
      }),
    ).toBe('analyzing')
    expect(firstProcessingStatus({ kind: 'written', transcript: null })).toBe('analyzing')
  })
})
