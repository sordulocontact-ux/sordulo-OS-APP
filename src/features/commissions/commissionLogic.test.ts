import { describe, expect, it } from 'vitest'
import {
  canChangeCommissionStatus,
  commissionCompany,
  commissionTotals,
  describeTiers,
  filterCommissions,
  parseStatusParam,
  planRules,
  statusActions,
  type CommissionRow,
} from './commissionLogic'

function row(over: Partial<CommissionRow>): CommissionRow {
  return {
    id: 'c',
    organization_id: 'o',
    member_id: 'm1',
    prospect_id: 'p',
    client_id: 'cl',
    quote_id: 'q',
    invoice_id: 'i',
    kind: 'first',
    base_cents: 100000,
    amount_cents: 12000,
    status: 'due',
    payer_issuer_id: null,
    invoiced_at: null,
    paid_at: null,
    note: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    prospect: { company: 'Café Étoilé' },
    client: null,
    ...over,
  }
}

describe('commissionTotals', () => {
  it('additionne par statut, avoirs déduits, annulées ignorées', () => {
    expect(
      commissionTotals([
        row({ status: 'due', amount_cents: 10000 }),
        row({ status: 'due', amount_cents: -2500 }),
        row({ status: 'invoiced', amount_cents: 5000 }),
        row({ status: 'paid', amount_cents: 7000 }),
        row({ status: 'cancelled', amount_cents: 99999 }),
      ]),
    ).toEqual({ due: 7500, invoiced: 5000, paid: 7000 })
  })
})

describe('commissionCompany et filtres', () => {
  it('société du prospect, sinon client, sinon tiret', () => {
    expect(commissionCompany(row({}))).toBe('Café Étoilé')
    expect(commissionCompany(row({ prospect: null, client: { name: 'Beta' } }))).toBe('Beta')
    expect(commissionCompany(row({ prospect: null }))).toBe('Société inconnue')
  })
  it('filtre par statut, apporteur et recherche sans accent', () => {
    const rows = [
      row({ id: '1' }),
      row({
        id: '2',
        status: 'paid',
        member_id: 'm2',
        prospect: { company: 'Gamma' },
      }),
    ]
    expect(filterCommissions(rows, { query: '', status: 'paid', member: '' }).map((r) => r.id)).toEqual(['2'])
    expect(filterCommissions(rows, { query: '', status: '', member: 'm1' }).map((r) => r.id)).toEqual(['1'])
    expect(
      filterCommissions(rows, {
        query: 'cafe etoile',
        status: '',
        member: '',
      }).map((r) => r.id),
    ).toEqual(['1'])
  })
  it('lit le paramètre de statut', () => {
    expect(parseStatusParam('paid')).toBe('paid')
    expect(parseStatusParam('x')).toBe('')
    expect(parseStatusParam(null)).toBe('')
  })
})

describe('droits et changements de statut', () => {
  it('admin et finance seulement', () => {
    expect(canChangeCommissionStatus('admin')).toBe(true)
    expect(canChangeCommissionStatus('finance')).toBe(true)
    expect(canChangeCommissionStatus('membre')).toBe(false)
    expect(canChangeCommissionStatus('prospection')).toBe(false)
  })
  it('propose tous les statuts sauf l’actuel', () => {
    expect(statusActions('due').map((a) => a.status)).toEqual(['invoiced', 'paid', 'cancelled'])
    expect(statusActions('paid').map((a) => a.status)).toEqual(['due', 'invoiced', 'cancelled'])
  })
})

describe('barème en texte', () => {
  const tiers = [
    { up_to_cents: 100000, rate: 12 },
    { up_to_cents: 500000, rate: 10 },
    { up_to_cents: null, rate: 8 },
  ]
  it('décrit chaque tranche', () => {
    const text = describeTiers(tiers).map((t) => t.replace(/\s/g, ' '))
    expect(text).toEqual(['12 % jusqu’à 1 000,00 €', '10 % de 1 000,00 € à 5 000,00 €', '8 % au-delà de 5 000,00 €'])
  })
  it('une tranche unique couvre tout l’encaissé', () => {
    expect(describeTiers([{ up_to_cents: null, rate: 5 }])).toEqual(['5 % sur tout l’encaissé'])
  })
  it('écrit les règles depuis le barème', () => {
    const rules = planRules({
      tiers,
      followup_rate: 5,
      sign_window_months: 6,
      followup_window_months: 12,
    })
    expect(rules).toHaveLength(3)
    expect(rules[1]).toContain('5 %')
    expect(rules[1]).toContain('12 mois')
    expect(rules[2]).toContain('6 mois')
  })
})
