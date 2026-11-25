/**
 * PageSpeed Insights (API publique de Google, sans clé) en mobile. Un échec (quota, délai, site inaccessible
 * pour Google) est toléré : la fonction renvoie null et l'audit se rabat sur l'analyse du HTML.
 */
import { z } from 'zod'

export const PAGESPEED_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
export const PAGESPEED_TIMEOUT_MS = 45_000

export interface PageSpeedResult {
  /** Scores Lighthouse de 0 à 100, null si la catégorie manque. */
  performance: number | null
  seo: number | null
  accessibility: number | null
  bestPractices: number | null
  fcpMs: number | null
  lcpMs: number | null
  speedIndexMs: number | null
  tbtMs: number | null
  cls: number | null
  /** Audit « viewport » de Lighthouse : true = réussi, false = échoué, null = inconnu. */
  viewportOk: boolean | null
}

const ResponseSchema = z.object({
  lighthouseResult: z.object({
    categories: z.record(z.string(), z.object({ score: z.number().nullable().optional() }).loose()),
    audits: z.record(
      z.string(),
      z
        .object({
          numericValue: z.number().nullish(),
          score: z.number().nullish(),
        })
        .loose(),
    ),
  }),
})

const percent = (score: number | null | undefined): number | null =>
  typeof score === 'number' && Number.isFinite(score) ? Math.round(Math.min(1, Math.max(0, score)) * 100) : null

/** Extrait les mesures utiles de la réponse brute de l'API ; null si elle n'a pas la forme attendue. */
export function parsePageSpeed(raw: unknown): PageSpeedResult | null {
  const parsed = ResponseSchema.safeParse(raw)
  if (!parsed.success) return null
  const { categories, audits } = parsed.data.lighthouseResult
  const number = (id: string): number | null => {
    const value = audits[id]?.numericValue
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  const viewport = audits['viewport']?.score
  const result: PageSpeedResult = {
    performance: percent(categories['performance']?.score),
    seo: percent(categories['seo']?.score),
    accessibility: percent(categories['accessibility']?.score),
    bestPractices: percent(categories['best-practices']?.score),
    fcpMs: number('first-contentful-paint'),
    lcpMs: number('largest-contentful-paint'),
    speedIndexMs: number('speed-index'),
    tbtMs: number('total-blocking-time'),
    cls: number('cumulative-layout-shift'),
    viewportOk: typeof viewport === 'number' ? viewport >= 1 : null,
  }
  return result.performance === null && result.seo === null ? null : result
}

export interface PageSpeedOptions {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export async function fetchPageSpeed(url: string, options: PageSpeedOptions = {}): Promise<PageSpeedResult | null> {
  const doFetch = options.fetchImpl ?? fetch
  const params = new URLSearchParams({ url, strategy: 'mobile' })
  for (const category of ['performance', 'seo', 'accessibility', 'best-practices']) params.append('category', category)
  try {
    const response = await doFetch(`${PAGESPEED_ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? PAGESPEED_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      console.error(`[pagespeed] réponse ${response.status}`)
      return null
    }
    return parsePageSpeed(await response.json())
  } catch (error) {
    console.error('[pagespeed] échec toléré', error instanceof Error ? error.message : error)
    return null
  }
}
