import { describe, expect, it } from 'vitest'
import type { BillingIssuer } from '../../shared/types'
import {
  activeIssuers,
  buildIssuerValues,
  defaultIssuerId,
  EMPTY_ISSUER_FORM,
  issuerChoices,
  issuerErrorText,
  issuerName,
  issuerSubtitle,
  maskIban,
  showIssuerSelect,
  sortIssuers,
  toIssuerForm,
} from './issuerLogic'

function issuer(over: Partial<BillingIssuer> = {}): BillingIssuer {
  return {
    id: 'e1', organization_id: 'o', member_id: null, display_name: 'Sacha Moricet', legal_name: 'Sacha Moricet EI',
    legal_form: null, siret: '73282932000074', address_street: null, address_postal_code: null, address_city: null,
    address_country: null, vat_mention: null, vat_number: null, bank_iban: 'FR7630006000011234567890189', bank_bic: null,
    email: null, phone: null, is_default: false, archived_at: null, created_at: '', updated_at: '', ...over,
  }
}

describe('buildIssuerValues', () => {
  it('exige un nom affiché', () => {
    expect(buildIssuerValues(EMPTY_ISSUER_FORM)).toHaveProperty('errors.displayName')
  })
  it('refuse SIRET, IBAN, BIC et e-mail invalides', () => {
    const r = buildIssuerValues({ ...EMPTY_ISSUER_FORM, displayName: 'A', siret: '123', iban: 'FR00', bic: 'X', email: 'nope' })
    expect(r).toHaveProperty('errors.siret')
    expect(r).toHaveProperty('errors.iban')
    expect(r).toHaveProperty('errors.bic')
    expect(r).toHaveProperty('errors.email')
  })
  it('normalise les valeurs et met les champs vides à null', () => {
    const r = buildIssuerValues({
      ...EMPTY_ISSUER_FORM, displayName: ' Sacha ', siret: '732 829 320 00074', iban: 'fr76 3000 6000 0112 3456 7890 189',
      bic: 'bnpa frpp', memberId: 'm1', email: ' a@b.fr ',
    })
    expect(r).toEqual({
      values: {
        member_id: 'm1', display_name: 'Sacha', legal_name: null, legal_form: null, siret: '73282932000074',
        address_street: null, address_postal_code: null, address_city: null, address_country: null, vat_mention: null,
        vat_number: null, bank_iban: 'FR7630006000011234567890189', bank_bic: 'BNPAFRPP', email: 'a@b.fr', phone: null,
      },
    })
  })
  it('relit un émetteur dans le formulaire', () => {
    const form = toIssuerForm(issuer({ member_id: 'm1' }))
    expect(form.siret).toBe('732 829 320 00074')
    expect(form.iban).toBe('FR76 3000 6000 0112 3456 7890 189')
    expect(form.memberId).toBe('m1')
  })
})

describe('affichage', () => {
  it('masque l’IBAN sauf les 4 derniers caractères', () => {
    expect(maskIban('FR76 3000 6000 0112 3456 7890 189')).toBe('•••• 0189')
    expect(maskIban(null)).toBe('')
    expect(maskIban('AB12')).toBe('AB12')
  })
  it('résume raison sociale et SIRET', () => {
    expect(issuerSubtitle(issuer())).toBe('Sacha Moricet EI · SIRET 732 829 320 00074')
    expect(issuerSubtitle(issuer({ legal_name: null, siret: null }))).toBe('')
  })
})

describe('choix', () => {
  const list = [
    issuer({ id: 'b', display_name: 'Maël Auzenet' }),
    issuer({ id: 'old', display_name: 'Ancien', archived_at: '2026-01-01' }),
    issuer({ id: 'a', display_name: 'Sacha Moricet', is_default: true }),
  ]
  it('trie défaut, actifs, archivés', () => {
    expect(sortIssuers(list).map((i) => i.id)).toEqual(['a', 'b', 'old'])
  })
  it('ne propose que les actifs, défaut présélectionné', () => {
    expect(activeIssuers(list).map((i) => i.id)).toEqual(['a', 'b'])
    expect(defaultIssuerId(list)).toBe('a')
    expect(defaultIssuerId([])).toBe('')
    expect(defaultIssuerId([list[1] as BillingIssuer])).toBe('')
  })
  it('garde l’émetteur archivé du document dans la liste', () => {
    expect(issuerChoices(list, 'old').map((i) => i.id)).toEqual(['a', 'b', 'old'])
    expect(issuerChoices(list, 'a').map((i) => i.id)).toEqual(['a', 'b'])
  })
  it('masque le sélecteur sous deux choix', () => {
    expect(showIssuerSelect([1])).toBe(false)
    expect(showIssuerSelect([1, 2])).toBe(true)
  })
  it('retrouve le nom par id', () => {
    expect(issuerName(list, 'b')).toBe('Maël Auzenet')
    expect(issuerName(list, 'zz')).toBeNull()
    expect(issuerName(list, null)).toBeNull()
  })
})

describe('issuerErrorText', () => {
  it('traduit un refus de la RLS', () => {
    expect(issuerErrorText({ code: '42501', message: 'x' })).toMatch(/admins/)
    expect(issuerErrorText(new Error('boom'))).toMatch(/Impossible/)
  })
})
