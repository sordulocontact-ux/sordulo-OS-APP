import { describe, expect, it } from 'vitest'
import {
  balanceSentence,
  computeRevenueSplit,
  isCommonMission,
  issuerMemberId,
  partnersOf,
  splitEntries,
  type SplitInput,
  type SplitInvoice,
  type SplitIssuer,
} from './revenueSplit.js'

const SACHA: SplitIssuer = { id: 'is-sacha', display_name: 'Sacha Moricet EI', member_id: 'm-sacha', archived_at: null }
const MAEL: SplitIssuer = { id: 'is-mael', display_name: 'Maël Auzenet EI', member_id: null, archived_at: null }
const members = [
  { id: 'm-sacha', name: 'Sacha Moricet' },
  { id: 'm-mael', name: 'Maël Auzenet' },
  { id: 'm-gab', name: 'Gabriela Dupont' },
]

function invoice(overrides: Partial<SplitInvoice>): SplitInvoice {
  return {
    id: 'inv',
    kind: 'invoice',
    status: 'paid',
    issuer_id: SACHA.id,
    project_id: null,
    paid_at: '2026-03-10T10:00:00Z',
    issue_date: '2026-03-01',
    total_ht_cents: 100_000,
    credited_invoice_id: null,
    ...overrides,
  }
}

function input(invoices: SplitInvoice[], extra: Partial<SplitInput> = {}): SplitInput {
  return { invoices, issuers: [SACHA, MAEL], members, projectMembers: {}, ...extra }
}

describe('associés et missions communes', () => {
  it('exige exactement deux émetteurs actifs', () => {
    expect(partnersOf([SACHA, MAEL])).toEqual([SACHA, MAEL])
    expect(partnersOf([SACHA])).toBeNull()
    expect(partnersOf([SACHA, MAEL, { ...SACHA, id: 'x' }])).toBeNull()
    expect(partnersOf([SACHA, MAEL, { ...SACHA, id: 'x', archived_at: '2026-01-01' }])).toEqual([SACHA, MAEL])
  })

  it('relie l’émetteur à son membre, par member_id puis par le prénom', () => {
    expect(issuerMemberId(SACHA, members)).toBe('m-sacha')
    expect(issuerMemberId(MAEL, members)).toBe('m-mael')
    expect(issuerMemberId({ ...MAEL, display_name: 'Studio X' }, members)).toBeNull()
  })

  it('commune : sans membre déclaré ou avec les deux associés', () => {
    const ids: [string | null, string | null] = ['m-sacha', 'm-mael']
    expect(isCommonMission(null, ids, {})).toBe(true)
    expect(isCommonMission('p1', ids, {})).toBe(true)
    expect(isCommonMission('p1', ids, { p1: ['m-sacha', 'm-mael', 'm-gab'] })).toBe(true)
    expect(isCommonMission('p1', ids, { p1: ['m-sacha'] })).toBe(false)
    expect(isCommonMission('p1', ids, { p1: ['m-sacha', 'm-gab'] })).toBe(false)
    expect(isCommonMission('p1', ['m-sacha', null], { p1: ['m-sacha'] })).toBe(false)
  })
})

describe('computeRevenueSplit', () => {
  it('l’émetteur qui encaisse doit la moitié à l’autre : « Sacha doit X à Maël » quand Maël encaisse', () => {
    const split = computeRevenueSplit(input([invoice({ issuer_id: MAEL.id })]), 2026)
    expect(split.firstOwesSecondCents).toBe(50_000)
    expect(balanceSentence(split.firstOwesSecondCents, split.partners ?? [SACHA, MAEL])).toContain('Sacha doit')
    expect(split.months).toEqual([{ month: '2026-03', firstOwesSecondCents: 50_000, invoiceCount: 1 }])
  })

  it('compense les encaissements croisés', () => {
    const split = computeRevenueSplit(
      input([
        invoice({ id: 'a', issuer_id: SACHA.id, total_ht_cents: 100_000 }),
        invoice({ id: 'b', issuer_id: MAEL.id, total_ht_cents: 40_000 }),
      ]),
      2026,
    )
    // Maël doit 500 à Sacha, Sacha doit 200 à Maël : Maël doit 300 à Sacha.
    expect(split.firstOwesSecondCents).toBe(-30_000)
    expect(balanceSentence(split.firstOwesSecondCents, split.partners ?? [SACHA, MAEL])).toMatch(/^Maël doit .* à Sacha$/)
    expect(split.commonHtCents).toBe(140_000)
  })

  it('ignore les missions non communes, les brouillons, les impayées, les autres années et l’organisation', () => {
    const split = computeRevenueSplit(
      input(
        [
          invoice({ id: 'solo', project_id: 'p-solo' }),
          invoice({ id: 'issued', status: 'issued', paid_at: null }),
          invoice({ id: 'old', paid_at: '2025-12-31T10:00:00Z' }),
          invoice({ id: 'org', issuer_id: null }),
          invoice({ id: 'ok', issuer_id: MAEL.id, project_id: 'p-common' }),
        ],
        { projectMembers: { 'p-solo': ['m-sacha'], 'p-common': ['m-sacha', 'm-mael'] } },
      ),
      2026,
    )
    expect(split.months).toHaveLength(1)
    expect(split.firstOwesSecondCents).toBe(50_000)
  })

  it('déduit un avoir d’une facture payée, au mois de l’avoir', () => {
    const invoices = [
      invoice({ id: 'f', status: 'cancelled', issuer_id: MAEL.id, total_ht_cents: 100_000 }),
      invoice({ id: 'a', kind: 'credit_note', status: 'issued', issuer_id: MAEL.id, paid_at: null, issue_date: '2026-05-02', total_ht_cents: -100_000, credited_invoice_id: 'f' }),
    ]
    const split = computeRevenueSplit(input(invoices), 2026)
    expect(split.months.map((m) => [m.month, m.firstOwesSecondCents])).toEqual([
      ['2026-03', 50_000],
      ['2026-05', -50_000],
    ])
    expect(split.firstOwesSecondCents).toBe(0)
    expect(balanceSentence(0, [SACHA, MAEL])).toBe('Comptes équilibrés')
  })

  it('ne déduit pas l’avoir d’une facture jamais payée', () => {
    const invoices = [
      invoice({ id: 'f', status: 'cancelled', paid_at: null }),
      invoice({ id: 'a', kind: 'credit_note', status: 'issued', paid_at: null, issue_date: '2026-05-02', total_ht_cents: -100_000, credited_invoice_id: 'f' }),
    ]
    expect(splitEntries(input(invoices))).toEqual([])
  })

  it('utilise credited_paid_at quand la facture créditée est hors liste', () => {
    const credit = invoice({ id: 'a', kind: 'credit_note', status: 'issued', paid_at: null, issue_date: '2026-05-02', total_ht_cents: -20_000, credited_invoice_id: 'ailleurs', credited_paid_at: '2025-11-02T10:00:00Z' })
    expect(splitEntries(input([credit]))[0]?.halfCents).toBe(-10_000)
  })

  it('compte le mois selon le jour de Paris', () => {
    const entries = splitEntries(input([invoice({ paid_at: '2026-03-31T23:30:00Z' })]))
    expect(entries[0]?.month).toBe('2026-04')
  })

  it('n’est pas applicable sans deux associés', () => {
    const split = computeRevenueSplit({ ...input([invoice({})]), issuers: [SACHA] }, 2026)
    expect(split.applicable).toBe(false)
    expect(split.months).toEqual([])
  })
})
