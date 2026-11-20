/**
 * Source « attribution » : « <Prénom> t'a assigné une tâche » quand quelqu'un d'autre t'attribue une tâche.
 *
 * - Une fois connecté, abonnement Supabase Realtime (postgres_changes) sur public.tasks, INSERT et UPDATE,
 *   filtré sur `assignee_member_id=eq.<mon membre>`. La RLS s'applique aux événements. La reconnexion du
 *   canal est gérée par supabase-js.
 * - La base remplit `assigned_by_member_id` et `assigned_at` (migration 0003) : on notifie seulement si
 *   l'auteur existe et n'est pas moi. Le couple (tâche, assigned_at) n'est notifié qu'une fois : une mise à
 *   jour de statut ne renotifie pas.
 * - Attributions du même auteur en moins de BATCH_MS (validation d'un lot de tickets) : une seule
 *   notification « Maël t'a assigné N tâches ».
 * - Désabonnement au dispose et à la déconnexion.
 */
import { initials } from '../../../../components/ui/initials'
import { createNotification } from '../../catalog'
import type { IslandNotification } from '../../types'
import type { IslandSource } from '../source'

/** Fenêtre de regroupement des attributions d'un même auteur. */
export const BATCH_MS = 2000

/** Colonnes de public.tasks utiles à la notification. */
export interface AssignedTaskRow {
  id: string
  project_id: string
  title: string
  assignee_member_id: string | null
  assigned_by_member_id: string | null
  assigned_at: string | null
}

export interface AssignmentMember {
  id: string
  name: string
}

export interface AssignmentsSourceDeps {
  /** Écoute les tâches attribuées à `memberId` (INSERT et UPDATE). Renvoie le désabonnement. */
  subscribeAssignedTasks: (memberId: string, onRow: (row: AssignedTaskRow) => void) => () => void
  /** Membres de l'organisation (nom de l'auteur). */
  fetchMembers: (organizationId: string) => Promise<readonly AssignmentMember[]>
}

interface Pending {
  authorId: string
  rows: AssignedTaskRow[]
  timer: unknown
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

export function createAssignmentsSource(deps: AssignmentsSourceDeps): IslandSource {
  return {
    id: 'attribution',
    start(ctx) {
      const { coordinator, clock } = ctx
      /** Couples « tâche|assigned_at » déjà vus. */
      const seen = new Set<string>()
      const pending = new Map<string, Pending>()
      const members = new Map<string, string>()
      let activeMemberId: string | null = null
      let unsubscribe: (() => void) | null = null

      async function loadMembers(organizationId: string): Promise<void> {
        try {
          for (const m of await deps.fetchMembers(organizationId)) members.set(m.id, m.name)
        } catch (e) {
          console.warn('[île] membres indisponibles pour les attributions :', e)
        }
      }

      async function flush(authorId: string): Promise<void> {
        const batch = pending.get(authorId)
        if (!batch) return
        pending.delete(authorId)
        const organizationId = ctx.session.get().organizationId
        if (!members.has(authorId) && organizationId) await loadMembers(organizationId)
        if (ctx.isDisposed() || unsubscribe === null) return

        const author = members.get(authorId)
        const assignerName = author ? firstName(author) : 'Quelqu’un'
        const [first] = batch.rows
        if (!first) return
        const count = batch.rows.length
        const notification: IslandNotification = createNotification('assign', {
          assignerName,
          assignerInitials: author ? initials(author) : '?',
          taskTitle: first.title,
          route: `/projects/${first.project_id}/tasks`,
        })
        coordinator.notify(
          count === 1
            ? notification
            : {
                ...notification,
                title: `${assignerName} t'a assigné ${count} tâches`,
                subtitle: `${first.title} et ${count - 1} ${count - 1 === 1 ? 'autre' : 'autres'}`,
              },
        )
      }

      function onRow(row: AssignedTaskRow): void {
        const me = activeMemberId
        if (!me || ctx.isDisposed()) return
        if (row.assignee_member_id !== me) return
        if (!row.assigned_by_member_id || row.assigned_by_member_id === me || !row.assigned_at) return
        const key = `${row.id}|${row.assigned_at}`
        if (seen.has(key)) return
        seen.add(key)

        const authorId = row.assigned_by_member_id
        const batch = pending.get(authorId)
        if (batch) {
          batch.rows.push(row)
          return
        }
        const created: Pending = { authorId, rows: [row], timer: null }
        created.timer = clock.setTimeout(() => void flush(authorId), BATCH_MS)
        pending.set(authorId, created)
      }

      function stopListening(): void {
        unsubscribe?.()
        unsubscribe = null
        activeMemberId = null
        for (const batch of pending.values()) clock.clearTimeout(batch.timer as never)
        pending.clear()
      }

      function sync(): void {
        const { status, memberId, organizationId } = ctx.session.get()
        const wanted = status === 'signedIn' ? memberId : null
        if (wanted === activeMemberId) return
        stopListening()
        if (!wanted) return
        activeMemberId = wanted
        unsubscribe = deps.subscribeAssignedTasks(wanted, onRow)
        if (organizationId) void loadMembers(organizationId)
      }

      const stopSession = ctx.session.subscribe(sync)
      sync()

      return {
        dispose: () => {
          stopSession()
          stopListening()
        },
      }
    },
  }
}

/**
 * Accès réels : Supabase Realtime. Le client est importé à la demande pour que les tests (et l'import du
 * module) ne créent jamais de client réseau.
 */
export const supabaseAssignmentsDeps: AssignmentsSourceDeps = {
  subscribeAssignedTasks(memberId, onRow) {
    let cancelled = false
    let remove: (() => void) | null = null
    void import('../../../../lib/supabase').then(({ supabase }) => {
      if (cancelled) return
      const filter = `assignee_member_id=eq.${memberId}`
      const handle = (payload: { new: unknown }) => onRow(payload.new as AssignedTaskRow)
      const channel = supabase
        .channel(`island-assignments-${memberId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter }, handle)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter }, handle)
        .subscribe()
      remove = () => void supabase.removeChannel(channel)
    })
    return () => {
      cancelled = true
      remove?.()
    }
  },
  async fetchMembers(organizationId) {
    const { supabase } = await import('../../../../lib/supabase')
    const { data, error } = await supabase
      .from('members')
      .select('id, name')
      .eq('organization_id', organizationId)
      .overrideTypes<AssignmentMember[], { merge: false }>()
    if (error) throw error
    return data
  },
}

export const assignmentsSource: IslandSource = createAssignmentsSource(supabaseAssignmentsDeps)
