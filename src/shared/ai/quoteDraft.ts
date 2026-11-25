/** Action IA « quoteDraft » : brief → brouillon de devis à partir du catalogue (POST /api/ai/run, action quoteDraft). */
import { z } from 'zod'
import { LINE_UNITS, type DocumentLine, type Service } from '../types.js'

export interface QuoteDraftRequest {
  briefId: string
}

export interface QuoteDraftResponse {
  quoteId: string
}

/** Choix de Claude : une prestation du catalogue (service_id) ou une ligne libre (service_id null). */
export const QuoteDraftOutputSchema = z.object({
  lines: z.array(
    z.object({
      service_id: z.string().nullable(),
      /** Ligne libre seulement : libellé. Ignoré pour une prestation du catalogue. */
      label: z.string(),
      quantity: z.number(),
      /** Ligne libre seulement : unité (jour ou heure fixent le prix par les taux de l'organisation). */
      unit: z.enum(LINE_UNITS),
      /** Pourquoi cette ligne, au regard du brief. */
      justification: z.string(),
    }),
  ),
})
export type QuoteDraftOutput = z.infer<typeof QuoteDraftOutputSchema>

export interface RateDefaults {
  /** Euros HT. */
  default_daily_rate: number | null
  default_hourly_rate: number | null
  default_vat_rate: number
}

const roundQty = (n: number): number => Math.round(n * 100) / 100
const validQty = (n: number): number => (Number.isFinite(n) && n > 0 ? roundQty(n) || 0.01 : 1)

/**
 * Construit les lignes du devis. Le prix vient toujours du catalogue (lignes types de la prestation, sinon son
 * prix unitaire) : jamais un prix inventé. Un service_id inconnu ou inactif est ignoré. Une ligne libre est chiffrée
 * au taux jour / horaire de l'organisation, à 0 sans taux (à compléter à la main).
 */
export function buildQuoteLines(output: QuoteDraftOutput, services: readonly Service[], rates: RateDefaults): DocumentLine[] {
  const byId = new Map(services.filter((s) => s.active).map((s) => [s.id, s]))
  const lines: DocumentLine[] = []
  for (const choice of output.lines) {
    const quantity = validQty(choice.quantity)
    if (choice.service_id !== null) {
      const service = byId.get(choice.service_id)
      if (!service) continue
      if (service.lines.length > 0) {
        for (const line of service.lines) {
          lines.push({ ...line, quantity: roundQty(line.quantity * quantity) || 0.01, service_id: service.id })
        }
      } else {
        lines.push({
          label: service.name,
          description: service.description,
          quantity,
          unit: service.unit,
          unit_price_cents: service.unit_price_cents,
          vat_rate: service.vat_rate,
          service_id: service.id,
        })
      }
      continue
    }
    const label = choice.label.replace(/\s+/g, ' ').trim()
    if (label === '') continue
    const rate = choice.unit === 'day' ? rates.default_daily_rate : choice.unit === 'hour' ? rates.default_hourly_rate : null
    const justification = choice.justification.trim()
    lines.push({
      label,
      description: justification === '' ? null : justification,
      quantity,
      unit: choice.unit,
      unit_price_cents: rate === null ? 0 : Math.round(rate * 100),
      vat_rate: rates.default_vat_rate,
    })
  }
  return lines
}
