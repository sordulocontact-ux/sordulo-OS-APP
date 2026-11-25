import { describe, expect, it, vi } from 'vitest'
import { fetchPageSpeed, PAGESPEED_ENDPOINT, parsePageSpeed } from './pagespeed.js'

const RAW = {
  lighthouseResult: {
    categories: {
      performance: { score: 0.42 },
      seo: { score: 0.91 },
      accessibility: { score: 0.77 },
      'best-practices': { score: 1 },
    },
    audits: {
      'first-contentful-paint': { numericValue: 1800.4, score: 0.7 },
      'largest-contentful-paint': { numericValue: 4200.6, score: 0.2 },
      'speed-index': { numericValue: 3900 },
      'total-blocking-time': { numericValue: 350 },
      'cumulative-layout-shift': { numericValue: 0.12 },
      viewport: { score: 1 },
    },
  },
}

describe('parsePageSpeed', () => {
  it('extrait les scores en pourcentage et les temps', () => {
    expect(parsePageSpeed(RAW)).toEqual({
      performance: 42,
      seo: 91,
      accessibility: 77,
      bestPractices: 100,
      fcpMs: 1800.4,
      lcpMs: 4200.6,
      speedIndexMs: 3900,
      tbtMs: 350,
      cls: 0.12,
      viewportOk: true,
    })
  })

  it('tolère les mesures manquantes et refuse une réponse sans score', () => {
    const partial = parsePageSpeed({
      lighthouseResult: {
        categories: { performance: { score: 0.5 } },
        audits: { viewport: { score: 0 } },
      },
    })
    expect(partial).toMatchObject({
      performance: 50,
      seo: null,
      lcpMs: null,
      viewportOk: false,
    })
    expect(parsePageSpeed({ lighthouseResult: { categories: {}, audits: {} } })).toBeNull()
    expect(parsePageSpeed({ error: { code: 429 } })).toBeNull()
    expect(parsePageSpeed(null)).toBeNull()
  })
})

describe('fetchPageSpeed', () => {
  it('interroge l’API en mobile sans clé', async () => {
    const fetchImpl = vi.fn(async (_url: string) => new Response(JSON.stringify(RAW), { status: 200 }))
    const result = await fetchPageSpeed('https://exemple.fr/', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result?.performance).toBe(42)
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]))
    expect(`${url.origin}${url.pathname}`).toBe(PAGESPEED_ENDPOINT)
    expect(url.searchParams.get('strategy')).toBe('mobile')
    expect(url.searchParams.get('url')).toBe('https://exemple.fr/')
    expect(url.searchParams.has('key')).toBe(false)
    expect(url.searchParams.getAll('category')).toContain('seo')
  })

  it('tolère un quota dépassé, une erreur réseau et un JSON invalide', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const quota = vi.fn(async () => new Response('{}', { status: 429 }))
    expect(
      await fetchPageSpeed('https://exemple.fr/', {
        fetchImpl: quota as unknown as typeof fetch,
      }),
    ).toBeNull()
    const down = vi.fn(async () => {
      throw new Error('réseau')
    })
    expect(
      await fetchPageSpeed('https://exemple.fr/', {
        fetchImpl: down as unknown as typeof fetch,
      }),
    ).toBeNull()
    const garbage = vi.fn(async () => new Response('pas du json', { status: 200 }))
    expect(
      await fetchPageSpeed('https://exemple.fr/', {
        fetchImpl: garbage as unknown as typeof fetch,
      }),
    ).toBeNull()
  })
})
