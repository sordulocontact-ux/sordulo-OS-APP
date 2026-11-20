import { describe, expect, it } from 'vitest'
import type { Organization } from '../../shared/types'
import { buildPatch, toForm } from './settingsLogic'

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
