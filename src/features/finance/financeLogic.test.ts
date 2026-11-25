import { describe, expect, it } from 'vitest'
import {
  collectedByIssuer,
  collectionEvents,
  issuerThresholds,
  recentPayments,
  totalCents,
  unpaidInvoices,
  unpaidSummary,
  yearBars,
  yearOptions,
  type FinanceInvoice,
} from './financeLogic'

function inv(overrides: Partial<FinanceInvoice>): FinanceInvoice {
  return {
    id: 'i',
    number: 'F-1',
    kind: 'invoice',
    status: 'paid',
    issuer_id: 'is-a',
    project_id: null,
    client_id: 'c',
    credited_invoice_id: null,
    title: 'Facture',
    issue_date: '2026-03-01',
    due_date: '2026-03-31',
    paid_at: '2026-03-15T10:00:00Z',
    total_ht_cents: 100_000,
    total_ttc_cents: 120_000,
    client: { name: 'Ibé' },
    ...overrides,
  }
}

describe('encaissements', () => {
  it('compte une facture payée au mois de paiement, en HT', () => {
    const bars = yearBars([inv({})], 2026)
    expect(bars).toHaveLength(12)
    expect(bars[2]?.collectedCents).toBe(100_000)
    expect(bars[2]?.invoicedCents).toBe(100_000)
    expect(totalCents(bars)).toBe(100_000)
  })

  it('ignore les brouillons, les émises non payées et les autres années', () => {
    const events = collectionEvents(
      [
        inv({ id: 'a', status: 'draft', paid_at: null }),
        inv({ id: 'b', status: 'issued', paid_at: null }),
        inv({ id: 'c', paid_at: '2025-12-31T10:00:00Z' }),
        inv({ id: 'd' }),
      ],
      2026,
    )
    expect(events.map((e) => e.invoiceId)).toEqual(['d'])
  })

  it('déduit l’avoir d’une facture payée, pas celui d’une facture jamais payée', () => {
    const credit = inv({ id: 'a', kind: 'credit_note', status: 'issued', paid_at: null, issue_date: '2026-05-10', total_ht_cents: -100_000, credited_invoice_id: 'f' })
    const paid = inv({ id: 'f', status: 'cancelled' })
    const never = inv({ id: 'g', status: 'cancelled', paid_at: null })
    expect(totalCents(yearBars([paid, credit], 2026))).toBe(0)
    expect(totalCents(yearBars([never, { ...credit, credited_invoice_id: 'g' }], 2026))).toBe(0)
    expect(yearBars([paid, credit], 2026)[4]?.collectedCents).toBe(-100_000)
  })

  it('totalise par émetteur, sans émetteur sous la clé null', () => {
    const totals = collectedByIssuer([inv({ id: 'a' }), inv({ id: 'b', issuer_id: 'is-b', total_ht_cents: 40_000 }), inv({ id: 'c', issuer_id: null, total_ht_cents: 5_000 })], 2026)
    expect(totals.get('is-a')).toBe(100_000)
    expect(totals.get('is-b')).toBe(40_000)
    expect(totals.get(null)).toBe(5_000)
  })

  it('compte le mois selon le jour de Paris', () => {
    expect(yearBars([inv({ paid_at: '2026-03-31T23:30:00Z' })], 2026)[3]?.collectedCents).toBe(100_000)
  })
})

describe('listes', () => {
  it('trie les paiements récents', () => {
    const list = recentPayments([inv({ id: 'a', paid_at: '2026-03-01T10:00:00Z' }), inv({ id: 'b', paid_at: '2026-04-01T10:00:00Z' }), inv({ id: 'c', status: 'issued', paid_at: null })], 5)
    expect(list.map((i) => i.id)).toEqual(['b', 'a'])
  })

  it('place les factures en retard en premier', () => {
    const today = '2026-11-25'
    const list = unpaidInvoices(
      [
        inv({ id: 'future', status: 'issued', paid_at: null, due_date: '2026-12-10' }),
        inv({ id: 'late', status: 'issued', paid_at: null, due_date: '2026-11-20' }),
        inv({ id: 'later', status: 'issued', paid_at: null, due_date: '2026-10-01' }),
      ],
      today,
    )
    expect(list.map((i) => i.id)).toEqual(['later', 'late', 'future'])
    const summary = unpaidSummary(list, today)
    expect(summary).toMatchObject({ count: 3, overdueCount: 2, totalCents: 360_000, overdueCents: 240_000 })
  })

  it('propose trois années', () => {
    expect(yearOptions(new Date('2026-11-25T10:00:00Z'))).toEqual([2026, 2025, 2024])
  })
})

describe('seuils par émetteur', () => {
  const issuers = [
    { id: 'is-a', display_name: 'Sacha EI', archived_at: null },
    { id: 'is-b', display_name: 'Maël EI', archived_at: null },
    { id: 'is-old', display_name: 'Ancien', archived_at: '2025-01-01' },
  ]

  it('alerte quand un émetteur approche d’un plafond, masque les archivés sans CA', () => {
    const rows = issuerThresholds([inv({ id: 'big', total_ht_cents: 3_200_000 }), inv({ id: 'small', issuer_id: 'is-b', total_ht_cents: 100_000 })], issuers, 2026)
    expect(rows.map((r) => r.issuer.id)).toEqual(['is-a', 'is-b'])
    expect(rows[0]?.worst?.kind).toBe('vat')
    expect(rows[0]?.worst?.level).toBe('warning')
    expect(rows[1]?.worst).toBeNull()
  })
})
