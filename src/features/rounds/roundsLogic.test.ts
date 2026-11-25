import { describe, expect, it } from 'vitest'
import { countFeedbackRounds, roundsAlert, roundsLabel, roundsState } from './roundsLogic'

describe('countFeedbackRounds', () => {
  const inputs = [
    { id: 'i1', quote_id: null },
    { id: 'i2', quote_id: null },
    { id: 'i3', quote_id: null },
    { id: 'q', quote_id: 'quote-1' },
  ]
  it('compte les entrées avec au moins un ticket validé ou fait', () => {
    const tickets = [
      { input_id: 'i1', status: 'validated' as const },
      { input_id: 'i1', status: 'done' as const },
      { input_id: 'i2', status: 'done' as const },
      { input_id: 'i3', status: 'proposed' as const },
    ]
    expect(countFeedbackRounds(inputs, tickets)).toBe(2)
  })
  it('ignore les tickets refusés, sans entrée, et les entrées issues d\'un devis', () => {
    const tickets = [
      { input_id: 'i1', status: 'rejected' as const },
      { input_id: null, status: 'validated' as const },
      { input_id: 'q', status: 'validated' as const },
    ]
    expect(countFeedbackRounds(inputs, tickets)).toBe(0)
  })
  it('zéro sans rien', () => expect(countFeedbackRounds([], [])).toBe(0))
})

describe('roundsState', () => {
  it('signale le dépassement', () => {
    const s = roundsState(3, 2)
    expect(s).toMatchObject({ extra: 1, exceeded: true, atLimit: false })
    expect(roundsLabel(s)).toBe('Retours : 3 sur 2 prévus')
    expect(roundsAlert(s)).toBe('1 round de retours au-delà du devis : à facturer ou à négocier.')
  })
  it('limite atteinte, pas dépassée', () => {
    const s = roundsState(2, 2)
    expect(s).toMatchObject({ extra: 0, exceeded: false, atLimit: true })
    expect(roundsAlert(s)).toBeNull()
  })
  it('singulier et zéro prévu', () => {
    expect(roundsLabel(roundsState(0, 1))).toBe('Retours : 0 sur 1 prévu')
    expect(roundsState(1, 0).exceeded).toBe(true)
    expect(roundsState(0, 0).atLimit).toBe(false)
  })
})
