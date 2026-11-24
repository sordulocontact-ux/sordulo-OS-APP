import { describe, expect, it } from 'vitest'
import { CONNECTORS, connectorInitials, filterConnectors } from './catalog'

describe('catalogue des connecteurs', () => {
  it('a des ids uniques, sans service interne de l’app ni connecteur figé « connecté »', () => {
    expect(new Set(CONNECTORS.map((c) => c.id)).size).toBe(CONNECTORS.length)
    const ids = CONNECTORS.map((c) => c.id)
    expect(ids).not.toContain('deepgram')
    expect(ids).not.toContain('mistral')
    for (const c of CONNECTORS) expect(['live', 'soon']).toContain(c.status)
  })

  it('a un connecteur Spotify à état vivant', () => {
    expect(CONNECTORS.find((c) => c.id === 'spotify')?.status).toBe('live')
  })

  it('a un connecteur Claude à état vivant (relais Claude Code), en IA', () => {
    const claude = CONNECTORS.find((c) => c.id === 'claude')
    expect(claude?.status).toBe('live')
    expect(claude?.category).toBe('IA')
  })

  it('a un connecteur Supabase « bientôt »', () => {
    expect(CONNECTORS.find((c) => c.id === 'supabase')?.status).toBe('soon')
  })

  it('a un connecteur Vercel à état vivant, en Infrastructure', () => {
    const vercel = CONNECTORS.find((c) => c.id === 'vercel')
    expect(vercel?.status).toBe('live')
    expect(vercel?.category).toBe('Infrastructure')
    expect(filterConnectors(CONNECTORS, '', true, new Set(['vercel'])).map((c) => c.id)).toContain('vercel')
    expect(filterConnectors(CONNECTORS, '', true).map((c) => c.id)).not.toContain('vercel')
  })

  it('filtre par onglet, sans tenir compte des accents ni de la casse', () => {
    expect(filterConnectors(CONNECTORS, '', true)).toEqual([])
    expect(filterConnectors(CONNECTORS, '', true, new Set(['spotify', 'claude'])).map((c) => c.id)).toEqual(['claude', 'spotify'])
    expect(filterConnectors(CONNECTORS, 'musique', false).map((c) => c.id)).toEqual(['spotify'])
    expect(filterConnectors(CONNECTORS, 'COMPTABILITE', false).map((c) => c.id)).toEqual(['qonto', 'pennylane'])
    expect(filterConnectors(CONNECTORS, 'zzz', false)).toEqual([])
  })

  it('calcule les initiales du logo', () => {
    expect(connectorInitials('Gmail')).toBe('GM')
    expect(connectorInitials('Google Meet / Zoom')).toBe('GM')
  })
})
