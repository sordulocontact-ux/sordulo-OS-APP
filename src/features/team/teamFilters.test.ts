import { describe, expect, it } from 'vitest'
import { activeTeamFilterCount, filterMembers } from './teamFilters'

const base = { invited_at: null, user_id: 'u', removed_at: null }
const members = [
  { name: 'Maël Dupont', email: 'mael@sordulo.fr', role: 'admin' as const, ...base },
  { name: 'Sacha', email: 'sacha@sordulo.fr', role: 'membre' as const, ...base },
  { name: 'Lou', email: 'lou@x.fr', role: 'finance' as const, ...base, user_id: null, invited_at: '2026-11-01' },
  { name: 'Ancien', email: 'ancien@x.fr', role: 'membre' as const, ...base, removed_at: '2026-10-01' },
]
const none = { query: '', role: '' as const, status: '' as const }

describe('filterMembers', () => {
  it('masque les retirés par défaut', () => {
    expect(filterMembers(members, none).map((m) => m.name)).toEqual(['Maël Dupont', 'Sacha', 'Lou'])
  })
  it('filtre par statut', () => {
    expect(filterMembers(members, { ...none, status: 'removed' }).map((m) => m.name)).toEqual(['Ancien'])
    expect(filterMembers(members, { ...none, status: 'invited' }).map((m) => m.name)).toEqual(['Lou'])
    expect(filterMembers(members, { ...none, status: 'active' }).map((m) => m.name)).toEqual(['Maël Dupont', 'Sacha'])
  })
  it('filtre par rôle', () => {
    expect(filterMembers(members, { ...none, role: 'finance' }).map((m) => m.name)).toEqual(['Lou'])
  })
  it('cherche dans le nom et l\'email sans tenir compte des accents', () => {
    expect(filterMembers(members, { ...none, query: 'mael' }).map((m) => m.name)).toEqual(['Maël Dupont'])
    expect(filterMembers(members, { ...none, query: '@X.FR' }).map((m) => m.name)).toEqual(['Lou'])
  })
})

describe('activeTeamFilterCount', () => {
  it('compte rôle et statut', () => {
    expect(activeTeamFilterCount({ role: '', status: '' })).toBe(0)
    expect(activeTeamFilterCount({ role: 'admin', status: 'invited' })).toBe(2)
  })
})
