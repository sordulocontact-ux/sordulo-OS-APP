/**
 * Notifications de la base (table notifications, migration 0013) dans l'île : filtre des doublons et
 * traduction en notification ou en décision de l'île. Pur (ni React, ni Tauri, ni Supabase) : testé dans
 * logic.test.ts, utilisé par controller/sources/appNotifications.ts et par le labo.
 *
 * Ignorées (déjà annoncées autrement dans l'île, ou plus d'actualité) :
 * - destinataire autre que moi, ou déjà lue ;
 * - task.assigned : la source « attribution » le fait déjà, avec regroupement ;
 * - file.ready / file.auto_filed d'un lot lancé par cette île : le déroulé de la zone « Ranger » l'a annoncé ;
 * - input.ready d'une entrée suivie par cette île (appel, audio ou document déposé) : la source « analyse »
 *   annonce déjà « N tickets à valider ».
 * Proposition de l'IA à valider (proposal.created, statut pending) : décision Valider / Refuser / Toujours ;
 * appliquée seule (auto_applied) : notification avec Annuler. Le reste : notification, bouton vers son lien.
 */
import type { AppNotification } from '../../../shared/types'
import { DEFAULT_NOTIFICATION_MS, LONG_NOTIFICATION_MS, createNotification } from '../catalog'
import type { IslandChoice, IslandIconName, IslandNotification, IslandTone } from '../types'

/** Types que l'île n'affiche jamais (une autre source s'en charge). */
export const IGNORED_KINDS: readonly string[] = ['task.assigned']

export const PROPOSAL_CHOICE_PREFIX = 'proposal:'
export const PROPOSALS_ROUTE = '/proposals'

export interface AppNotificationContext {
  /** Mon membre : seules mes notifications. */
  memberId: string
  /** Lots de rangement lancés par cette île. */
  ownBatchIds: ReadonlySet<string>
  /** Entrées suivies par cette île (source « analyse »). */
  trackedInputIds: ReadonlySet<string>
}

export type IslandAppNotification =
  | { type: 'ignore'; reason: 'other' | 'read' | 'kind' | 'own-filing' | 'tracked-input' }
  | { type: 'notify'; notification: IslandNotification }
  | { type: 'choice'; choice: IslandChoice; proposalId: string }

interface KindVisual {
  icon: IslandIconName
  tone: IslandTone
  /** Libellé du bouton quand la notification a un lien. */
  button: string
  /** Sous-titre quand la notification n'a pas de texte. */
  fallback: string
  long?: boolean
}

const KIND_VISUALS: Readonly<Record<string, KindVisual>> = {
  'prospect.created': { icon: 'bell', tone: 'info', button: 'Voir', fallback: 'Nouveau prospect' },
  'prospect.offer_ready': { icon: 'check', tone: 'success', button: 'Voir', fallback: 'Offre prête' },
  'prospect.stage': { icon: 'bell', tone: 'neutral', button: 'Voir', fallback: 'Prospection' },
  'input.ready': { icon: 'tickets', tone: 'neutral', button: 'Valider', fallback: 'Tickets à valider', long: true },
  'file.ready': { icon: 'folder', tone: 'info', button: 'Ranger', fallback: 'Fichier à ranger', long: true },
  'file.auto_filed': { icon: 'check', tone: 'success', button: 'Voir', fallback: 'Rangé automatiquement' },
  'proposal.created': { icon: 'tickets', tone: 'info', button: 'Voir', fallback: 'Proposition de l’IA', long: true },
  'deliverable.comment': { icon: 'bell', tone: 'info', button: 'Voir', fallback: 'Commentaire sur un livrable' },
  'commission.created': { icon: 'euro', tone: 'success', button: 'Voir', fallback: 'Commission' },
  'recap.weekly': { icon: 'cal', tone: 'neutral', button: 'Lire', fallback: 'Récap de la semaine' },
}

const DEFAULT_VISUAL: KindVisual = { icon: 'bell', tone: 'neutral', button: 'Ouvrir', fallback: 'Notification' }

export function kindVisual(kind: string): KindVisual {
  return Object.hasOwn(KIND_VISUALS, kind) ? (KIND_VISUALS[kind] as KindVisual) : DEFAULT_VISUAL
}

/** Lien interne sûr (route de l'app) ou null. */
export function safeRoute(link: string | null | undefined): string | null {
  return link && link.startsWith('/') && !link.startsWith('//') ? link : null
}

function payloadString(row: Pick<AppNotification, 'payload'>, key: string): string | null {
  const value = row.payload?.[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/** « Proposition : Réattribuer 3 tâches » → « Réattribuer 3 tâches ». */
export function proposalTitle(title: string): string {
  return title.replace(/^(Proposition|Appliqué automatiquement)\s*:\s*/u, '').trim() || title
}

export function proposalChoiceId(proposalId: string): string {
  return `${PROPOSAL_CHOICE_PREFIX}${proposalId}`
}

/** Notification de la base → ce que l'île en fait. */
export function islandViewOf(row: AppNotification, context: AppNotificationContext): IslandAppNotification {
  if (row.member_id !== context.memberId) return { type: 'ignore', reason: 'other' }
  if (row.read_at) return { type: 'ignore', reason: 'read' }
  if (IGNORED_KINDS.includes(row.kind)) return { type: 'ignore', reason: 'kind' }
  if (row.kind === 'file.ready' || row.kind === 'file.auto_filed') {
    const batchId = payloadString(row, 'batch_id')
    if (batchId && context.ownBatchIds.has(batchId)) return { type: 'ignore', reason: 'own-filing' }
  }
  if (row.kind === 'input.ready') {
    const inputId = payloadString(row, 'input_id')
    if (inputId && context.trackedInputIds.has(inputId)) return { type: 'ignore', reason: 'tracked-input' }
  }

  const route = safeRoute(row.link)
  const visual = kindVisual(row.kind)
  const proposalId = row.kind === 'proposal.created' ? payloadString(row, 'proposal_id') : null
  const status = payloadString(row, 'status')

  if (proposalId && status === 'pending') {
    return {
      type: 'choice',
      proposalId,
      choice: {
        id: proposalChoiceId(proposalId),
        icon: visual.icon,
        tone: visual.tone,
        eyebrow: row.body?.trim() ? `Proposition de l’IA · ${row.body.trim()}` : 'Proposition de l’IA',
        title: proposalTitle(row.title),
        always: { label: 'Toujours', hint: 'Appliquer seules les prochaines propositions de ce type' },
        secondary: 'Refuser',
        primary: 'Valider',
      },
    }
  }

  if (proposalId && status === 'auto_applied') {
    return {
      type: 'notify',
      notification: createNotification('appNotification', {
        icon: 'check',
        tone: 'success',
        title: row.title,
        subtitle: row.body?.trim() || 'Appliqué grâce à une règle « Toujours »',
        button: 'Annuler',
        action: { type: 'undoProposal', proposalId, notificationId: row.id },
        durationMs: LONG_NOTIFICATION_MS,
      }),
    }
  }

  return {
    type: 'notify',
    notification: createNotification('appNotification', {
      icon: visual.icon,
      tone: visual.tone,
      title: row.title,
      subtitle: row.body?.trim() || visual.fallback,
      button: route ? visual.button : null,
      action: { type: 'openNotification', notificationId: row.id, route },
      durationMs: visual.long ? LONG_NOTIFICATION_MS : DEFAULT_NOTIFICATION_MS,
    }),
  }
}

/** Après « Valider » : « Proposition appliquée », Annuler. */
export function proposalAppliedNotification(title: string, proposalId: string, always: boolean): IslandNotification {
  return createNotification('appNotification', {
    icon: 'check',
    tone: 'success',
    title: 'Proposition appliquée',
    subtitle: always ? `${title}, et les prochaines de ce type` : title,
    button: 'Annuler',
    action: { type: 'undoProposal', proposalId, notificationId: null },
    durationMs: LONG_NOTIFICATION_MS,
  })
}

/** Après « Annuler ». */
export function proposalUndoneNotification(): IslandNotification {
  return createNotification('appNotification', {
    icon: 'check',
    tone: 'neutral',
    title: 'Proposition annulée',
    subtitle: 'Les tâches sont revenues comme avant',
    button: null,
    action: { type: 'dismiss' },
  })
}

/** Valider, Refuser ou Annuler impossible : le message, Ouvrir la page des propositions. */
export function proposalFailedNotification(title: string, message: string): IslandNotification {
  return createNotification('appNotification', {
    icon: 'alert',
    tone: 'danger',
    title,
    subtitle: message,
    button: 'Ouvrir',
    action: { type: 'openMain', route: PROPOSALS_ROUTE },
  })
}
