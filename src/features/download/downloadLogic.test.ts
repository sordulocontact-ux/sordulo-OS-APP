import { describe, expect, it } from 'vitest'
import { detectPlatform, otherPlatform } from './downloadLogic'

describe('detectPlatform', () => {
  it('préfère userAgentData.platform', () => {
    expect(
      detectPlatform({
        userAgentData: { platform: 'macOS' },
        userAgent: 'Windows NT 10.0',
      }),
    ).toBe('mac')
    expect(
      detectPlatform({
        userAgentData: { platform: 'Windows' },
        userAgent: 'Macintosh',
      }),
    ).toBe('windows')
  })
  it('retombe sur userAgent', () => {
    expect(
      detectPlatform({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      }),
    ).toBe('mac')
    expect(
      detectPlatform({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      }),
    ).toBe('windows')
  })
  it('renvoie null pour Linux, mobile ou rien', () => {
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBeNull()
    expect(
      detectPlatform({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      }),
    ).toBeNull()
    expect(detectPlatform({ userAgentData: { platform: 'Android' } })).toBeNull()
    expect(detectPlatform(undefined)).toBeNull()
    expect(detectPlatform({})).toBeNull()
  })
})

describe('otherPlatform', () => {
  it('inverse', () => {
    expect(otherPlatform('mac')).toBe('windows')
    expect(otherPlatform('windows')).toBe('mac')
  })
})
