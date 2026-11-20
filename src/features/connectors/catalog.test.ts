import { describe, expect, it } from 'vitest'
import { CONNECTORS, connectorInitials, filterConnectors } from './catalog'

describe('catalogue des connecteurs', () => {
  it('a des ids uniques et une phrase d’état pour chaque connecteur connecté', () => {
    expect(new Set(CONNECTORS.map((c) => c.id)).size).toBe(CONNECTORS.length)
    for (const c of CONNECTORS.filter((x) => x.status === 'connected')) expect(c.state).toBeTruthy()
  })

  it('filtre par onglet, sans tenir compte des accents ni de la casse', () => {
    expect(filterConnectors(CONNECTORS, '', true).map((c) => c.id)).toEqual(['claude', 'deepgram', 'mistral', 'supabase'])
    expect(filterConnectors(CONNECTORS, 'COMPTABILITE', false).map((c) => c.id)).toEqual(['qonto', 'pennylane'])
    expect(filterConnectors(CONNECTORS, 'zzz', false)).toEqual([])
  })

  it('calcule les initiales du logo', () => {
    expect(connectorInitials('Gmail')).toBe('GM')
    expect(connectorInitials('Google Meet / Zoom')).toBe('GM')
  })
})
