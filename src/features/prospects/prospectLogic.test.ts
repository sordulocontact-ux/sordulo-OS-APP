import { describe, expect, it } from 'vitest'
import type { Prospect } from '../../shared/types'
import {
  filterProspects,
  normalizeSite,
  parseStageParam,
  prospectStats,
  relativeAction,
  sortProspects,
} from './prospectLogic'

const NOW = new Date(2026, 10, 20, 15, 30) // 20/11/2026

function make(over: Partial<Prospect>): Prospect {
  return {
    id: 'p',
    organization_id: 'o',
    company: 'Acme',
    website: null,
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    source: null,
    stage: 'to_contact',
    next_action_date: null,
    notes: null,
    owner_member_id: null,
    client_id: null,
    created_by: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    won_at: null,
    ...over,
  }
}

describe('relativeAction', () => {
  it('formate aujourd’hui, retard et futur', () => {
    expect(relativeAction(make({ next_action_date: '2026-11-20' }), NOW)).toEqual({ text: "Aujourd'hui", overdue: false })
    expect(relativeAction(make({ next_action_date: '2026-11-17' }), NOW)).toEqual({ text: 'En retard de 3 j', overdue: true })
    expect(relativeAction(make({ next_action_date: '2026-11-22' }), NOW)).toEqual({ text: 'Dans 2 j', overdue: false })
  })
  it('rien sans date ni sur un prospect clos', () => {
    expect(relativeAction(make({}), NOW)).toBeNull()
    expect(relativeAction(make({ stage: 'won', next_action_date: '2026-11-01' }), NOW)).toBeNull()
  })
})

describe('filterProspects', () => {
  const list = [
    make({ id: '1', company: 'Café Étoilé', stage: 'contacted', owner_member_id: 'm1' }),
    make({ id: '2', company: 'Beta', stage: 'won', contact_name: 'Zoé', website: 'https://beta.fr' }),
    make({ id: '3', company: 'Gamma', stage: 'lost' }),
  ]
  it('étapes actives par défaut', () => {
    expect(filterProspects(list, { query: '', stage: '', owner: '' }).map((p) => p.id)).toEqual(['1'])
  })
  it('gagnés et perdus, ou une étape', () => {
    expect(filterProspects(list, { query: '', stage: 'closed', owner: '' }).map((p) => p.id)).toEqual(['2', '3'])
    expect(filterProspects(list, { query: '', stage: 'won', owner: '' }).map((p) => p.id)).toEqual(['2'])
  })
  it('recherche sans accent sur entreprise, contact et site, et responsable', () => {
    expect(filterProspects(list, { query: 'cafe etoile', stage: '', owner: '' })).toHaveLength(1)
    expect(filterProspects(list, { query: 'zoe', stage: 'closed', owner: '' })).toHaveLength(1)
    expect(filterProspects(list, { query: 'beta.fr', stage: 'closed', owner: '' })).toHaveLength(1)
    expect(filterProspects(list, { query: '', stage: '', owner: 'm2' })).toHaveLength(0)
  })
})

describe('sortProspects', () => {
  it('urgent d’abord, puis sans date (récents d’abord), puis clos', () => {
    const sorted = sortProspects([
      make({ id: 'closed', stage: 'won', next_action_date: '2026-01-01' }),
      make({ id: 'none-old', created_at: '2026-10-01T00:00:00Z' }),
      make({ id: 'later', next_action_date: '2026-12-01' }),
      make({ id: 'none-new', created_at: '2026-11-10T00:00:00Z' }),
      make({ id: 'late', next_action_date: '2026-11-01' }),
    ])
    expect(sorted.map((p) => p.id)).toEqual(['late', 'later', 'none-new', 'none-old', 'closed'])
  })
})

describe('prospectStats', () => {
  it('compte à relancer, en cours et gagnés du mois', () => {
    const stats = prospectStats(
      [
        make({ id: '1', next_action_date: '2026-11-20' }),
        make({ id: '2', next_action_date: '2026-11-01', stage: 'meeting' }),
        make({ id: '3', next_action_date: '2026-12-01' }),
        make({ id: '4', stage: 'won', won_at: '2026-11-05T10:00:00', updated_at: '2026-11-05T10:00:00' }),
        make({ id: '5', stage: 'won', won_at: '2026-10-05T10:00:00', updated_at: '2026-11-06T10:00:00' }),
        make({ id: '6', stage: 'lost', next_action_date: '2026-11-01' }),
      ],
      NOW,
    )
    expect(stats).toEqual({ toFollowUp: 2, ongoing: 3, wonThisMonth: 1 })
  })
})

describe('normalizeSite et parseStageParam', () => {
  it('ajoute https:// si oublié', () => {
    expect(normalizeSite(' acme.fr ')).toBe('https://acme.fr')
    expect(normalizeSite('http://acme.fr')).toBe('http://acme.fr')
    expect(normalizeSite('  ')).toBeNull()
  })
  it('lit le paramètre d’étape', () => {
    expect(parseStageParam('closed')).toBe('closed')
    expect(parseStageParam('meeting')).toBe('meeting')
    expect(parseStageParam('nope')).toBe('')
    expect(parseStageParam(null)).toBe('')
  })
})
