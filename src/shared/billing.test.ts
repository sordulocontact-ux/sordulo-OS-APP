import { describe, expect, it } from 'vitest'
import {
  addDays,
  computeTotals,
  daysLate,
  defaultLine,
  duplicateQuote,
  formatDate,
  formatLongDate,
  formatMoney,
  formatQuantity,
  invoiceFromQuote,
  invoicesCsv,
  isOverdue,
  legalMentions,
  lineHtCents,
  parseMoneyInput,
  parseQuantity,
  parseVatRate,
  quoteDisplayStatus,
  roundHalfAwayFromZero,
  sellerFromIssuer,
  validateInvoiceLines,
  validateLines,
} from './billing.js'
import type { BillingIssuer, DocumentLine, Invoice, Quote } from './types.js'

function line(over: Partial<DocumentLine> = {}): DocumentLine {
  return { label: 'Design', description: null, quantity: 1, unit: 'day', unit_price_cents: 10000, vat_rate: 20, ...over }
}

const twoRates: DocumentLine[] = [
  line({ quantity: 2.5, unit_price_cents: 48000, vat_rate: 20 }), // 120000
  line({ label: 'Impression', quantity: 3, unit: 'unit', unit_price_cents: 3333, vat_rate: 5.5 }), // 9999
]

describe('arrondis', () => {
  it('arrondit les demis vers l’extérieur', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3)
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3)
    expect(roundHalfAwayFromZero(2.4)).toBe(2)
    expect(roundHalfAwayFromZero(-0.4)).toBe(0)
  })
  it('absorbe le bruit des flottants', () => {
    expect(lineHtCents({ quantity: 0.15, unit_price_cents: 10050 })).toBe(1508)
  })
})

describe('computeTotals', () => {
  it('calcule HT, TVA par taux et TTC', () => {
    const t = computeTotals(twoRates)
    expect(t.vatByRate).toEqual([
      { rate: 5.5, base_cents: 9999, vat_cents: 550 }, // 549,945 → 550
      { rate: 20, base_cents: 120000, vat_cents: 24000 },
    ])
    expect(t.total_ht_cents).toBe(129999)
    expect(t.total_vat_cents).toBe(24550)
    expect(t.total_ttc_cents).toBe(154549)
  })
  it('arrondit la TVA par taux, pas par ligne', () => {
    const t = computeTotals([line({ unit_price_cents: 1, vat_rate: 50 }), line({ unit_price_cents: 1, vat_rate: 50 })])
    expect(t.vatByRate).toEqual([{ rate: 50, base_cents: 2, vat_cents: 1 }])
  })
  it('gère un avoir négatif', () => {
    const t = computeTotals([line({ unit_price_cents: -12345, vat_rate: 20 })])
    expect(t.total_ht_cents).toBe(-12345)
    expect(t.total_vat_cents).toBe(-2469) // -2469,0 exactement
    expect(t.total_ttc_cents).toBe(-14814)
  })
  it('un document vide vaut zéro', () => {
    expect(computeTotals([])).toEqual({ total_ht_cents: 0, total_vat_cents: 0, total_ttc_cents: 0, vatByRate: [] })
  })
})

describe('formats', () => {
  it('formate les montants en euros français', () => {
    expect(formatMoney(123450).replace(/[\u00a0\u202f]/g, ' ')).toBe('1 234,50 €')
    expect(formatMoney(-500).replace(/[\u00a0\u202f]/g, ' ')).toBe('-5,00 €')
  })
  it('lit un montant saisi', () => {
    expect(parseMoneyInput('1 234,5')).toEqual({ ok: true, value: 123450 })
    expect(parseMoneyInput('12.50 €')).toEqual({ ok: true, value: 1250 })
    expect(parseMoneyInput('-80')).toEqual({ ok: true, value: -8000 })
    expect(parseMoneyInput('abc').ok).toBe(false)
    expect(parseMoneyInput('1,234').ok).toBe(false)
    expect(parseMoneyInput('').ok).toBe(false)
  })
  it('formate et lit les quantités', () => {
    expect(formatQuantity(1.5)).toBe('1,5')
    expect(formatQuantity(2)).toBe('2')
    expect(parseQuantity('0,5')).toEqual({ ok: true, value: 0.5 })
    expect(parseQuantity('2.25')).toEqual({ ok: true, value: 2.25 })
    expect(parseQuantity('0').ok).toBe(false)
    expect(parseQuantity('1,234').ok).toBe(false)
    expect(parseQuantity('-1').ok).toBe(false)
  })
  it('lit un taux de TVA', () => {
    expect(parseVatRate('5,5')).toEqual({ ok: true, value: 5.5 })
    expect(parseVatRate('101').ok).toBe(false)
  })
  it('formate les dates', () => {
    expect(formatDate('2026-11-20')).toBe('20/11/2026')
    expect(formatLongDate('2026-11-20')).toBe('20 novembre 2026')
    expect(formatLongDate('2026-12-01')).toBe('1er décembre 2026')
    expect(addDays('2026-11-20', 30)).toBe('2026-12-20')
  })
})

describe('validateLines', () => {
  it('signale chaque champ fautif en français', () => {
    const errors = validateLines([
      line(),
      line({ label: '  ', quantity: 0, unit_price_cents: -1, vat_rate: 120 }),
    ])
    expect(errors[0]).toEqual({})
    expect(errors[1]).toEqual({
      label: 'Indique une désignation.',
      quantity: 'La quantité doit être supérieure à 0.',
      unit_price: 'Le prix ne peut pas être négatif.',
      vat_rate: 'La TVA va de 0 à 100 %.',
    })
  })
  it('accepte un prix négatif pour un avoir', () => {
    expect(validateLines([line({ unit_price_cents: -500 })], { allowNegative: true })).toEqual([{}])
  })
})

describe('validateInvoiceLines (même règle que la base)', () => {
  const deduction = line({ label: 'Acompte F-2026-0001 déjà facturé', unit: 'flat', unit_price_cents: -3000 })
  it('facture : ligne négative permise tant que le total reste positif ou nul', () => {
    expect(validateInvoiceLines('invoice', [line(), deduction])).toEqual({ lineErrors: [{}, {}], totalError: null })
    expect(validateInvoiceLines('invoice', [line(), line({ unit_price_cents: -10000 })]).totalError).toBeNull() // total 0
  })
  it('facture : total négatif refusé', () => {
    expect(validateInvoiceLines('invoice', [line(), line({ unit_price_cents: -10001 })]).totalError).toBe(
      'Le total d’une facture ne peut pas être négatif : crée un avoir.',
    )
    // HT positif mais TTC négatif (taux différents) : refusé aussi.
    const ttcNegative = [line({ unit_price_cents: 1000, vat_rate: 0 }), line({ unit_price_cents: -900, vat_rate: 20 })]
    expect(computeTotals(ttcNegative)).toMatchObject({ total_ht_cents: 100, total_ttc_cents: -80 })
    expect(validateInvoiceLines('invoice', ttcNegative).totalError).not.toBeNull()
  })
  it('acompte : jamais de prix négatif', () => {
    const { lineErrors, totalError } = validateInvoiceLines('deposit', [line(), deduction])
    expect(lineErrors[1]).toEqual({ unit_price: 'Le prix ne peut pas être négatif.' })
    expect(totalError).toBeNull()
  })
  it('avoir : prix et total négatifs permis', () => {
    expect(validateInvoiceLines('credit_note', [line({ unit_price_cents: -500 })])).toEqual({ lineErrors: [{}], totalError: null })
  })
})

describe('defaultLine', () => {
  const org = { default_daily_rate: 450, default_hourly_rate: 60.5, default_vat_rate: 20 }
  it('reprend le taux journalier ou horaire en centimes', () => {
    expect(defaultLine(org, 'day')).toMatchObject({ unit: 'day', unit_price_cents: 45000, vat_rate: 20, quantity: 1 })
    expect(defaultLine(org, 'hour').unit_price_cents).toBe(6050)
    expect(defaultLine(org, 'flat').unit_price_cents).toBe(0)
    expect(defaultLine({ ...org, default_daily_rate: null }, 'day').unit_price_cents).toBe(0)
  })
})

describe('statuts', () => {
  it('affiche « expiré » pour un devis envoyé dont la validité est passée', () => {
    expect(quoteDisplayStatus({ status: 'sent', valid_until: '2026-11-19' }, '2026-11-20')).toBe('expired')
    expect(quoteDisplayStatus({ status: 'sent', valid_until: '2026-11-20' }, '2026-11-20')).toBe('sent')
    expect(quoteDisplayStatus({ status: 'accepted', valid_until: '2026-01-01' }, '2026-11-20')).toBe('accepted')
    expect(quoteDisplayStatus({ status: 'draft', valid_until: null }, '2026-11-20')).toBe('draft')
  })
  it('détecte le retard de paiement', () => {
    const inv = { status: 'issued' as const, due_date: '2026-11-10' }
    expect(isOverdue(inv, '2026-11-20')).toBe(true)
    expect(daysLate(inv, '2026-11-20')).toBe(10)
    expect(isOverdue({ ...inv, status: 'paid' }, '2026-11-20')).toBe(false)
    expect(isOverdue({ ...inv, due_date: '2026-11-20' }, '2026-11-20')).toBe(false)
    expect(daysLate({ ...inv, status: 'paid' }, '2026-11-20')).toBe(0)
  })
})

const quote = {
  id: 'q1',
  client_id: 'c1',
  project_id: 'p1',
  number: 'D-2026-001',
  title: 'Refonte du site',
  lines: twoRates,
  notes: 'Merci',
} satisfies Pick<Quote, 'id' | 'client_id' | 'project_id' | 'number' | 'title' | 'lines' | 'notes'>

describe('brouillons dérivés', () => {
  it('facture complète : lignes du devis', () => {
    const d = invoiceFromQuote(quote, { kind: 'invoice' })
    expect(d).toMatchObject({ kind: 'invoice', quote_id: 'q1', client_id: 'c1', project_id: 'p1', deposit_percent: null })
    expect(d.lines).toEqual(twoRates)
    expect(d.lines[0]).not.toBe(twoRates[0])
  })
  it('acompte de 30 % sur un devis à deux taux', () => {
    const d = invoiceFromQuote(quote, { kind: 'deposit', percent: 30 })
    expect(d.kind).toBe('deposit')
    expect(d.deposit_percent).toBe(30)
    expect(d.lines).toHaveLength(2)
    expect(d.lines[0]).toMatchObject({
      label: 'Acompte de 30 % sur le devis D-2026-001',
      quantity: 1,
      unit: 'flat',
      unit_price_cents: 3000, // 9999 × 30 % = 2999,7
      vat_rate: 5.5,
    })
    expect(d.lines[1]).toMatchObject({ unit_price_cents: 36000, vat_rate: 20 })
    const t = computeTotals(d.lines)
    expect(t.total_ht_cents).toBe(39000)
    expect(t.total_vat_cents).toBe(7365) // 165 + 7200
  })
  it('refuse un pourcentage hors 1..100', () => {
    expect(() => invoiceFromQuote(quote, { kind: 'deposit', percent: 0 })).toThrow(RangeError)
    expect(() => invoiceFromQuote(quote, { kind: 'deposit', percent: 101 })).toThrow(RangeError)
    expect(() => invoiceFromQuote(quote, { kind: 'deposit' })).toThrow(RangeError)
    expect(invoiceFromQuote(quote, { kind: 'deposit', percent: 100 }).lines[1]?.unit_price_cents).toBe(120000)
  })
  describe('facture de solde', () => {
    // Exemple constaté : devis de 2 226,95 € TTC, acompte de 30 % F-2026-0001 de 668,09 € TTC.
    const ibe = {
      ...quote,
      title: 'App Ibé',
      lines: [
        line({ label: 'Développement', quantity: 3.5, unit: 'day', unit_price_cents: 50000, vat_rate: 20 }), // 175 000
        line({ label: 'Livret', quantity: 1, unit: 'flat', unit_price_cents: 12033, vat_rate: 5.5 }), // 12 033
      ],
    }
    const deposit = { number: 'F-2026-0001', lines: invoiceFromQuote(ibe, { kind: 'deposit', percent: 30 }).lines }

    it('les montants de départ sont ceux constatés', () => {
      expect(computeTotals(ibe.lines).total_ttc_cents).toBe(222695)
      // Acompte : 3 609,9 → 3 610 à 5,5 % ; 52 500 à 20 %. TVA 198,55 → 199 et 10 500.
      expect(deposit.lines.map((l) => [l.unit_price_cents, l.vat_rate])).toEqual([
        [3610, 5.5],
        [52500, 20],
      ])
      expect(computeTotals(deposit.lines).total_ttc_cents).toBe(66809)
    })

    it('reprend le devis puis déduit l’acompte par taux, au centime près', () => {
      const d = invoiceFromQuote(ibe, { kind: 'invoice', deposits: [deposit] })
      expect(d.title).toBe('Solde : App Ibé')
      expect(d.kind).toBe('invoice')
      expect(d.lines.slice(0, 2)).toEqual(ibe.lines)
      expect(d.lines.slice(2)).toEqual([
        {
          label: 'Acompte F-2026-0001 déjà facturé',
          description: 'Déduction de l’acompte, TVA 5,5 %',
          quantity: 1,
          unit: 'flat',
          unit_price_cents: -3610,
          vat_rate: 5.5,
        },
        {
          label: 'Acompte F-2026-0001 déjà facturé',
          description: 'Déduction de l’acompte, TVA 20 %',
          quantity: 1,
          unit: 'flat',
          unit_price_cents: -52500,
          vat_rate: 20,
        },
      ])
      const t = computeTotals(d.lines)
      // 5,5 % : 12 033 - 3 610 = 8 423, TVA 463,265 → 463 ; 20 % : 122 500, TVA 24 500.
      expect(t.vatByRate).toEqual([
        { rate: 5.5, base_cents: 8423, vat_cents: 463 },
        { rate: 20, base_cents: 122500, vat_cents: 24500 },
      ])
      expect(t.total_ttc_cents).toBe(155886) // 1 558,86 €
      expect(t.total_ttc_cents).toBe(222695 - 66809)
      expect(validateInvoiceLines('invoice', d.lines)).toEqual({ lineErrors: [{}, {}, {}, {}], totalError: null })
    })

    it('déduit chaque acompte, dans l’ordre donné', () => {
      const second = { number: 'F-2026-0004', lines: invoiceFromQuote(ibe, { kind: 'deposit', percent: 20 }).lines }
      const d = invoiceFromQuote(ibe, { kind: 'invoice', deposits: [deposit, second] })
      expect(d.lines.map((l) => l.label)).toEqual([
        'Développement',
        'Livret',
        'Acompte F-2026-0001 déjà facturé',
        'Acompte F-2026-0001 déjà facturé',
        'Acompte F-2026-0004 déjà facturé',
        'Acompte F-2026-0004 déjà facturé',
      ])
      expect(computeTotals(d.lines).total_ht_cents).toBe(187033 - 56110 - 37407)
    })

    it('sans acompte : facture complète, titre du devis', () => {
      const d = invoiceFromQuote(ibe, { kind: 'invoice', deposits: [] })
      expect(d.title).toBe('App Ibé')
      expect(d.lines).toEqual(ibe.lines)
    })
  })

  it('duplique un devis en brouillon sans numéro', () => {
    const d = duplicateQuote(quote)
    expect(d.title).toBe('Refonte du site (copie)')
    expect(d.status).toBe('draft')
    expect('number' in d).toBe(false)
    expect(d.lines).toEqual(twoRates)
  })
})

describe('legalMentions', () => {
  const seller = { vat_mention: 'TVA non applicable, art. 293 B du CGI', bank_iban: 'FR76 3000 1000 0000', bank_bic: 'BDFEFRPP' }
  it('facture : échéance, escompte, pénalités, IBAN', () => {
    const m = legalMentions({ kind: 'invoice', seller, dueDate: '2026-12-20', issueDate: '2026-11-20', vatTotal: 2000 })
    expect(m).toEqual([
      'À payer avant le 20/12/2026',
      'Pas d’escompte pour paiement anticipé',
      expect.stringContaining('indemnité forfaitaire de 40 €'),
      'IBAN : FR76 3000 1000 0000',
      'BIC : BDFEFRPP',
    ])
  })
  it('facture : paiement à réception, mention TVA si TVA nulle', () => {
    const m = legalMentions({ kind: 'invoice', seller, dueDate: '2026-11-20', issueDate: '2026-11-20', vatTotal: 0 })
    expect(m[0]).toBe('Paiement à réception')
    expect(m).toContain('TVA non applicable, art. 293 B du CGI')
  })
  it('pas de mention TVA si aucune n’est renseignée', () => {
    const m = legalMentions({ kind: 'invoice', seller: { ...seller, vat_mention: null }, dueDate: '2026-12-20', vatTotal: 0 })
    expect(m.some((l) => l.includes('293'))).toBe(false)
  })
  it('devis : validité et bon pour accord', () => {
    expect(legalMentions({ kind: 'quote', seller, validUntil: '2026-12-20', vatTotal: 100 })).toEqual([
      'Devis valable jusqu’au 20/12/2026',
      'Bon pour accord (date et signature)',
    ])
  })
})

describe('invoicesCsv', () => {
  const base: Invoice = {
    id: 'i1',
    organization_id: 'o',
    client_id: 'c1',
    project_id: null,
    quote_id: null,
    issuer_id: null,
    kind: 'invoice',
    status: 'paid',
    number: 'F-2026-0001',
    title: 'x',
    issue_date: '2026-11-20',
    due_date: '2026-12-20',
    lines: [],
    notes: null,
    deposit_percent: null,
    credited_invoice_id: null,
    seller: null,
    buyer: null,
    total_ht_cents: 123450,
    total_vat_cents: 24690,
    total_ttc_cents: 148140,
    issued_at: null,
    paid_at: '2026-12-01T10:00:00Z',
    cancelled_at: null,
    created_by: null,
    created_at: '',
    updated_at: '',
  }
  const clients = { c1: { name: 'Ibé; "le" client', siret: '73282932000074' } }
  it('produit BOM, en-tête, lignes échappées et ignore les brouillons', () => {
    const csv = invoicesCsv([base, { ...base, id: 'i2', status: 'draft', number: null }], clients)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const rows = csv.slice(1).trimEnd().split('\r\n')
    expect(rows[0]).toBe('Numéro;Type;Date;Échéance;Client;SIRET client;HT;TVA;TTC;Statut;Payée le')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toBe(
      'F-2026-0001;Facture;20/11/2026;20/12/2026;"Ibé; ""le"" client";73282932000074;1234,50;246,90;1481,40;Payée;01/12/2026',
    )
  })
  it('exporte un avoir avec des montants négatifs et neutralise les formules', () => {
    const csv = invoicesCsv(
      [{ ...base, kind: 'credit_note', status: 'issued', paid_at: null, total_ht_cents: -1000, total_vat_cents: -200, total_ttc_cents: -1200 }],
      { c1: { name: '=HYPERLINK("x")', siret: null } },
    )
    const row = csv.trimEnd().split('\r\n')[1] ?? ''
    expect(row).toContain(';-10,00;-2,00;-12,00;Émise;')
    expect(row).toContain(`"'=HYPERLINK(""x"")"`)
  })
})

describe('sellerFromIssuer', () => {
  const issuer: BillingIssuer = {
    id: 'e1', organization_id: 'o', member_id: null, display_name: 'Sacha Moricet', legal_name: 'Sacha Moricet EI',
    legal_form: 'Micro-entreprise / EI', siret: '73282932000074', address_street: '1 rue A', address_postal_code: '75001',
    address_city: 'Paris', address_country: 'France', vat_mention: 'TVA non applicable, art. 293 B du CGI', vat_number: null,
    bank_iban: 'FR7630006000011234567890189', bank_bic: 'BNPAFRPP', email: 'sacha@example.fr', phone: '0102030405',
    is_default: true, archived_at: null, created_at: '', updated_at: '',
  }
  it('reprend les champs de l’émetteur, nom affiché compris', () => {
    expect(sellerFromIssuer(issuer)).toEqual({
      name: 'Sacha Moricet', legal_name: 'Sacha Moricet EI', legal_form: 'Micro-entreprise / EI', siret: '73282932000074',
      address_street: '1 rue A', address_postal_code: '75001', address_city: 'Paris', address_country: 'France',
      vat_mention: 'TVA non applicable, art. 293 B du CGI', bank_iban: 'FR7630006000011234567890189', bank_bic: 'BNPAFRPP',
      vat_number: null, email: 'sacha@example.fr', phone: '0102030405',
    })
  })
  it('garde le n° de TVA saisi', () => {
    expect(sellerFromIssuer({ ...issuer, vat_number: 'FR12345678901' }).vat_number).toBe('FR12345678901')
  })
})
