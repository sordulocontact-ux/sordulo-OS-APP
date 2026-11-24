import { describe, expect, it } from 'vitest'
import { CONNECTORS, connectorInitials, filterConnectors } from './catalog'

describe('catalogue des connecteurs', () => {
  it('a des ids uniques et une phrase d’état pour chaque connecteur connecté', () => {
    expect(new Set(CONNECTORS.map((c) => c.id)).size).toBe(CONNECTORS.length)
    for (const c of CONNECTORS.filter((x) => x.status === 'connected')) expect(c.state).toBeTruthy()
  })

  it('a un connecteur Spotify à état vivant, sans phrase d’état statique', () => {
    const spotify = CONNECTORS.find((c) => c.id === 'spotify')
    expect(spotify?.status).toBe('live')
    expect(spotify?.state).toBeUndefined()
  })

  it('a un connecteur Vercel à état vivant, en Infrastructure', () => {
    const vercel = CONNECTORS.find((c) => c.id === 'vercel')
    expect(vercel?.status).toBe('live')
    expect(vercel?.category).toBe('Infrastructure')
    expect(filterConnectors(CONNECTORS, '', true, new Set(['vercel'])).map((c) => c.id)).toContain('vercel')
    expect(filterConnectors(CONNECTORS, '', true).map((c) => c.id)).not.toContain('vercel')
  })

  it('filtre par onglet, sans tenir compte des accents ni de la casse', () => {
    expect(filterConnectors(CONNECTORS, '', true).map((c) => c.id)).toEqual(['claude', 'deepgram', 'mistral', 'supabase'])
    expect(filterConnectors(CONNECTORS, '', true, new Set(['spotify'])).map((c) => c.id)).toEqual([
      'claude',
      'deepgram',
      'mistral',
      'supabase',
      'spotify',
    ])
    expect(filterConnectors(CONNECTORS, 'musique', false).map((c) => c.id)).toEqual(['spotify'])
    expect(filterConnectors(CONNECTORS, 'COMPTABILITE', false).map((c) => c.id)).toEqual(['qonto', 'pennylane'])
    expect(filterConnectors(CONNECTORS, 'zzz', false)).toEqual([])
  })

  it('calcule les initiales du logo', () => {
    expect(connectorInitials('Gmail')).toBe('GM')
    expect(connectorInitials('Google Meet / Zoom')).toBe('GM')
  })
})
