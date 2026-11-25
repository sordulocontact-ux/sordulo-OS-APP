import { describe, expect, it } from 'vitest'
import {
  commissionBaseCents,
  cumulativeCommissions,
  followupCommissionCents,
  marginalCommissionCents,
  tieredAmountCents,
  validateTiers,
} from './commission.js'
import type { CommissionTier, DocumentLine } from './types.js'

// Barème d'exemple (forme du contrat d'apporteur) : 12 % jusqu'à 3 000 €, 10 % jusqu'à 10 000 €, 8 % au-delà.
const TIERS: CommissionTier[] = [
  { up_to_cents: 300_000, rate: 12 },
  { up_to_cents: 1_000_000, rate: 10 },
  { up_to_cents: null, rate: 8 },
]

const line = (quantity: number, unit_price_cents: number, rebilled?: boolean): DocumentLine => ({
  label: 'Ligne',
  description: null,
  quantity,
  unit: 'flat',
  unit_price_cents,
  vat_rate: 20,
  ...(rebilled === undefined ? {} : { rebilled }),
})

describe('tieredAmountCents', () => {
  it('applique chaque taux à sa tranche : 8 000 € → 860 €', () => {
    expect(tieredAmountCents(TIERS, 800_000)).toBe(86_000)
  })

  it('tranche par tranche, bornes comprises', () => {
    expect(tieredAmountCents(TIERS, 0)).toBe(0)
    expect(tieredAmountCents(TIERS, -50_000)).toBe(0)
    expect(tieredAmountCents(TIERS, 300_000)).toBe(36_000)
    expect(tieredAmountCents(TIERS, 1_000_000)).toBe(106_000)
    expect(tieredAmountCents(TIERS, 1_500_000)).toBe(146_000)
  })

  it('arrondit au centime, demis loin de zéro', () => {
    expect(tieredAmountCents([{ up_to_cents: null, rate: 12 }], 1_237)).toBe(148) // 148,44
    expect(tieredAmountCents([{ up_to_cents: null, rate: 10 }], 5)).toBe(1) // 0,5 → 1
  })
})

describe('marginalCommissionCents et cumulativeCommissions', () => {
  it('acompte puis solde : même total qu’un paiement unique', () => {
    const [deposit, balance] = cumulativeCommissions(TIERS, [240_000, 560_000])
    expect(deposit).toBe(28_800) // 12 % de 2 400 €
    expect(balance).toBe(57_200) // 600 € à 12 % + 5 000 € à 10 %
    expect(deposit! + balance!).toBe(tieredAmountCents(TIERS, 800_000))
  })

  it('un avoir déduit au taux marginal du cumul', () => {
    const amounts = cumulativeCommissions(TIERS, [300_000, 500_000, -300_000])
    expect(amounts).toEqual([36_000, 50_000, -30_000])
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(tieredAmountCents(TIERS, 500_000))
    expect(marginalCommissionCents(TIERS, 800_000, -300_000)).toBe(-30_000)
  })
})

describe('followupCommissionCents', () => {
  it('taux fixe sur la base, négatif pour un avoir', () => {
    expect(followupCommissionCents(5, 400_000)).toBe(20_000)
    expect(followupCommissionCents(5, -400_000)).toBe(-20_000)
    expect(followupCommissionCents(5, 10)).toBe(1) // 0,5 → 1
    expect(followupCommissionCents(5, -10)).toBe(-1)
  })
})

describe('commissionBaseCents', () => {
  it('HT des lignes sans les frais refacturés', () => {
    expect(commissionBaseCents([line(2.5, 45_000), line(1, 20_000, true), line(1, 10_000, false)])).toBe(122_500)
  })

  it('lignes négatives d’un solde ou d’un avoir', () => {
    expect(commissionBaseCents([line(1, 800_000), line(1, -240_000)])).toBe(560_000)
    expect(commissionBaseCents([line(1, -800_000), line(1, -5_000, true)])).toBe(-800_000)
  })
})

describe('validateTiers', () => {
  it('accepte le barème d’exemple', () => {
    expect(validateTiers(TIERS)).toBeNull()
    expect(validateTiers([{ up_to_cents: null, rate: 10 }])).toBeNull()
  })

  it('refuse un barème incohérent', () => {
    expect(validateTiers([])).toMatch(/au moins une tranche/)
    expect(validateTiers([{ up_to_cents: 100, rate: 10 }])).toMatch(/dernière tranche/)
    expect(validateTiers([{ up_to_cents: null, rate: 10 }, { up_to_cents: null, rate: 5 }])).toMatch(/seule la dernière/)
    expect(validateTiers([{ up_to_cents: 500, rate: 10 }, { up_to_cents: 400, rate: 5 }, { up_to_cents: null, rate: 1 }])).toMatch(
      /supérieur/,
    )
    expect(validateTiers([{ up_to_cents: 0, rate: 10 }, { up_to_cents: null, rate: 5 }])).toMatch(/supérieur/)
    expect(validateTiers([{ up_to_cents: null, rate: 120 }])).toMatch(/entre 0 et 100/)
  })
})
