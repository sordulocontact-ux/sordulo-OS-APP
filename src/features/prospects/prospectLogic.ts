import { LABELS, PROSPECT_OUTREACH_STAGES, PROSPECT_STAGES, type MemberRole, type Prospect, type ProspectStage } from '../../shared/types'

/** Étapes encore ouvertes (ni gagné ni perdu). */
export const ACTIVE_STAGES: readonly ProspectStage[] = ['to_audit', 'offer_ready', 'to_contact', 'contacted', 'followed_up', 'meeting']

export function isActiveStage(stage: ProspectStage): boolean {
  return stage !== 'won' && stage !== 'lost'
}

/** Valeur du filtre Étape : vide = toutes les actives, `closed` = gagnés et perdus, sinon une étape. */
export type StageFilter = '' | 'closed' | ProspectStage

export const CLOSED_FILTER = 'closed'

export function parseStageParam(value: string | null): StageFilter {
  if (value === CLOSED_FILTER) return CLOSED_FILTER
  return value !== null && value in LABELS.prospectStage ? (value as ProspectStage) : ''
}

export interface ProspectFilters {
  query: string
  stage: StageFilter
  /** Id du membre responsable, vide = tous. */
  owner: string
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export function matchesProspectQuery(prospect: Pick<Prospect, 'company' | 'contact_name' | 'website'>, query: string): boolean {
  const q = normalize(query)
  if (q === '') return true
  return [prospect.company, prospect.contact_name ?? '', prospect.website ?? ''].some((v) => normalize(v).includes(q))
}

export function matchesStage(stage: ProspectStage, filter: StageFilter): boolean {
  if (filter === '') return isActiveStage(stage)
  if (filter === CLOSED_FILTER) return !isActiveStage(stage)
  return stage === filter
}

export function filterProspects(prospects: readonly Prospect[], filters: ProspectFilters): Prospect[] {
  return prospects.filter(
    (p) =>
      matchesStage(p.stage, filters.stage) &&
      (filters.owner === '' || p.owner_member_id === filters.owner) &&
      matchesProspectQuery(p, filters.query),
  )
}

/**
 * Prochaine action la plus urgente d'abord (les dates sans heure se comparent comme du texte),
 * puis sans date, les clos en dernier ; à égalité, le plus récent d'abord.
 */
export function sortProspects(prospects: readonly Prospect[]): Prospect[] {
  const rank = (p: Prospect) => (isActiveStage(p.stage) ? (p.next_action_date ? 0 : 1) : 2)
  return [...prospects].sort((a, b) => {
    const diff = rank(a) - rank(b)
    if (diff !== 0) return diff
    if (rank(a) === 0 && a.next_action_date !== b.next_action_date) {
      return (a.next_action_date ?? '') < (b.next_action_date ?? '') ? -1 : 1
    }
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  })
}

const DAY_MS = 86_400_000

/** Écart en jours entre aujourd'hui et une date `AAAA-MM-JJ` (négatif = passée) ; null si absente ou invalide. */
export function daysUntil(date: string | null, now: Date): number | null {
  if (!date) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!match) return null
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - today) / DAY_MS)
}

export interface RelativeAction {
  text: string
  overdue: boolean
}

/** « Aujourd'hui », « En retard de 3 j », « Dans 2 j » ; null sans date ou sur un prospect clos. */
export function relativeAction(prospect: Pick<Prospect, 'stage' | 'next_action_date'>, now: Date): RelativeAction | null {
  if (!isActiveStage(prospect.stage)) return null
  const days = daysUntil(prospect.next_action_date, now)
  if (days === null) return null
  if (days === 0) return { text: "Aujourd'hui", overdue: false }
  if (days > 0) return { text: `Dans ${days} j`, overdue: false }
  return { text: `En retard de ${-days} j`, overdue: true }
}

export interface ProspectStats {
  /** Sites en attente d'audit (étape « À auditer »). */
  toAudit: number
  /** Prochaine action aujourd'hui ou en retard, hors gagnés et perdus. */
  toFollowUp: number
  ongoing: number
  /** Gagnés ce mois (date de dernière modification, faute de date de gain). */
  wonThisMonth: number
}

export function prospectStats(prospects: readonly Prospect[], now: Date): ProspectStats {
  const stats: ProspectStats = {
    toAudit: 0,
    toFollowUp: 0,
    ongoing: 0,
    wonThisMonth: 0,
  }
  for (const p of prospects) {
    if (isActiveStage(p.stage)) {
      stats.ongoing += 1
      if (p.stage === 'to_audit') stats.toAudit += 1
      const days = daysUntil(p.next_action_date, now)
      if (days !== null && days <= 0) stats.toFollowUp += 1
    } else if (p.stage === 'won') {
      // Date de passage à « gagné » ; repli sur la dernière modification pour une ligne sans won_at.
      const updated = new Date(p.won_at ?? p.updated_at)
      if (updated.getFullYear() === now.getFullYear() && updated.getMonth() === now.getMonth()) stats.wonThisMonth += 1
    }
  }
  return stats
}

/** Site saisi : https:// ajouté si oublié, vide = null. */
export function normalizeSite(raw: string): string | null {
  const value = raw.trim()
  if (value === '') return null
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

export function trimOrNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export const SOURCE_SUGGESTIONS = ['Recommandation', 'Salon', 'Réseaux sociaux', 'Recherche', 'Autre'] as const

/** Ton de pastille par étape. */
export const STAGE_TONES = {
  to_audit: 'neutral',
  offer_ready: 'info',
  to_contact: 'neutral',
  contacted: 'info',
  followed_up: 'info',
  meeting: 'warning',
  won: 'success',
  lost: 'danger',
} as const satisfies Record<ProspectStage, string>

/* ---------- Droits : ce que la base accepte (migration 0014), pour ne proposer que des actions qui réussissent ---------- */

/** Admin et membre : l'agence (audit, offre). Prospection : l'apporteur. */
export function isAgencyRole(role: MemberRole | null | undefined): boolean {
  return role === 'admin' || role === 'membre'
}

/**
 * Étapes que ce rôle peut poser depuis l'étape actuelle (l'étape actuelle est toujours incluse, pour l'affichage).
 * Agence : toutes. Apporteur : les étapes de démarche, et seulement « Perdu » tant que le prospect est « À auditer ».
 */
export function allowedStages(role: MemberRole | null | undefined, current: ProspectStage): ProspectStage[] {
  if (isAgencyRole(role)) return [...PROSPECT_STAGES]
  const reachable: readonly ProspectStage[] = current === 'to_audit' ? ['lost'] : PROSPECT_OUTREACH_STAGES
  return PROSPECT_STAGES.filter((s) => s === current || reachable.includes(s))
}

/** « Convertir en client » : admin, membre, ou l'apporteur pour ses prospects (convert_prospect, migration 0017). */
export function canConvertProspect(role: MemberRole | null | undefined): boolean {
  return role === 'admin' || role === 'membre' || role === 'prospection'
}

/** « Offre prête » : l'agence, depuis « À auditer », une offre du catalogue choisie. */
export function canMarkOfferReady(role: MemberRole | null | undefined, prospect: Pick<Prospect, 'stage'>, serviceId: string): boolean {
  return isAgencyRole(role) && prospect.stage === 'to_audit' && serviceId !== ''
}

/** Raison de refus saisie : obligatoire, 1000 caractères au plus. Renvoie un message ou null. */
export const LOST_REASON_MAX = 1000
export function lostReasonError(text: string): string | null {
  const value = text.trim()
  if (value === '') return 'Indique la raison du refus.'
  if (value.length > LOST_REASON_MAX) return `La raison est trop longue (${LOST_REASON_MAX} caractères au plus).`
  return null
}

/** Pourquoi l'argumentaire ne peut pas être généré (même règle que l'action pitch), null sinon. */
export function pitchBlockerText(
  prospect: Pick<Prospect, 'audit' | 'audit_notes' | 'recommended_service_id' | 'do_not_contact'>,
): string | null {
  if (prospect.do_not_contact) return 'Ce prospect s’oppose à tout nouveau contact.'
  if (!prospect.audit && !prospect.audit_notes?.trim()) return 'L’audit n’est pas encore fait.'
  if (!prospect.recommended_service_id) return 'L’offre n’est pas encore choisie.'
  return null
}

/** Suivre le pré-audit : en cours, ou tout juste lancé à la création (la base n'a pas encore noté « en cours »). */
export function shouldPollAudit(prospect: Pick<Prospect, 'audit_status' | 'website' | 'created_at'>, now: Date): boolean {
  if (prospect.audit_status === 'running') return true
  if (prospect.audit_status !== 'none' || !prospect.website) return false
  const age = now.getTime() - new Date(prospect.created_at).getTime()
  return age >= 0 && age < 60_000
}

export type ScoreTone = 'success' | 'warning' | 'danger' | 'neutral'

export function scoreTone(score: number | null | undefined): ScoreTone {
  if (typeof score !== 'number') return 'neutral'
  return score >= 75 ? 'success' : score >= 50 ? 'warning' : 'danger'
}

/** Ton de pastille par état du pré-audit. */
export const AUDIT_TONES = {
  none: 'neutral',
  running: 'info',
  done: 'success',
  error: 'danger',
} as const satisfies Record<Prospect['audit_status'], string>

export const SEVERITY_TONES = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
} as const
export const SEVERITY_LABELS = {
  high: 'Important',
  medium: 'Moyen',
  low: 'Mineur',
} as const

function isoDay(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Raccourcis de rappel : demain, dans 3 jours, dans une semaine (dates AAAA-MM-JJ locales). */
export function reminderPresets(now: Date): { label: string; date: string }[] {
  const at = (days: number) => isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days))
  return [
    { label: 'Demain', date: at(1) },
    { label: 'Dans 3 jours', date: at(3) },
    { label: 'Dans 1 semaine', date: at(7) },
  ]
}

/** Date d'enregistrement affichable (« 25 novembre 2026 »), vide si invalide. */
export function formatRegistered(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!match) return ''
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
}
