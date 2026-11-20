import { describe, expect, it } from 'vitest'
import { formatIban, formatSiret, frenchVatNumber, sellerDisplayName } from './vat.js'

describe('frenchVatNumber', () => {
  it('calcule la clé depuis un SIREN connu', () => {
    expect(frenchVatNumber('404833048')).toBe('FR83404833048')
  })
  it('accepte un SIRET valide, groupé ou non', () => {
    expect(frenchVatNumber('73282932000074')).toBe('FR' + String((12 + 3 * (732829320 % 97)) % 97).padStart(2, '0') + '732829320')
    expect(frenchVatNumber('732 829 320 00074')).toBe(frenchVatNumber('73282932000074'))
  })
  it('renvoie null pour un identifiant invalide ou vide', () => {
    expect(frenchVatNumber('404833049')).toBeNull()
    expect(frenchVatNumber('73282932000075')).toBeNull()
    expect(frenchVatNumber('123')).toBeNull()
    expect(frenchVatNumber('')).toBeNull()
    expect(frenchVatNumber(null)).toBeNull()
  })
})

describe('formatSiret et formatIban', () => {
  it('groupe le SIRET', () => {
    expect(formatSiret('73282932000074')).toBe('732 829 320 00074')
    expect(formatSiret('732 829 320 00074')).toBe('732 829 320 00074')
    expect(formatSiret('abc')).toBe('abc')
  })
  it('groupe l’IBAN par 4', () => {
    expect(formatIban('fr76 3000-6000 0112 3456 7890 189')).toBe('FR76 3000 6000 0112 3456 7890 189')
  })
})

describe('sellerDisplayName', () => {
  it('n’ajoute pas une forme déjà présente', () => {
    expect(sellerDisplayName({ name: 'Sordulo', legal_name: 'Sordulo SAS', legal_form: 'SAS' })).toBe('Sordulo SAS')
    expect(sellerDisplayName({ name: 'x', legal_name: 'Sordulo sas', legal_form: 'SAS' })).toBe('Sordulo sas')
  })
  it('ajoute la forme sinon, après une virgule', () => {
    expect(sellerDisplayName({ name: 'x', legal_name: 'Sordulo', legal_form: 'SAS' })).toBe('Sordulo, SAS')
    expect(sellerDisplayName({ name: 'x', legal_name: 'Sassy', legal_form: 'SAS' })).toBe('Sassy, SAS')
  })
  it('retombe sur le nom si la raison sociale est vide', () => {
    expect(sellerDisplayName({ name: 'Sordulo', legal_name: '', legal_form: null })).toBe('Sordulo')
    expect(sellerDisplayName({ name: 'Sordulo', legal_name: null, legal_form: 'SAS' })).toBe('Sordulo, SAS')
  })
})
