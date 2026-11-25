import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { runAi } from '../../lib/ai'
import { supabase } from '../../lib/supabase'
import { todayIso } from '../../shared/billing'
import type { FollowupDraftRequest, FollowupDraftResponse } from '../../shared/ai/followupDraft'
import type { FollowupStatus } from '../../shared/types'
import {
  buildFollowupItems,
  type FollowupContact,
  type FollowupInvoice,
  type FollowupItem,
  type FollowupQuote,
  type FollowupRecord,
} from './followupLogic'

export const followupsKey = (organizationId: string) => ['followups', organizationId] as const

/** Jours d'historique des relances envoyées ou ignorées relus (au-delà, le délai de 7 jours est passé). */
const HISTORY_DAYS = 14

function isoDaysAgo(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** Documents à relancer aujourd'hui (devis sans réponse, factures échues), avec leur brouillon. Admin et finance. */
export function useFollowups(organizationId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: followupsKey(organizationId ?? ''),
    enabled: enabled && Boolean(organizationId),
    queryFn: async (): Promise<FollowupItem[]> => {
      const today = todayIso()
      const [quotes, invoices, followups] = await Promise.all([
        supabase
          .from('quotes')
          .select('id, number, title, status, sent_at, issue_date, total_ttc_cents, client_id, client:clients(name)')
          .eq('status', 'sent')
          .overrideTypes<FollowupQuote[], { merge: false }>(),
        supabase
          .from('invoices')
          .select('id, number, title, kind, status, due_date, total_ttc_cents, client_id, client:clients(name)')
          .eq('status', 'issued')
          .neq('kind', 'credit_note')
          .lt('due_date', today)
          .overrideTypes<FollowupInvoice[], { merge: false }>(),
        supabase
          .from('followups')
          .select('id, target_type, target_id, draft, status, sent_at, updated_at')
          .or(`status.eq.draft,updated_at.gte.${isoDaysAgo(today, HISTORY_DAYS)}T00:00:00Z`)
          .overrideTypes<FollowupRecord[], { merge: false }>(),
      ])
      if (quotes.error) throw quotes.error
      if (invoices.error) throw invoices.error
      if (followups.error) throw followups.error

      const clientIds = [...new Set([...quotes.data, ...invoices.data].map((d) => d.client_id))]
      let contacts: FollowupContact[] = []
      if (clientIds.length > 0) {
        const res = await supabase
          .from('client_contacts')
          .select('client_id, name, email, is_primary')
          .in('client_id', clientIds)
          .overrideTypes<FollowupContact[], { merge: false }>()
        if (res.error) throw res.error
        contacts = res.data
      }
      return buildFollowupItems(quotes.data, invoices.data, followups.data, contacts, today)
    },
  })
}

/** Nombre de documents à relancer (compteur de l'Accueil). */
export function useFollowupCount(organizationId: string | undefined, enabled = true) {
  const query = useFollowups(organizationId, enabled)
  return { ...query, count: query.data?.length ?? 0 }
}

/** Prépare (ou refait) le brouillon d'un document par l'IA. */
export function usePrepareFollowup(organizationId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: FollowupDraftRequest) => runAi<FollowupDraftRequest, FollowupDraftResponse>('followupDraft', request),
    onSuccess: () => client.invalidateQueries({ queryKey: followupsKey(organizationId) }),
  })
}

export interface FollowupChange {
  id: string
  draft?: string
  status?: FollowupStatus
}

/** Modifie le texte et / ou le statut d'une relance (la RLS refuse en silence : zéro ligne = erreur). */
export function useUpdateFollowup(organizationId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...changes }: FollowupChange) => {
      const { data, error } = await supabase.from('followups').update(changes).eq('id', id).select('id')
      if (error) throw error
      if (data.length === 0) throw new Error('Modification refusée.')
    },
    onSuccess: () => client.invalidateQueries({ queryKey: followupsKey(organizationId) }),
  })
}
