import { describe, expect, it } from 'vitest'
import type { Invoice } from '../../shared/types'
import {
  activeFilterCount,
  csvFileName,
  EMPTY_FILTERS,
  exportableInvoices,
  filtersFromParams,
  filtersToParams,
  hasBillingAddress,
  invoiceDisplayStatus,
  invoiceErrorText,
  invoiceSecondLine,
  invoiceStats,
  issueCheck,
  matchesInvoice,
  sortInvoices,
  statusBadgeLabel,
  type InvoiceRow,
} from './invoiceLogic'

const TODAY = '2026-11-20'

function inv(over: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: 'i1',
    organization_id: 'o',
    client_id: 'c1',
    project_id: null,
    quote_id: null,
    kind: 'invoice',
    status: 'issued',
    number: 'F-2026-0001',
    title: 'Refonte du site',
    issue_date: '2026-11-01',
    due_date: '2026-12-01',
    lines: [],
    notes: null,
    deposit_percent: null,
    credited_invoice_id: null,
    seller: null,
    buyer: null,
    issued_at: null,
    paid_at: null,
    cancelled_at: null,
    created_by: null,
    created_at: '2026-11-01T10:00:00Z',
    updated_at: '2026-11-01T10:00:00Z',
    total_ht_cents: 10000,
    total_vat_cents: 2000,
    total_ttc_cents: 12000,
    client: { id: 'c1', name: 'Ibé', siret: null },
    ...over,
  }
}

describe('statut affiché', () => {
  it('calcule le retard', () => {
    expect(invoiceDisplayStatus(inv({ due_date: '2026-11-10' }), TODAY)).toBe('overdue')
    expect(invoiceDisplayStatus(inv({ due_date: '2026-11-20' }), TODAY)).toBe('issued')
    expect(invoiceDisplayStatus(inv({ status: 'paid', due_date: '2026-11-10' }), TODAY)).toBe('paid')
  })
  it('écrit le nombre de jours de retard', () => {
    expect(statusBadgeLabel(inv({ due_date: '2026-11-10' }), TODAY)).toBe('En retard de 10 j')
    expect(statusBadgeLabel(inv({ status: 'draft' }), TODAY)).toBe('Brouillon')
  })
})

describe('filtres', () => {
  it('passent par l’URL et ignorent les valeurs inconnues', () => {
    const f = filtersFromParams(new URLSearchParams('q=ibe&statut=overdue&type=deposit&client=c1'))
    expect(f).toEqual({ query: 'ibe', status: 'overdue', kind: 'deposit', clientId: 'c1' })
    expect(filtersFromParams(new URLSearchParams('statut=zz&type=zz'))).toEqual(EMPTY_FILTERS)
    expect(filtersToParams(f).toString()).toBe('q=ibe&statut=overdue&type=deposit&client=c1')
    expect(filtersToParams(EMPTY_FILTERS, new URLSearchParams('q=x&statut=paid')).toString()).toBe('')
    expect(activeFilterCount(f)).toBe(3)
  })
  it('filtrent sur statut, type, client et recherche sans accents', () => {
    const row = inv({ due_date: '2026-11-10' })
    expect(matchesInvoice(row, { ...EMPTY_FILTERS, status: 'overdue' }, TODAY)).toBe(true)
    expect(matchesInvoice(row, { ...EMPTY_FILTERS, status: 'issued' }, TODAY)).toBe(false)
    expect(matchesInvoice(row, { ...EMPTY_FILTERS, kind: 'deposit' }, TODAY)).toBe(false)
    expect(matchesInvoice(row, { ...EMPTY_FILTERS, clientId: 'c2' }, TODAY)).toBe(false)
    expect(matchesInvoice(row, { ...EMPTY_FILTERS, query: 'ibe' }, TODAY)).toBe(true)
    expect(matchesInvoice(row, { ...EMPTY_FILTERS, query: '0001' }, TODAY)).toBe(true)
    expect(matchesInvoice(row, { ...EMPTY_FILTERS, query: 'refonte' }, TODAY)).toBe(true)
    expect(matchesInvoice(row, { ...EMPTY_FILTERS, query: 'zzz' }, TODAY)).toBe(false)
  })
})

describe('tri', () => {
  it('met les brouillons en tête puis les plus récentes', () => {
    const a = inv({ id: 'a', issue_date: '2026-10-01' })
    const b = inv({ id: 'b', issue_date: '2026-11-05' })
    const d = inv({ id: 'd', status: 'draft', number: null, issue_date: null, created_at: '2026-09-01T00:00:00Z' })
    expect(sortInvoices([a, b, d]).map((i) => i.id)).toEqual(['d', 'b', 'a'])
  })
})

describe('cartes', () => {
  it('additionnent À encaisser, En retard et Encaissé ce mois, hors avoirs', () => {
    const list: Invoice[] = [
      inv({ id: '1', total_ttc_cents: 12000 }),
      inv({ id: '2', due_date: '2026-11-01', total_ttc_cents: 6000 }),
      inv({ id: '3', status: 'paid', paid_at: '2026-11-05T10:00:00Z', total_ttc_cents: 3000 }),
      inv({ id: '4', status: 'paid', paid_at: '2026-10-05T10:00:00Z', total_ttc_cents: 9000 }),
      inv({ id: '5', kind: 'credit_note', total_ttc_cents: -6000 }),
      inv({ id: '6', status: 'draft', number: null, total_ttc_cents: 500 }),
    ]
    expect(invoiceStats(list, TODAY)).toEqual({
      toCollectCents: 18000,
      toCollectCount: 2,
      overdueCents: 6000,
      overdueCount: 1,
      collectedThisMonthCents: 3000,
    })
  })
})

describe('émission', () => {
  const okClient = { billing_street: '1 rue A', billing_postal_code: '75001', billing_city: 'Paris' }
  const okOrg = { siret: '12345678900012', legal_name: 'Sordulo SAS' }
  const line = {}
  it('accepte une facture complète', () => {
    expect(issueCheck({ lines: [line], lineErrors: [{}], client: okClient, organization: okOrg })).toEqual({
      blockers: [],
      warnings: [],
    })
  })
  it('bloque sur lignes en erreur, absence de lignes et adresse', () => {
    const r = issueCheck({ lines: [line], lineErrors: [{ label: 'x' }], client: { ...okClient, billing_city: null }, organization: okOrg })
    expect(r.blockers.map((b) => b.code)).toEqual(['lines', 'address'])
    expect(issueCheck({ lines: [], lineErrors: [], client: okClient, organization: okOrg }).blockers[0]?.code).toBe('empty')
    expect(hasBillingAddress({ billing_street: ' ', billing_postal_code: '1', billing_city: 'x' })).toBe(false)
  })
  it('bloque sur un total négatif (facture de solde qui déduit trop)', () => {
    const r = issueCheck({ lines: [line], lineErrors: [{}], totalError: 'Total négatif', client: okClient, organization: okOrg })
    expect(r.blockers).toEqual([{ code: 'total', message: 'Total négatif' }])
  })
  it('avertit sans bloquer quand SIRET ou raison sociale manquent', () => {
    const r = issueCheck({ lines: [line], lineErrors: [{}], client: okClient, organization: { siret: null, legal_name: 'X' } })
    expect(r.blockers).toEqual([])
    expect(r.warnings.map((w) => w.code)).toEqual(['legal'])
  })
})

describe('erreurs et fichier', () => {
  it('traduit les erreurs de la base', () => {
    expect(invoiceErrorText({ code: '42501', message: 'new row violates row-level security policy' })).toBe(
      'Seuls les admins et la finance peuvent modifier les factures.',
    )
    expect(invoiceErrorText({ code: 'P0001', message: 'Une facture émise ne peut plus être modifiée : crée un avoir pour la corriger' })).toBe(
      'Une facture émise ne peut plus être modifiée : crée un avoir.',
    )
    expect(invoiceErrorText({ code: '23514', message: "Le total d'une facture ne peut pas être négatif : crée un avoir." })).toBe(
      'Le total d’une facture ne peut pas être négatif : crée un avoir.',
    )
    expect(invoiceErrorText({ message: 'boom' })).toBe('Une erreur est survenue : boom')
    expect(invoiceErrorText(null)).toBe('Une erreur est survenue. Réessaie.')
  })
  it('nomme le CSV et écarte les brouillons', () => {
    expect(csvFileName('2026-11-20')).toBe('factures-2026-11-20.csv')
    expect(exportableInvoices([inv({ status: 'draft' }), inv()])).toHaveLength(1)
  })
})

describe('seconde ligne', () => {
  it('ajoute le type, sauf si le titre le contient déjà en tête', () => {
    expect(invoiceSecondLine({ kind: 'invoice', title: 'Site vitrine' })).toBe('Facture : Site vitrine')
    expect(invoiceSecondLine({ kind: 'credit_note', title: 'Avoir sur F-2026-0002' })).toBe('Avoir sur F-2026-0002')
    expect(invoiceSecondLine({ kind: 'deposit', title: 'acompte 30 %' })).toBe('acompte 30 %')
  })
})
