import { describe, expect, it } from 'vitest'
import type { DocumentLine } from '../../shared/types'
import {
  allowedTransitions,
  canDeleteQuote,
  canTransition,
  filterQuotes,
  finalInvoiceLabel,
  hasUnsavedChanges,
  isQuoteLocked,
  parseDepositPercent,
  parseStatusParam,
  quoteErrorText,
  quoteStats,
  sortQuotes,
  splitQuoteDeposits,
  transitionPatch,
  validateQuoteFields,
  type QuoteWithLinks,
} from './quoteLogic'

const line: DocumentLine = { label: 'Design', description: null, quantity: 1, unit: 'day', unit_price_cents: 50000, vat_rate: 20 }

function quote(over: Partial<QuoteWithLinks>): QuoteWithLinks {
  return {
    id: 'q', organization_id: 'o', client_id: 'c1', project_id: null, number: 'D-2026-001', title: 'Site vitrine',
    status: 'draft', issue_date: '2026-11-01', valid_until: null, lines: [line], notes: null,
    total_ht_cents: 0, total_vat_cents: 0, total_ttc_cents: 0, sent_at: null, accepted_at: null, refused_at: null,
    issuer_id: null, created_by: null, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z',
    client: { id: 'c1', name: 'Ibé' }, project: null,
    ...over,
  }
}

const TODAY = '2026-11-20'

describe('filterQuotes', () => {
  const all = [
    quote({ id: 'a', number: 'D-2026-001', status: 'sent', valid_until: '2026-12-01' }),
    quote({ id: 'b', number: 'D-2026-002', title: 'Identité', status: 'sent', valid_until: '2026-11-10', client_id: 'c2', client: { id: 'c2', name: 'Café Léa' } }),
    quote({ id: 'c', number: 'D-2026-003', status: 'accepted' }),
  ]
  const none = { query: '', status: '' as const, clientId: '' }
  it('sans filtre garde tout', () => expect(filterQuotes(all, none, TODAY)).toHaveLength(3))
  it('cherche par numéro, titre et client sans accents', () => {
    expect(filterQuotes(all, { ...none, query: '002' }, TODAY).map((q) => q.id)).toEqual(['b'])
    expect(filterQuotes(all, { ...none, query: 'identite' }, TODAY).map((q) => q.id)).toEqual(['b'])
    expect(filterQuotes(all, { ...none, query: 'cafe lea' }, TODAY).map((q) => q.id)).toEqual(['b'])
  })
  it('filtre « Expiré » sur le statut affiché', () => {
    expect(filterQuotes(all, { ...none, status: 'expired' }, TODAY).map((q) => q.id)).toEqual(['b'])
    expect(filterQuotes(all, { ...none, status: 'sent' }, TODAY).map((q) => q.id)).toEqual(['a'])
  })
  it('filtre par émetteur', () => {
    const list = [quote({ id: 'x', issuer_id: 'e1' }), quote({ id: 'y', issuer_id: 'e2' }), quote({ id: 'z' })]
    expect(filterQuotes(list, { ...none, issuerId: 'e2' }, TODAY).map((q) => q.id)).toEqual(['y'])
    expect(filterQuotes(list, { ...none, issuerId: '' }, TODAY)).toHaveLength(3)
  })
  it('filtre par client', () => expect(filterQuotes(all, { ...none, clientId: 'c2' }, TODAY).map((q) => q.id)).toEqual(['b']))
})

describe('sortQuotes', () => {
  it('plus récents d’abord, puis création', () => {
    const sorted = sortQuotes([
      quote({ id: 'old', issue_date: '2026-10-01' }),
      quote({ id: 'new', issue_date: '2026-11-05', created_at: '2026-11-05T08:00:00Z' }),
      quote({ id: 'newer', issue_date: '2026-11-05', created_at: '2026-11-05T09:00:00Z' }),
    ])
    expect(sorted.map((q) => q.id)).toEqual(['newer', 'new', 'old'])
  })
})

describe('quoteStats', () => {
  it('répartit en attente, acceptés de l’année, refusés ou expirés', () => {
    const stats = quoteStats(
      [
        quote({ status: 'sent', valid_until: '2026-12-01', total_ttc_cents: 1000 }),
        quote({ status: 'sent', valid_until: null, total_ttc_cents: 500 }),
        quote({ status: 'sent', valid_until: '2026-11-01', total_ttc_cents: 300 }),
        quote({ status: 'accepted', accepted_at: '2026-03-01T10:00:00Z', total_ttc_cents: 2000 }),
        quote({ status: 'accepted', accepted_at: '2025-03-01T10:00:00Z', total_ttc_cents: 9000 }),
        quote({ status: 'refused', total_ttc_cents: 700 }),
        quote({ status: 'draft', total_ttc_cents: 4000 }),
      ],
      TODAY,
    )
    expect(stats.pending).toEqual({ cents: 1500, count: 2 })
    expect(stats.accepted).toEqual({ cents: 2000, count: 1 })
    expect(stats.lost).toEqual({ cents: 1000, count: 2 })
    expect(stats.year).toBe('2026')
  })
})

describe('transitions', () => {
  it('brouillon → envoyé seulement', () => expect(allowedTransitions('draft')).toEqual(['sent']))
  it('envoyé → accepté, refusé ou brouillon', () => {
    expect(canTransition('sent', 'accepted')).toBe(true)
    expect(canTransition('sent', 'refused')).toBe(true)
    expect(canTransition('sent', 'draft')).toBe(true)
  })
  it('accepté et refusé sont figés', () => {
    expect(allowedTransitions('accepted')).toEqual([])
    expect(isQuoteLocked('refused')).toBe(true)
    expect(canTransition('accepted', 'draft')).toBe(false)
  })
  it('seul un brouillon se supprime', () => {
    expect(canDeleteQuote('draft')).toBe(true)
    expect(canDeleteQuote('sent')).toBe(false)
  })
  it('écrit les horodatages', () => {
    expect(transitionPatch('sent', 'T')).toEqual({ status: 'sent', sent_at: 'T' })
    expect(transitionPatch('draft', 'T')).toEqual({ status: 'draft', sent_at: null })
    expect(transitionPatch('accepted', 'T')).toEqual({ status: 'accepted', accepted_at: 'T' })
  })
})

describe('édition', () => {
  const saved = { title: 'A', lines: [line], notes: '', validUntil: '' }
  it('détecte les modifications', () => {
    expect(hasUnsavedChanges(saved, { ...saved, lines: [{ ...line }] })).toBe(false)
    expect(hasUnsavedChanges(saved, { ...saved, title: 'B' })).toBe(true)
    expect(hasUnsavedChanges(saved, { ...saved, lines: [{ ...line, quantity: 2 }] })).toBe(true)
  })
  it('valide titre, lignes et validité', () => {
    expect(validateQuoteFields(saved, '2026-11-01')).toEqual({})
    expect(validateQuoteFields({ ...saved, title: ' ' }, '2026-11-01').title).toBeDefined()
    expect(validateQuoteFields({ ...saved, lines: [] }, '2026-11-01').lines).toBeDefined()
    expect(validateQuoteFields({ ...saved, lines: [{ ...line, label: '' }] }, '2026-11-01').lines).toBeDefined()
    expect(validateQuoteFields({ ...saved, validUntil: '2026-10-01' }, '2026-11-01').validUntil).toBeDefined()
  })
  it('lit le pourcentage d’acompte', () => {
    expect(parseDepositPercent('30')).toBe(30)
    expect(parseDepositPercent('12,5')).toBe(12.5)
    expect(parseDepositPercent('0')).toBeNull()
    expect(parseDepositPercent('101')).toBeNull()
    expect(parseDepositPercent('abc')).toBeNull()
  })
  it('lit le paramètre de statut', () => {
    expect(parseStatusParam('expired')).toBe('expired')
    expect(parseStatusParam('nimporte')).toBe('')
    expect(parseStatusParam(null)).toBe('')
  })
})

describe('quoteErrorText', () => {
  it('traduit un refus de droits', () => {
    expect(quoteErrorText({ code: '42501', message: 'x' })).toBe('Seuls les admins et la finance peuvent modifier les devis.')
    expect(quoteErrorText(new Error('new row violates row-level security policy'))).toContain('Seuls les admins')
  })
  it('traduit une modification refusée sur un devis figé', () => {
    expect(quoteErrorText({ message: 'Quote is accepted: cannot be modified' })).toContain('ne peut plus être modifié')
  })
  it('garde un message générique', () => {
    expect(quoteErrorText(null)).toBe('Une erreur est survenue. Réessaie.')
  })
})

describe('facture de solde', () => {
  const dep = (number: string | null, status: 'draft' | 'issued' | 'paid' | 'cancelled') => ({ number, status })
  it('déduit les acomptes émis ou payés, signale les brouillons, ignore les annulés', () => {
    const { deducted, drafts } = splitQuoteDeposits([
      dep('F-2026-0007', 'paid'),
      dep(null, 'draft'),
      dep('F-2026-0002', 'issued'),
      dep('F-2026-0003', 'cancelled'),
    ])
    expect(deducted.map((d) => d.number)).toEqual(['F-2026-0002', 'F-2026-0007'])
    expect(drafts).toHaveLength(1)
  })
  it('change le libellé du bouton dès qu’un acompte est déduit', () => {
    expect(finalInvoiceLabel(0)).toBe('Créer la facture')
    expect(finalInvoiceLabel(2)).toBe('Créer la facture de solde')
  })
})
