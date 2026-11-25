/**
 * Notifications in-app : libellé et icône par type, « depuis quand », pastille, recherche.
 * Pur et testé (aucun accès réseau ni DOM). Les icônes sont des clés : le composant choisit le SVG.
 */
import type { AppNotification, NotificationKind } from '../../shared/types'

export type NotificationIconKey = 'prospect' | 'task' | 'input' | 'file' | 'proposal' | 'deliverable' | 'commission' | 'billing' | 'default'

export interface NotificationKindInfo {
  label: string
  icon: NotificationIconKey
}

/** Types créés par la base (NOTIFICATION_KINDS). */
export const NOTIFICATION_KIND_INFO = {
  'prospect.created': { label: 'Nouveau prospect', icon: 'prospect' },
  'prospect.offer_ready': { label: 'Offre prête', icon: 'prospect' },
  'prospect.stage': { label: 'Prospection', icon: 'prospect' },
  'task.assigned': { label: 'Tâche attribuée', icon: 'task' },
  'input.ready': { label: 'Tickets à valider', icon: 'input' },
  'file.ready': { label: 'Fichier à ranger', icon: 'file' },
  'file.auto_filed': { label: 'Rangé automatiquement', icon: 'file' },
  'proposal.created': { label: 'Proposition de l’IA', icon: 'proposal' },
  'deliverable.comment': { label: 'Commentaire sur un livrable', icon: 'deliverable' },
  'commission.created': { label: 'Commission', icon: 'commission' },
} as const satisfies Record<NotificationKind, NotificationKindInfo>

/** Types créés ailleurs (create_notification accepte tout [a-z0-9_.]) : famille d'après le préfixe. */
const FAMILY_INFO: Record<string, NotificationKindInfo> = {
  prospect: { label: 'Prospection', icon: 'prospect' },
  task: { label: 'Tâche', icon: 'task' },
  input: { label: 'Entrée', icon: 'input' },
  file: { label: 'Fichier', icon: 'file' },
  proposal: { label: 'Proposition de l’IA', icon: 'proposal' },
  deliverable: { label: 'Livrable', icon: 'deliverable' },
  commission: { label: 'Commission', icon: 'commission' },
  quote: { label: 'Devis', icon: 'billing' },
  invoice: { label: 'Facture', icon: 'billing' },
  followup: { label: 'Relance', icon: 'billing' },
}

const DEFAULT_INFO: NotificationKindInfo = { label: 'Notification', icon: 'default' }

/** Libellé et icône d'un type, connu ou non. */
export function notificationKindInfo(kind: string): NotificationKindInfo {
  if (Object.hasOwn(NOTIFICATION_KIND_INFO, kind)) return NOTIFICATION_KIND_INFO[kind as NotificationKind]
  const family = kind.split('.')[0] ?? ''
  return Object.hasOwn(FAMILY_INFO, family) ? (FAMILY_INFO[family] as NotificationKindInfo) : DEFAULT_INFO
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' })
const dayMonthYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' })
const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
const parisYear = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric' })

/** « à l'instant », « il y a 5 min », « il y a 3 h », « hier », « il y a 4 j », puis « 12 nov. » (année si autre). */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = now.getTime() - date.getTime()
  if (diff < MINUTE) return 'à l’instant'
  if (diff < HOUR) return `il y a ${Math.floor(diff / MINUTE)} min`
  const yesterday = parisDay.format(new Date(now.getTime() - DAY))
  if (diff < DAY && parisDay.format(date) === parisDay.format(now)) return `il y a ${Math.floor(diff / HOUR)} h`
  if (parisDay.format(date) === yesterday) return 'hier'
  if (diff < 7 * DAY) return `il y a ${Math.max(2, Math.round(diff / DAY))} j`
  return parisYear.format(date) === parisYear.format(now) ? dayMonth.format(date) : dayMonthYear.format(date)
}

/** Texte de la pastille : null sans non lue, « 99+ » au-delà de 99. */
export function unreadBadgeText(count: number): string | null {
  if (!(count > 0)) return null
  return count > 99 ? '99+' : String(Math.floor(count))
}

/** Nom accessible du bouton de la cloche. */
export function bellLabel(count: number): string {
  if (!(count > 0)) return 'Notifications'
  return `Notifications, ${count} non lue${count > 1 ? 's' : ''}`
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/** Recherche dans le titre, le texte et le libellé du type (sans accents ni casse). */
export function notificationMatches(notification: Pick<AppNotification, 'title' | 'body' | 'kind'>, query: string): boolean {
  const q = normalize(query.trim())
  if (q === '') return true
  return normalize(`${notification.title} ${notification.body ?? ''} ${notificationKindInfo(notification.kind).label}`).includes(q)
}

/** Lien interne sûr (route de l'app) ou null. */
export function safeLink(link: string | null | undefined): string | null {
  return link && link.startsWith('/') && !link.startsWith('//') ? link : null
}
