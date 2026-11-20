import { describe, expect, it } from 'vitest'
import { checkSiret, normalizeSiret, siretError } from './siret.js'

describe('siret', () => {
  it('accepte un SIRET valide (clé de Luhn)', () => {
    expect(checkSiret('73282932000074')).toBe('ok')
  })
  it('refuse une clé fausse', () => {
    expect(checkSiret('73282932000075')).toBe('checksum')
  })
  it('refuse un format incorrect', () => {
    expect(checkSiret('123')).toBe('format')
    expect(checkSiret('7328293200007a')).toBe('format')
  })
  it('gère l’exception La Poste', () => {
    expect(checkSiret('35600000000006')).toBe('ok')
    expect(checkSiret('35600000000007')).toBe('checksum')
  })
  it('normalise espaces et points', () => {
    expect(normalizeSiret('732 829 320 00074')).toBe('73282932000074')
    expect(siretError('732 829 320 00074')).toBeNull()
    expect(siretError('')).toBeNull()
    expect(siretError('12')).toMatch(/14 chiffres/)
  })
})
