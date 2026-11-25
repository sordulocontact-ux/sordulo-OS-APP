import { describe, expect, it } from 'vitest'
import type { ProjectWithClient } from './types'
import {
  daysUntil, diffMembers, filterProjects, formatDay, NO_CLIENT, overdueHint, parseRounds, parseStatusParam, projectStats, relativeDue, validateDates, validateRounds,
} from './projectLogic'

function p(over: Partial<ProjectWithClient>): ProjectWithClient {
  return {
    id: 'p', organization_id: 'o', client_id: null, name: 'Projet', status: 'in_progress', start_date: null,
    due_date: null, tone_of_voice: null, ai_instructions: null, feedback_rounds_included: 2, showcase: 'unknown', case_study: null,
    portal_token: null, created_at: '', updated_at: '', client: null, ...over,
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

describe('daysUntil', () => {
  const now = new Date(2026, 10, 20, 23, 30)
  it('compte en jours calendaires locaux', () => {
    expect(daysUntil('2026-11-20', now)).toBe(0)
    expect(daysUntil('2026-11-21', now)).toBe(1)
    expect(daysUntil('2026-11-17', now)).toBe(-3)
    expect(daysUntil('2026-12-20', now)).toBe(30)
  })
  it('traverse le changement d\'heure sans décalage', () => {
    expect(daysUntil('2027-03-29', new Date(2027, 2, 27, 12))).toBe(2)
  })
  it('renvoie null sans date valide', () => {
    expect(daysUntil(null, now)).toBeNull()
    expect(daysUntil('n/a', now)).toBeNull()
  })
})

describe('relativeDue', () => {
  const now = new Date(2026, 10, 20, 9)
  const due = (due_date: string | null, status: ProjectWithClient['status'] = 'in_progress') => relativeDue({ due_date, status }, now)
  it('formule les échéances à venir', () => {
    expect(due('2026-11-20')).toEqual({ text: "aujourd'hui", overdue: false })
    expect(due('2026-11-21')).toEqual({ text: 'demain', overdue: false })
    expect(due('2026-12-02')).toEqual({ text: 'dans 12 jours', overdue: false })
  })
  it('signale le retard', () => {
    expect(due('2026-11-17')).toEqual({ text: 'en retard de 3 jours', overdue: true })
    expect(due('2026-11-19')).toEqual({ text: 'en retard de 1 jour', overdue: true })
  })
  it('ignore les projets terminés ou sans échéance', () => {
    expect(due('2026-11-01', 'delivered')).toBeNull()
    expect(due('2026-11-01', 'paid')).toBeNull()
    expect(due('2026-11-01', 'archived')).toBeNull()
    expect(due(null)).toBeNull()
  })
})

describe('projectStats', () => {
  const now = new Date(2026, 10, 20)
  it('compte par statut et les retards des projets en cours', () => {
    const stats = projectStats(
      [
        { status: 'in_progress', due_date: '2026-11-01' },
        { status: 'in_progress', due_date: '2026-11-20' },
        { status: 'in_progress', due_date: null },
        { status: 'quote_sent', due_date: '2026-01-01' },
        { status: 'delivered', due_date: null },
        { status: 'paid', due_date: null },
        { status: 'paid', due_date: null },
        { status: 'archived', due_date: null },
      ],
      now,
    )
    expect(stats).toEqual({ inProgress: 3, overdue: 1, quoteSent: 1, delivered: 1, paid: 2 })
  })
  it('formule le sous-texte des retards', () => {
    expect(overdueHint(0)).toBe('Aucun en retard')
    expect(overdueHint(2)).toBe('2 en retard')
  })
})

describe('rounds de retours prévus', () => {
  it('lit un entier de 0 à 20', () => {
    expect(parseRounds('2')).toBe(2)
    expect(parseRounds(' 0 ')).toBe(0)
    expect(parseRounds('20')).toBe(20)
  })
  it('refuse le reste', () => {
    expect(parseRounds('')).toBeNull()
    expect(parseRounds('21')).toBeNull()
    expect(parseRounds('-1')).toBeNull()
    expect(parseRounds('1,5')).toBeNull()
    expect(validateRounds('2')).toBeNull()
    expect(validateRounds('x')).toMatch(/0 et 20/)
  })
})
