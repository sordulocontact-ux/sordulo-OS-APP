import { LABELS, type Prospect, type ProspectStage } from '../../shared/types'

/** Étapes encore ouvertes (ni gagné ni perdu). */
export const ACTIVE_STAGES: readonly ProspectStage[] = ['to_contact', 'contacted', 'followed_up', 'meeting']

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
  /** Prochaine action aujourd'hui ou en retard, hors gagnés et perdus. */
  toFollowUp: number
  ongoing: number
  /** Gagnés ce mois (date de dernière modification, faute de date de gain). */
  wonThisMonth: number
}

export function prospectStats(prospects: readonly Prospect[], now: Date): ProspectStats {
  const stats: ProspectStats = { toFollowUp: 0, ongoing: 0, wonThisMonth: 0 }
  for (const p of prospects) {
    if (isActiveStage(p.stage)) {
      stats.ongoing += 1
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
  to_contact: 'neutral',
  contacted: 'info',
  followed_up: 'info',
  meeting: 'warning',
  won: 'success',
  lost: 'danger',
} as const satisfies Record<ProspectStage, string>
