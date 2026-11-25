import { describe, expect, it } from 'vitest'
import { can, matchesQuery, ownsProspect, seesAllProspects } from './access.js'
import { financeLines, financeSummary, formatEuros, parisDate, type FinanceInvoice } from './finance.js'

const inv = (over: Partial<FinanceInvoice>): FinanceInvoice => ({
  kind: 'invoice',
  status: 'paid',
  due_date: null,
  paid_at: null,
  total_ht_cents: 0,
  total_ttc_cents: 0,
  ...over,
})

describe('chiffres du mois', () => {
  it('date de paiement à l’heure de Paris', () => {
    expect(parisDate(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01')
    const summary = financeSummary([inv({ paid_at: '2026-10-31T23:30:00Z', total_ht_cents: 1000 })], '2026-11-20')
    expect(summary.collectedMonthCents).toBe(1000)
  })

  it('avoirs jamais encaissés, brouillons ignorés, retards', () => {
    const summary = financeSummary(
      [
        inv({ kind: 'credit_note', paid_at: '2026-11-02T10:00:00Z', total_ht_cents: -500 }),
        inv({ status: 'draft', total_ttc_cents: 999 }),
        inv({ status: 'issued', due_date: '2026-11-30', total_ttc_cents: 1200 }),
        inv({ status: 'issued', due_date: '2026-11-01', total_ttc_cents: 2400 }),
        inv({ paid_at: '2025-12-31T10:00:00Z', total_ht_cents: 7000 }),
      ],
      '2026-11-20',
    )
    expect(summary).toMatchObject({ collectedMonthCents: 0, collectedYearCents: 0, unpaidCount: 2, unpaidCents: 3600, overdueCount: 1, overdueCents: 2400 })
    expect(financeLines(summary)[2]).toContain('dont 1 en retard')
  })

  it('montants en euros', () => {
    expect(formatEuros(300000).replace(/\s/g, ' ')).toBe('3 000 €')
    expect(formatEuros(123456).replace(/\s/g, ' ')).toBe('1 234,56 €')
  })
})

describe('droits', () => {
  it('par rôle', () => {
    expect(can('finance', 'work')).toBe(false)
    expect(can('finance', 'billing')).toBe(true)
    expect(can('membre', 'billing')).toBe(false)
    expect(can('prospection', 'projects')).toBe(false)
    expect(seesAllProspects('prospection')).toBe(false)
    expect(ownsProspect('m', { owner_member_id: null, created_by: 'm' })).toBe(true)
  })

  it('recherche sans accents, tous les mots', () => {
    expect(matchesQuery('ibe app', 'App Ibé')).toBe(true)
    expect(matchesQuery('ibe site', 'App Ibé')).toBe(false)
    expect(matchesQuery('  ', 'App Ibé')).toBe(false)
  })
})
