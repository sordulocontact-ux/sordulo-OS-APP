import { describe, expect, it } from 'vitest'
import type { Prospect } from '../../shared/types'
import {
  allowedStages,
  canConvertProspect,
  canMarkOfferReady,
  filterProspects,
  formatRegistered,
  lostReasonError,
  pitchBlockerText,
  reminderPresets,
  scoreTone,
  shouldPollAudit,
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
    registered_at: '2026-11-01',
    audit: null,
    audit_status: 'none',
    audit_notes: null,
    audited_at: null,
    audited_by: null,
    recommended_service_id: null,
    offer_notes: null,
    pitch: null,
    lost_reason: null,
    do_not_contact: false,
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
    make({
      id: '1',
      company: 'Café Étoilé',
      stage: 'contacted',
      owner_member_id: 'm1',
    }),
    make({
      id: '2',
      company: 'Beta',
      stage: 'won',
      contact_name: 'Zoé',
      website: 'https://beta.fr',
    }),
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
        make({
          id: '4',
          stage: 'won',
          won_at: '2026-11-05T10:00:00',
          updated_at: '2026-11-05T10:00:00',
        }),
        make({
          id: '5',
          stage: 'won',
          won_at: '2026-10-05T10:00:00',
          updated_at: '2026-11-06T10:00:00',
        }),
        make({ id: '6', stage: 'lost', next_action_date: '2026-11-01' }),
      ],
      NOW,
    )
    expect(stats).toEqual({
      toAudit: 0,
      toFollowUp: 2,
      ongoing: 3,
      wonThisMonth: 1,
    })
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

describe('prospectStats : à auditer', () => {
  it('compte les sites en attente d’audit', () => {
    expect(prospectStats([make({ stage: 'to_audit' }), make({ stage: 'offer_ready' }), make({ stage: 'to_audit' })], NOW).toAudit).toBe(2)
  })
  it('les étapes À auditer et Offre prête sont des étapes ouvertes', () => {
    const ids = filterProspects([make({ id: 'a', stage: 'to_audit' }), make({ id: 'b', stage: 'offer_ready' })], {
      query: '',
      stage: '',
      owner: '',
    })
    expect(ids.map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('allowedStages', () => {
  it('l’agence pose toutes les étapes', () => {
    expect(allowedStages('admin', 'to_audit')).toHaveLength(8)
    expect(allowedStages('membre', 'lost')).toHaveLength(8)
  })
  it('l’apporteur attend l’audit : seulement Perdu, plus l’étape actuelle', () => {
    expect(allowedStages('prospection', 'to_audit')).toEqual(['to_audit', 'lost'])
  })
  it('l’apporteur ne pose jamais À auditer ni Offre prête', () => {
    expect(allowedStages('prospection', 'offer_ready')).toEqual([
      'offer_ready',
      'to_contact',
      'contacted',
      'followed_up',
      'meeting',
      'won',
      'lost',
    ])
    expect(allowedStages('prospection', 'contacted')).toEqual(['to_contact', 'contacted', 'followed_up', 'meeting', 'won', 'lost'])
  })
  it('rôle inconnu : comme un apporteur', () => {
    expect(allowedStages(null, 'to_audit')).toEqual(['to_audit', 'lost'])
  })
})

describe('droits et règles de la fiche', () => {
  it('convertir : admin et apporteur seulement', () => {
    expect(canConvertProspect('admin')).toBe(true)
    expect(canConvertProspect('prospection')).toBe(true)
    expect(canConvertProspect('membre')).toBe(true)
    expect(canConvertProspect('finance')).toBe(false)
  })
  it('Offre prête : agence, depuis À auditer, offre choisie', () => {
    expect(canMarkOfferReady('membre', { stage: 'to_audit' }, 's1')).toBe(true)
    expect(canMarkOfferReady('membre', { stage: 'to_audit' }, '')).toBe(false)
    expect(canMarkOfferReady('membre', { stage: 'contacted' }, 's1')).toBe(false)
    expect(canMarkOfferReady('prospection', { stage: 'to_audit' }, 's1')).toBe(false)
  })
  it('raison de refus obligatoire et bornée', () => {
    expect(lostReasonError('  ')).toMatch(/raison/)
    expect(lostReasonError('x'.repeat(1001))).toMatch(/trop longue/)
    expect(lostReasonError('Pas de budget')).toBeNull()
  })
  it('argumentaire : ce qui manque', () => {
    const base = {
      audit: null,
      audit_notes: null,
      recommended_service_id: null,
      do_not_contact: false,
    }
    expect(pitchBlockerText({ ...base, do_not_contact: true })).toMatch(/s’oppose/)
    expect(pitchBlockerText(base)).toMatch(/audit/)
    expect(pitchBlockerText({ ...base, audit_notes: 'x' })).toMatch(/offre/)
    expect(
      pitchBlockerText({
        ...base,
        audit_notes: 'x',
        recommended_service_id: 's',
      }),
    ).toBeNull()
  })
})

describe('shouldPollAudit et scoreTone', () => {
  it('suit un audit en cours ou tout juste lancé', () => {
    const p = {
      audit_status: 'running' as const,
      website: 'https://a.fr',
      created_at: '2026-01-01T00:00:00Z',
    }
    expect(shouldPollAudit(p, NOW)).toBe(true)
    const fresh = {
      ...p,
      audit_status: 'none' as const,
      created_at: new Date(NOW.getTime() - 20_000).toISOString(),
    }
    expect(shouldPollAudit(fresh, NOW)).toBe(true)
    expect(shouldPollAudit({ ...fresh, website: null }, NOW)).toBe(false)
    expect(
      shouldPollAudit(
        {
          ...fresh,
          created_at: new Date(NOW.getTime() - 120_000).toISOString(),
        },
        NOW,
      ),
    ).toBe(false)
    expect(shouldPollAudit({ ...p, audit_status: 'done' }, NOW)).toBe(false)
  })
  it('ton du score', () => {
    expect(scoreTone(90)).toBe('success')
    expect(scoreTone(60)).toBe('warning')
    expect(scoreTone(20)).toBe('danger')
    expect(scoreTone(null)).toBe('neutral')
  })
})

describe('reminderPresets et formatRegistered', () => {
  it('propose demain, +3 jours, +1 semaine', () => {
    expect(reminderPresets(NOW).map((p) => p.date)).toEqual(['2026-11-21', '2026-11-23', '2026-11-27'])
  })
  it('formate la date d’enregistrement', () => {
    expect(formatRegistered('2026-11-05')).toBe('5 novembre 2026')
    expect(formatRegistered('nope')).toBe('')
  })
})
