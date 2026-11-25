import { describe, expect, it } from 'vitest'
import {
  THRESHOLDS_BY_YEAR,
  ratioPercent,
  thresholdLevel,
  thresholdStatuses,
  thresholdsFor,
  worstThreshold,
} from './thresholds.js'

describe('thresholdsFor', () => {
  it('donne l’année demandée', () => {
    expect(thresholdsFor(2025).year).toBe(2025)
    expect(thresholdsFor(2026).year).toBe(2026)
  })
  it('reprend la dernière année connue pour une année future', () => {
    expect(thresholdsFor(2031).year).toBe(2026)
  })
  it('reprend la première année pour une année trop ancienne', () => {
    expect(thresholdsFor(2010).year).toBe(2025)
  })
  it('garde des seuils cohérents : franchise < franchise majorée < plafond micro', () => {
    for (const t of THRESHOLDS_BY_YEAR) {
      expect(t.vatFranchiseCents).toBeLessThan(t.vatFranchiseRaisedCents)
      expect(t.vatFranchiseRaisedCents).toBeLessThan(t.microServicesCents)
    }
  })
})

describe('thresholdLevel', () => {
  it('alerte à 80 % et au dépassement', () => {
    expect(thresholdLevel(7_999, 10_000)).toBe('ok')
    expect(thresholdLevel(8_000, 10_000)).toBe('warning')
    expect(thresholdLevel(9_999, 10_000)).toBe('warning')
    expect(thresholdLevel(10_000, 10_000)).toBe('exceeded')
    expect(thresholdLevel(15_000, 10_000)).toBe('exceeded')
  })
  it('ne plante pas sur un plafond nul', () => {
    expect(thresholdLevel(100, 0)).toBe('ok')
  })
})

describe('thresholdStatuses / worstThreshold', () => {
  const t = thresholdsFor(2026)
  it('ne remonte rien sous 80 % du plus petit seuil', () => {
    const statuses = thresholdStatuses(t.vatFranchiseCents * 0.5, t)
    expect(statuses.map((s) => s.level)).toEqual(['ok', 'ok', 'ok'])
    expect(worstThreshold(statuses)).toBeNull()
  })
  it('remonte la franchise de TVA dépassée avant le plafond micro encore loin', () => {
    const statuses = thresholdStatuses(t.vatFranchiseCents + 100, t)
    expect(statuses[0]?.level).toBe('ok')
    expect(statuses[1]?.level).toBe('exceeded')
    expect(statuses[2]?.level).toBe('warning')
    expect(worstThreshold(statuses)?.kind).toBe('vat')
  })
  it('calcule le reste et le pourcentage', () => {
    const [micro] = thresholdStatuses(t.microServicesCents / 2, t)
    expect(micro?.remainingCents).toBe(t.microServicesCents / 2)
    expect(ratioPercent(micro?.ratio ?? 0)).toBe(50)
    const [over] = thresholdStatuses(t.microServicesCents * 2, t)
    expect(over?.remainingCents).toBe(0)
  })
})
