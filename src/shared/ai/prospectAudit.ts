/**
 * Action IA « prospectAudit » : pré-audit du site d'un prospect (mobile, vitesse, référencement, design daté).
 * Requête, réponse et schéma de la sortie structurée de Claude (contraintes compatibles avec l'API :
 * types, enums, nullable ; les bornes sont appliquées par le code après coup).
 */
import { z } from 'zod'
import type { ProspectAudit } from '../types.js'

export const ProspectAuditRequestSchema = z.object({ prospectId: z.uuid() })
export type ProspectAuditRequest = z.infer<typeof ProspectAuditRequestSchema>

export const AUDIT_SEVERITIES = ['low', 'medium', 'high'] as const
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number]

/** Ce que Claude renvoie : scores 0 à 100, points, résumé, piste d'offre. */
export const ProspectAuditAnalysisSchema = z.object({
  mobile_score: z.number(),
  speed_score: z.number(),
  seo_score: z.number(),
  design_score: z.number(),
  dated_design: z.boolean(),
  points: z.array(
    z.object({
      label: z.string(),
      severity: z.enum(AUDIT_SEVERITIES),
      /** Une phrase de précision, vide si le libellé suffit. */
      detail: z.string(),
    }),
  ),
  summary: z.string(),
  /** Piste d'offre : le type de prestation qui répondrait le mieux, en une ou deux phrases. */
  offer_hint: z.string(),
})
export type ProspectAuditAnalysis = z.infer<typeof ProspectAuditAnalysisSchema>

/** Mesures brutes gardées avec l'audit (utiles pour relire ou relancer). */
export interface ProspectAuditRaw {
  final_url: string | null
  http_status: number | null
  redirects: number
  page_bytes: number | null
  /** Pourquoi la page n'a pas pu être lue, null sinon. */
  fetch_error: string | null
  findings: Record<string, unknown> | null
  pagespeed: Record<string, unknown> | null
}

/** Ce qui est écrit dans prospects.audit : le type partagé, plus la piste d'offre et les mesures brutes. */
export interface ProspectAuditData extends ProspectAudit {
  offer_hint: string | null
  raw?: ProspectAuditRaw
}

export interface ProspectAuditResponse {
  audit: ProspectAuditData
}

/** Score « mobile » et « design » : rangés dans ProspectAudit.scores sous ces clés. */
export const AUDIT_SCORE_KEYS = {
  mobile: 'mobile',
  design: 'design',
  accessibility: 'accessibility',
  bestPractices: 'best_practices',
} as const

/** Lit la piste d'offre d'un audit stocké (jsonb : forme non garantie). */
export function auditOfferHint(audit: ProspectAudit | null): string | null {
  const value = (audit as { offer_hint?: unknown } | null)?.offer_hint
  return typeof value === 'string' && value.trim() !== '' ? value : null
}
