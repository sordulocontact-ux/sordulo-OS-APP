import { describe, expect, it } from 'vitest'
import { EMPTY_BRIEF, isBriefEmpty, normalizeBrief } from './brief.js'
import { buildQuoteLines } from './quoteDraft.js'
import type { Service } from '../types.js'

const rates = { default_daily_rate: 500, default_hourly_rate: null, default_vat_rate: 20 }
const service = (over: Partial<Service>): Service =>
  ({ id: 's1', name: 'Site', description: null, unit: 'flat', unit_price_cents: 1000, vat_rate: 10, lines: [], active: true, ...over }) as Service

describe('normalizeBrief', () => {
  it('rogne, retire les lignes vides et met null les champs vides', () => {
    const b = normalizeBrief({ contexte: ' x ', objectifs: [' a ', ' '], budget: '  ', delais: ' 2 mois ' })
    expect(b).toMatchObject({ contexte: 'x', objectifs: ['a'], livrables: [], budget: null, delais: '2 mois' })
  })
  it('détecte un brief vide', () => {
    expect(isBriefEmpty(EMPTY_BRIEF)).toBe(true)
    expect(isBriefEmpty({ ...EMPTY_BRIEF, budget: '5 k€' })).toBe(false)
  })
})

describe('buildQuoteLines', () => {
  it('corrige une quantité invalide et chiffre une ligne libre sans taux à 0', () => {
    const lines = buildQuoteLines(
      { lines: [
        { service_id: 's1', label: '', quantity: -2, unit: 'flat', justification: '' },
        { service_id: null, label: 'Forfait libre', quantity: 1, unit: 'flat', justification: '' },
        { service_id: null, label: '  ', quantity: 1, unit: 'day', justification: '' },
      ] },
      [service({})],
      rates,
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ quantity: 1, unit_price_cents: 1000, vat_rate: 10, service_id: 's1' })
    expect(lines[1]).toMatchObject({ unit_price_cents: 0, vat_rate: 20 })
  })
})
