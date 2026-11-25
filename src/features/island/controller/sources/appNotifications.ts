/**
 * Source « notifications » : les notifications de la base (table notifications, Realtime) arrivent dans l'île.
 *
 * - Une fois connecté, abonnement Supabase Realtime (postgres_changes, INSERT) sur public.notifications filtré
 *   sur `member_id=eq.<mon membre>` (la RLS s'applique aux événements), comme la source « attribution ».
 *   Désabonnement au dispose et à la déconnexion.
 * - Filtre et textes : appNotifications/logic.ts (pas de doublon avec les attributions, les lots de rangement
 *   de cette île ni les entrées suivies par cette île).
 * - Clic sur le bouton : la notification est marquée lue, puis la fenêtre principale s'ouvre sur son lien.
 * - Proposition de l'IA à valider : décision dans l'île ; Valider / Refuser appellent directement les RPC
 *   apply_ai_proposal / refuse_ai_proposal (la fenêtre de l'île n'a pas de QueryClientProvider), puis la
 *   notification est marquée lue. Échap ou mise de côté : elle reste non lue dans la cloche de l'app.
 */
import { openMainAt } from '../../../../lib/desktop'
import type { AppNotification } from '../../../../shared/types'
import { readTrackedInputs } from '../../../desktop/storage'
import {
  PROPOSAL_CHOICE_PREFIX,
  islandViewOf,
  proposalAppliedNotification,
  proposalFailedNotification,
  proposalUndoneNotification,
} from '../../appNotifications/logic'
import { errorMessage } from '../callFlow'
import type { IslandSource } from '../source'

export interface AppNotificationsSourceDeps {
  /** Écoute les notifications créées pour `memberId` (INSERT). Renvoie le désabonnement. */
  subscribeNotifications: (memberId: string, onRow: (row: AppNotification) => void) => () => void
  /** Pose read_at (seule colonne modifiable par le destinataire). */
  markRead: (notificationId: string) => Promise<void>
  applyProposal: (proposalId: string, always: boolean) => Promise<void>
  refuseProposal: (proposalId: string) => Promise<void>
  undoProposal: (proposalId: string) => Promise<void>
  openMain: (route: string) => Promise<void> | void
  /** Entrée suivie par cette île avant ce lancement (reprise du suivi au démarrage). */
  isTrackedInput?: (inputId: string) => boolean
}

interface ProposalRecord {
  proposalId: string
  notificationId: string
  title: string
}

function warn(label: string) {
  return (e: unknown) => console.warn(`[île] ${label} :`, e)
}

export function createAppNotificationsSource(deps: AppNotificationsSourceDeps): IslandSource {
  return {
    id: 'notifications',
    start(ctx) {
      const { coordinator } = ctx
      const ownBatchIds = new Set<string>()
      const trackedInputIds = new Set<string>()
      const proposals = new Map<string, ProposalRecord>()
      /** Notifications déjà vues (Realtime peut renvoyer un événement après une reconnexion). */
      const seen = new Set<string>()
      let activeMemberId: string | null = null
      let unsubscribe: (() => void) | null = null

      function markRead(notificationId: string | null): void {
        if (notificationId) deps.markRead(notificationId).catch(warn('notification non marquée lue'))
      }

      function onRow(row: AppNotification): void {
        const me = activeMemberId
        if (!me || ctx.isDisposed() || seen.has(row.id)) return
        seen.add(row.id)
        const inputId = typeof row.payload?.input_id === 'string' ? row.payload.input_id : null
        if (inputId && deps.isTrackedInput?.(inputId)) trackedInputIds.add(inputId)
        const view = islandViewOf(row, { memberId: me, ownBatchIds, trackedInputIds })
        if (view.type === 'notify') coordinator.notify(view.notification)
        else if (view.type === 'choice') {
          proposals.set(view.choice.id, { proposalId: view.proposalId, notificationId: row.id, title: view.choice.title })
          coordinator.requestChoice(view.choice)
        }
      }

      function stopListening(): void {
        unsubscribe?.()
        unsubscribe = null
        activeMemberId = null
      }

      function sync(): void {
        const { status, memberId } = ctx.session.get()
        const wanted = status === 'signedIn' ? memberId : null
        if (wanted === activeMemberId) return
        stopListening()
        if (!wanted) return
        activeMemberId = wanted
        unsubscribe = deps.subscribeNotifications(wanted, onRow)
      }

      async function decide(record: ProposalRecord, apply: boolean, always: boolean): Promise<void> {
        try {
          if (apply) await deps.applyProposal(record.proposalId, always)
          else await deps.refuseProposal(record.proposalId)
        } catch (e) {
          if (!ctx.isDisposed()) {
            coordinator.notify(
              proposalFailedNotification(
                apply ? 'La proposition n’a pas été appliquée' : 'La proposition n’a pas été refusée',
                errorMessage(e, 'Réessaie depuis l’app.'),
              ),
            )
          }
          return
        }
        markRead(record.notificationId)
        if (apply && !ctx.isDisposed()) coordinator.notify(proposalAppliedNotification(record.title, record.proposalId, always))
      }

      async function undo(proposalId: string, notificationId: string | null): Promise<void> {
        markRead(notificationId)
        try {
          await deps.undoProposal(proposalId)
        } catch (e) {
          if (!ctx.isDisposed()) {
            coordinator.notify(proposalFailedNotification('L’annulation a échoué', errorMessage(e, 'Annule depuis l’app.')))
          }
          return
        }
        if (!ctx.isDisposed()) coordinator.notify(proposalUndoneNotification())
      }

      const stops = [
        ctx.session.subscribe(sync),
        ctx.bus.on('filingBatch', ({ batchId }) => ownBatchIds.add(batchId)),
        ctx.bus.on('trackInput', ({ inputId }) => trackedInputIds.add(inputId)),
      ]
      sync()

      return {
        dispose: () => {
          stops.forEach((stop) => stop())
          stopListening()
          proposals.clear()
        },
        gestures: {
          onChoiceDecision: (decision, choice, always) => {
            if (!choice.id.startsWith(PROPOSAL_CHOICE_PREFIX)) return
            coordinator.resolveChoice(choice.id)
            const record = proposals.get(choice.id)
            if (!record || decision === 'dismiss') return
            proposals.delete(choice.id)
            void decide(record, decision === 'primary', always)
          },
        },
        actions: {
          openNotification: (action) => {
            markRead(action.notificationId)
            if (action.route) {
              void Promise.resolve(deps.openMain(action.route)).catch(warn('ouverture de l’app'))
            }
          },
          undoProposal: (action) => undo(action.proposalId, action.notificationId),
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Accès réels
// ---------------------------------------------------------------------------

/** Supabase importé à la demande : les tests (et l'import du module) ne créent jamais de client réseau. */
export const supabaseAppNotificationsDeps: AppNotificationsSourceDeps = {
  subscribeNotifications(memberId, onRow) {
    let cancelled = false
    let remove: (() => void) | null = null
    void import('../../../../lib/supabase').then(({ supabase }) => {
      if (cancelled) return
      const channel = supabase
        .channel(`island-notifications-${memberId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `member_id=eq.${memberId}` },
          (payload: { new: unknown }) => onRow(payload.new as AppNotification),
        )
        .subscribe()
      remove = () => void supabase.removeChannel(channel)
    })
    return () => {
      cancelled = true
      remove?.()
    }
  },
  async markRead(notificationId) {
    const { supabase } = await import('../../../../lib/supabase')
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', notificationId)
      .is('read_at', null)
    if (error) throw error
  },
  async applyProposal(proposalId, always) {
    const { supabase } = await import('../../../../lib/supabase')
    const { error } = await supabase.rpc('apply_ai_proposal', { p_id: proposalId, p_always: always })
    if (error) throw new Error(error.message)
  },
  async refuseProposal(proposalId) {
    const { supabase } = await import('../../../../lib/supabase')
    const { error } = await supabase.rpc('refuse_ai_proposal', { p_id: proposalId })
    if (error) throw new Error(error.message)
  },
  async undoProposal(proposalId) {
    const { supabase } = await import('../../../../lib/supabase')
    const { error } = await supabase.rpc('undo_ai_proposal', { p_id: proposalId })
    if (error) throw new Error(error.message)
  },
  openMain: (route) => openMainAt({ route }),
  isTrackedInput: (inputId) => readTrackedInputs().some((tracked) => tracked.inputId === inputId),
}

export const appNotificationsSource: IslandSource = createAppNotificationsSource(supabaseAppNotificationsDeps)
