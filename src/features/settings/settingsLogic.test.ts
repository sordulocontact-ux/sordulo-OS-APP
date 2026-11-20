import { describe, expect, it } from 'vitest'
import type { Organization } from '../../shared/types'
import { bicError, buildPatch, formatIban, ibanError, isZeroVat, toForm } from './settingsLogic'

const org: Organization = {
  id: 'o', name: 'Sordulo', legal_name: null, legal_form: null, siret: null, address_street: null,
  address_postal_code: null, address_city: null, address_country: null, vat_mention: null,
  default_daily_rate: null, default_hourly_rate: null, default_vat_rate: 20, payment_terms_days: 30,
  quote_validity_days: 30, bank_iban: null, bank_bic: null, created_at: '', updated_at: '',
}

describe('buildPatch', () => {
  it('ne renvoie rien quand rien ne change', () => {
    expect(buildPatch(toForm(org), org)).toEqual({ patch: {} })
  })
  it('ne garde que les champs modifiés, valeurs trimées', () => {
    const form = { ...toForm(org), name: '  Sordulo SAS ', dailyRate: '450,5', siret: '732 829 320 00074' }
    expect(buildPatch(form, org)).toEqual({ patch: { name: 'Sordulo SAS', default_daily_rate: 450.5, siret: '73282932000074' } })
  })
  it('vide un champ en null', () => {
    const filled = { ...org, legal_name: 'Sordulo SAS' }
    expect(buildPatch({ ...toForm(filled), legalName: '  ' }, filled)).toEqual({ patch: { legal_name: null } })
  })
  it('refuse nom vide, SIRET faux et taux négatif', () => {
    const result = buildPatch({ ...toForm(org), name: ' ', siret: '123', hourlyRate: '-2' }, org)
    expect(result).toHaveProperty('errors.name')
    expect(result).toHaveProperty('errors.siret')
    expect(result).toHaveProperty('errors.hourlyRate')
  })
})

describe('facturation', () => {
  it('affiche la TVA avec une virgule et l’IBAN groupé par 4', () => {
    const form = toForm({ ...org, default_vat_rate: 5.5, bank_iban: 'FR7630006000011234567890189' })
    expect(form.vatRate).toBe('5,5')
    expect(form.iban).toBe('FR76 3000 6000 0112 3456 7890 189')
  })
  it('enregistre TVA, délais, IBAN et BIC normalisés', () => {
    const form = { ...toForm(org), vatRate: '0', paymentTermsDays: '0', quoteValidityDays: '90', iban: 'fr76 3000 6000 0112 3456 7890 189', bic: ' bnpafrpp ' }
    expect(buildPatch(form, org)).toEqual({
      patch: { default_vat_rate: 0, payment_terms_days: 0, quote_validity_days: 90, bank_iban: 'FR7630006000011234567890189', bank_bic: 'BNPAFRPP' },
    })
  })
  it('accepte la virgule pour la TVA', () => {
    expect(buildPatch({ ...toForm(org), vatRate: '5,5' }, org)).toEqual({ patch: { default_vat_rate: 5.5 } })
  })
  it('refuse TVA, délais, IBAN et BIC hors limites', () => {
    const result = buildPatch({ ...toForm(org), vatRate: '101', paymentTermsDays: '61', quoteValidityDays: '0', iban: 'FR7630006000011234567890188', bic: 'ABC' }, org)
    for (const key of ['vatRate', 'paymentTermsDays', 'quoteValidityDays', 'iban', 'bic']) expect(result).toHaveProperty(`errors.${key}`)
  })
  it('refuse un délai décimal ou une TVA vide', () => {
    const result = buildPatch({ ...toForm(org), vatRate: '', paymentTermsDays: '1,5' }, org)
    expect(result).toHaveProperty('errors.vatRate')
    expect(result).toHaveProperty('errors.paymentTermsDays')
  })
  it('vide IBAN et BIC en null', () => {
    const filled = { ...org, bank_iban: 'FR7630006000011234567890189', bank_bic: 'BNPAFRPP' }
    expect(buildPatch({ ...toForm(filled), iban: '', bic: '' }, filled)).toEqual({ patch: { bank_iban: null, bank_bic: null } })
  })
})

describe('IBAN et BIC', () => {
  it('valide la clé modulo 97', () => {
    expect(ibanError('FR76 3000 6000 0112 3456 7890 189')).toBeNull()
    expect(ibanError('GB82 WEST 1234 5698 7654 32')).toBeNull()
    expect(ibanError('FR7630006000011234567890188')).toMatch(/pas valide/)
    expect(ibanError('12345')).toMatch(/commencer/)
    expect(ibanError('')).toBeNull()
  })
  it('groupe par 4', () => expect(formatIban('gb82west12345698765432')).toBe('GB82 WEST 1234 5698 7654 32'))
  it('valide le BIC sur 8 ou 11 caractères', () => {
    expect(bicError('BNPAFRPP')).toBeNull()
    expect(bicError('BNPAFRPPXXX')).toBeNull()
    expect(bicError('BNPAFRP')).not.toBeNull()
  })
  it('repère une TVA à zéro', () => {
    expect(isZeroVat('0')).toBe(true)
    expect(isZeroVat('20')).toBe(false)
    expect(isZeroVat('')).toBe(false)
  })
})
