import { describe, expect, it } from 'vitest'
import {
  buildGroups,
  containsPattern,
  escapeLike,
  filterActionsByRole,
  filterSourcesByRole,
  flattenGroups,
  highlightParts,
  matchRank,
  moveIndex,
  normalize,
  orIlike,
  rankResults,
} from './searchLogic'
import type { QuickAction, SearchResult } from './types'

const r = (id: string, title: string, subtitle?: string): SearchResult => ({ id, title, subtitle, to: `/${id}` })

describe('normalize', () => {
  it('retire accents, casse et espaces', () => {
    expect(normalize('  Ibé Électro ')).toBe('ibe electro')
  })
})

describe('filterSourcesByRole', () => {
  const sources = [
    { id: 'a', roles: ['admin', 'finance'] as const, order: 20 },
    { id: 'b', roles: ['admin'] as const, order: 10 },
    { id: 'c', roles: ['admin', 'membre'] as const },
    { id: 'd', roles: ['admin', 'membre'] as const },
  ]
  it('filtre par rôle et trie par ordre puis enregistrement', () => {
    expect(filterSourcesByRole(sources, 'admin').map((s) => s.id)).toEqual(['b', 'a', 'c', 'd'])
    expect(filterSourcesByRole(sources, 'finance').map((s) => s.id)).toEqual(['a'])
    expect(filterSourcesByRole(sources, 'prospection')).toEqual([])
  })
  it('sans rôle, rien', () => {
    expect(filterSourcesByRole(sources, null)).toEqual([])
  })
})

describe('filterActionsByRole', () => {
  const actions: QuickAction[] = [
    { id: 'x', title: 'X', to: '/x', roles: ['admin'] },
    { id: 'y', title: 'Y', to: '/y', roles: ['admin', 'membre'] },
  ]
  it('garde les actions du rôle', () => {
    expect(filterActionsByRole(actions, 'membre').map((a) => a.id)).toEqual(['y'])
    expect(filterActionsByRole(actions, null)).toEqual([])
  })
})

describe('motifs ilike', () => {
  it('échappe % _ et \\', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b')
  })
  it('construit un motif « contient »', () => {
    expect(containsPattern(' dup*ont ')).toBe('%dup ont%')
  })
  it('met les motifs entre guillemets pour .or()', () => {
    expect(orIlike(['name', 'website'], 'a,b)')).toBe('name.ilike."%a,b)%",website.ilike."%a,b)%"')
    expect(orIlike(['name'], 'x"y')).toBe('name.ilike."%x\\"y%"')
  })
})

describe('matchRank / rankResults', () => {
  it('classe exact, préfixe, mot, contient', () => {
    expect(matchRank('Acme', 'acme')).toBe(0)
    expect(matchRank('Acme Corp', 'ac')).toBe(1)
    expect(matchRank('Super Acme', 'ac')).toBe(2)
    expect(matchRank('Macme', 'ac')).toBe(3)
    expect(matchRank('Zed', 'ac')).toBe(4)
  })
  it('trie par pertinence, stable, limité', () => {
    const items = [r('1', 'Macme'), r('2', 'Acme Corp'), r('3', 'Acme'), r('4', 'Autre', 'chez acme')]
    expect(rankResults(items, 'acme').map((i) => i.id)).toEqual(['3', '2', '4', '1'])
    expect(rankResults(items, 'acme', 2)).toHaveLength(2)
  })
})

describe('groupes', () => {
  it('écarte les groupes vides et aplatit dans l’ordre', () => {
    const groups = buildGroups([
      { source: { id: 'a', label: 'A' }, items: [r('1', 'un'), r('2', 'deux')] },
      { source: { id: 'b', label: 'B' }, items: [] },
      { source: { id: 'c', label: 'C' }, items: [r('3', 'trois')] },
    ])
    expect(groups.map((g) => g.id)).toEqual(['a', 'c'])
    expect(flattenGroups(groups).map((i) => i.id)).toEqual(['1', '2', '3'])
  })
})

describe('moveIndex', () => {
  it('boucle dans les deux sens', () => {
    expect(moveIndex(2, 1, 3)).toBe(0)
    expect(moveIndex(0, -1, 3)).toBe(2)
    expect(moveIndex(-1, 1, 3)).toBe(0)
    expect(moveIndex(-1, -1, 3)).toBe(2)
    expect(moveIndex(0, 1, 0)).toBe(-1)
  })
})

describe('highlightParts', () => {
  it('surligne sans tenir compte des accents ni de la casse', () => {
    expect(highlightParts('Café Électro', 'elec')).toEqual([
      { text: 'Café ', match: false },
      { text: 'Élec', match: true },
      { text: 'tro', match: false },
    ])
  })
  it('renvoie le texte tel quel sans correspondance ou sans requête', () => {
    expect(highlightParts('Acme', 'zzz')).toEqual([{ text: 'Acme', match: false }])
    expect(highlightParts('Acme', '  ')).toEqual([{ text: 'Acme', match: false }])
  })
  it('gère la correspondance au début et à la fin', () => {
    expect(highlightParts('Acme', 'ac')).toEqual([
      { text: 'Ac', match: true },
      { text: 'me', match: false },
    ])
    expect(highlightParts('Acme', 'me')).toEqual([
      { text: 'Ac', match: false },
      { text: 'me', match: true },
    ])
  })
})
