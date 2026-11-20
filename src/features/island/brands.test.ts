/// <reference types="node" />
// Types Node limités à ce test : il lit tokens.css.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BRAND_ICON_PATHS } from './brandIcons'
import { CALL_SERVICES, CALL_TONE_VARIABLE, callBrand, callToneStyle } from './brands'

const tokens = readFileSync(fileURLToPath(new URL('../../styles/tokens.css', import.meta.url)), 'utf8')
const defined = new Set(Array.from(tokens.matchAll(/(--[a-z0-9-]+)\s*:/g), (m: RegExpExecArray) => m[1]))

describe('callBrand', () => {
  it('falls back to the generic call icon and the call color for an unknown service', () => {
    for (const unknown of [null, undefined]) {
      const brand = callBrand(unknown)
      expect(brand).toMatchObject({ service: null, iconPath: null, token: '--island-call' })
    }
    expect(callToneStyle(null)).toEqual({ [CALL_TONE_VARIABLE]: 'var(--island-call)' })
  })

  it('maps every service to a label, a defined color token and a logo or the generic icon', () => {
    expect(CALL_SERVICES).toHaveLength(13)
    for (const service of CALL_SERVICES) {
      const brand = callBrand(service)
      expect(brand.service).toBe(service)
      expect(brand.label.length).toBeGreaterThan(0)
      expect(brand.token).toBe(`--island-brand-${service}`)
      expect(defined.has(brand.token)).toBe(true)
      expect(brand.iconPath).toBe(BRAND_ICON_PATHS[service] ?? null)
    }
  })

  it('names the services like the Rust detector', () => {
    expect(callBrand('discord').label).toBe('Discord')
    expect(callBrand('meet').label).toBe('Google Meet')
    expect(callBrand('teams').label).toBe('Microsoft Teams')
    expect(callBrand('whatsapp').label).toBe('WhatsApp')
  })

  it('keeps the generic icon for brands without a logo, with their own color', () => {
    for (const service of ['teams', 'slack', 'skype', 'facetime', 'whereby'] as const) {
      expect(callBrand(service).iconPath).toBeNull()
    }
    expect(callBrand('discord').iconPath).toMatch(/^M/)
    expect(callToneStyle('slack')).toEqual({ [CALL_TONE_VARIABLE]: 'var(--island-brand-slack)' })
  })

  it('has a default call tone token', () => {
    expect(defined.has(CALL_TONE_VARIABLE)).toBe(true)
  })
})
