import { describe, expect, it } from 'vitest'
import { compareVersions } from './desktop-version.js'

describe('compareVersions', () => {
  it('compare les trois nombres dans l’ordre', () => {
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
    expect(compareVersions('0.2.1', '0.2.1')).toBe(0)
  })
  it('ignore le préfixe v, les suffixes et les nombres manquants', () => {
    expect(compareVersions('v0.3.0', '0.3')).toBe(0)
    expect(compareVersions('0.3.0-beta.1', '0.3.0')).toBe(0)
  })
})
