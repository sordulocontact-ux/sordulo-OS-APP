import { describe, expect, it } from 'vitest'
import type { ProjectWithClient } from './types'
import { diffMembers, filterProjects, formatDay, NO_CLIENT, parseStatusParam, validateDates } from './projectLogic'

function p(over: Partial<ProjectWithClient>): ProjectWithClient {
  return {
    id: 'p', organization_id: 'o', client_id: null, name: 'Projet', status: 'in_progress', start_date: null,
    due_date: null, tone_of_voice: null, created_at: '', updated_at: '', client: null, ...over,
  }
}
const client = { id: 'c1', name: 'Ibé' } as ProjectWithClient['client']
const list = [
  p({ id: '1', name: 'App Ibé', client_id: 'c1', client }),
  p({ id: '2', name: 'Vieux site', status: 'archived' }),
  p({ id: '3', name: 'Devis', status: 'quote_sent' }),
]
const f = { query: '', status: '' as const, client: '' }

describe('filterProjects', () => {
  it('masque les archivés par défaut', () => {
    expect(filterProjects(list, f).map((x) => x.id)).toEqual(['1', '3'])
  })
  it('montre les archivés ou un statut précis', () => {
    expect(filterProjects(list, { ...f, status: 'archived' }).map((x) => x.id)).toEqual(['2'])
    expect(filterProjects(list, { ...f, status: 'quote_sent' }).map((x) => x.id)).toEqual(['3'])
  })
  it('filtre par client et sans client', () => {
    expect(filterProjects(list, { ...f, client: 'c1' }).map((x) => x.id)).toEqual(['1'])
    expect(filterProjects(list, { ...f, client: NO_CLIENT }).map((x) => x.id)).toEqual(['3'])
  })
  it('cherche dans le nom du projet et du client', () => {
    expect(filterProjects(list, { ...f, query: 'ibé' }).map((x) => x.id)).toEqual(['1'])
  })
})

describe('parseStatusParam', () => {
  it('ignore les valeurs inconnues', () => {
    expect(parseStatusParam('paid')).toBe('paid')
    expect(parseStatusParam('zzz')).toBe('')
    expect(parseStatusParam(null)).toBe('')
  })
})

describe('validateDates', () => {
  it('refuse une échéance avant le début', () => {
    expect(validateDates('2026-12-10', '2026-12-01')).not.toBeNull()
    expect(validateDates('2026-12-10', '2026-12-10')).toBeNull()
    expect(validateDates('', '2026-12-01')).toBeNull()
  })
})

describe('diffMembers', () => {
  it('sépare ajoutés et retirés', () => {
    expect(diffMembers(['a', 'b'], ['b', 'c'])).toEqual({ toAdd: ['c'], toRemove: ['a'] })
  })
})

describe('formatDay', () => {
  it('formate en français sans décalage', () => {
    expect(formatDay('2026-12-01')).toBe('1 décembre 2026')
    expect(formatDay(null)).toBeNull()
  })
})
