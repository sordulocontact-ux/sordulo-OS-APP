/**
 * Seuils légaux de la micro-entreprise (activité de prestations de services) et de la franchise en base
 * de TVA. Module pur, partagé front / API.
 *
 * VALEURS À VÉRIFIER sur service-public.fr / impots.gouv.fr CHAQUE 1ER JANVIER (les plafonds sont
 * revalorisés tous les trois ans, la franchise de TVA a été remaniée par les lois de finances de
 * 2024 et 2025). Une constante par année civile ; une année absente reprend la dernière connue
 * avant elle (`thresholdsFor`). Montants en centimes, HT (en franchise de TVA, HT = TTC).
 *
 * Sources :
 *  - plafond de chiffre d'affaires micro-entreprise (prestations de services BIC / BNC) :
 *    service-public.fr, fiche « Micro-entrepreneur : plafonds de chiffre d'affaires » ;
 *  - franchise en base de TVA (prestations de services) et seuil majoré : impots.gouv.fr,
 *    « Franchise en base de TVA » et BOFiP TVA-DECLA-40.
 */

export interface YearThresholds {
  year: number
  /** Plafond annuel de CA micro-entreprise, prestations de services. */
  microServicesCents: number
  /** Seuil de la franchise en base de TVA, prestations de services. */
  vatFranchiseCents: number
  /** Seuil majoré de la franchise de TVA : au-delà, la TVA est due dès le dépassement. */
  vatFranchiseRaisedCents: number
  /** Vrai quand la valeur a été confirmée sur la source officielle (sinon : à vérifier avant de s'y fier). */
  verified: boolean
}

const euros = (value: number): number => Math.round(value * 100)

/** Une ligne par année civile, de la plus ancienne à la plus récente. */
export const THRESHOLDS_BY_YEAR: readonly YearThresholds[] = [
  {
    year: 2025,
    microServicesCents: euros(77_700),
    vatFranchiseCents: euros(37_500),
    vatFranchiseRaisedCents: euros(41_250),
    verified: true,
  },
  {
    // 2026 : franchise de TVA des prestations de services 37 500 € / seuil majoré 41 250 € (impots.gouv.fr,
    // page « En tant que micro-entrepreneur, puis-je être redevable de la TVA ? », mise à jour le 21/05/2026).
    // Plafond micro des prestations de services revalorisé à 83 600 € pour 2026-2028 (legifiscal.fr ; certaines
    // pages citent encore 77 700 €) : vérifié le 25/11/2026 sur sources secondaires, à recouper sur service-public.fr.
    year: 2026,
    microServicesCents: euros(83_600),
    vatFranchiseCents: euros(37_500),
    vatFranchiseRaisedCents: euros(41_250),
    verified: true,
  },
]

/** Seuils de l'année donnée, ou de la dernière année connue avant elle (la première si aucune). */
export function thresholdsFor(year: number, table: readonly YearThresholds[] = THRESHOLDS_BY_YEAR): YearThresholds {
  const known = [...table].sort((a, b) => a.year - b.year)
  const first = known[0]
  if (!first) throw new Error('Aucun seuil défini.')
  let found = first
  for (const row of known) if (row.year <= year) found = row
  return found
}

/** Part du plafond à partir de laquelle on alerte (80 %). */
export const WARNING_RATIO = 0.8

export type ThresholdKind = 'micro' | 'vat' | 'vatRaised'
export type ThresholdLevel = 'ok' | 'warning' | 'exceeded'

export interface ThresholdStatus {
  kind: ThresholdKind
  label: string
  limitCents: number
  collectedCents: number
  /** CA / plafond, non borné (1,2 = 120 %). */
  ratio: number
  level: ThresholdLevel
  /** Reste avant le plafond (0 s'il est atteint ou dépassé). */
  remainingCents: number
}

export const THRESHOLD_LABELS: Record<ThresholdKind, string> = {
  micro: 'Plafond micro-entreprise (services)',
  vat: 'Franchise en base de TVA',
  vatRaised: 'Seuil majoré de la franchise de TVA',
}

/** Niveau d'un CA face à un plafond : alerte dès 80 %, dépassé à partir du plafond lui-même. */
export function thresholdLevel(collectedCents: number, limitCents: number): ThresholdLevel {
  if (limitCents <= 0) return 'ok'
  if (collectedCents >= limitCents) return 'exceeded'
  return collectedCents >= limitCents * WARNING_RATIO ? 'warning' : 'ok'
}

export function thresholdStatus(kind: ThresholdKind, collectedCents: number, limitCents: number): ThresholdStatus {
  return {
    kind,
    label: THRESHOLD_LABELS[kind],
    limitCents,
    collectedCents,
    ratio: limitCents > 0 ? collectedCents / limitCents : 0,
    level: thresholdLevel(collectedCents, limitCents),
    remainingCents: Math.max(0, limitCents - collectedCents),
  }
}

/** Les trois jauges d'un émetteur pour une année, dans l'ordre d'affichage. */
export function thresholdStatuses(collectedCents: number, thresholds: YearThresholds): ThresholdStatus[] {
  return [
    thresholdStatus('micro', collectedCents, thresholds.microServicesCents),
    thresholdStatus('vat', collectedCents, thresholds.vatFranchiseCents),
    thresholdStatus('vatRaised', collectedCents, thresholds.vatFranchiseRaisedCents),
  ]
}

const LEVEL_RANK: Record<ThresholdLevel, number> = { ok: 0, warning: 1, exceeded: 2 }

/**
 * Jauge la plus préoccupante (niveau le plus haut, puis le plus proche du plafond). Sert à l'alerte de
 * l'Accueil : `null` si tout est sous les 80 %.
 */
export function worstThreshold(statuses: readonly ThresholdStatus[]): ThresholdStatus | null {
  const alerts = statuses.filter((s) => s.level !== 'ok')
  alerts.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.ratio - a.ratio)
  return alerts[0] ?? null
}

/** Part du plafond en pourcent entier (1,234 → 123). */
export function ratioPercent(ratio: number): number {
  return Math.round(ratio * 100)
}
