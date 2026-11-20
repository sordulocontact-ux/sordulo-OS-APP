import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { signInMap, withSignIn } from '../team/teamLogic'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Member } from '../../shared/types'
import { windowStartIso, weekStartIso, type HomeInvoice, type HomeProspect, type HomeQuote, type HomeTask } from './homeLogic'

/** Une requête par carte, clés dérivées de `queryKeys.home(orgId)`. `enabled` : le rôle du membre. */

export function useHomeQuotes(organizationId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.home(organizationId), 'quotes'] as const,
    enabled,
    queryFn: async (): Promise<HomeQuote[]> => {
      const columns = 'id, number, status, valid_until, total_ttc_cents, accepted_at, client:clients(name)'
      const [sent, accepted] = await Promise.all([
        supabase.from('quotes').select(columns).eq('status', 'sent').overrideTypes<HomeQuote[], { merge: false }>(),
        supabase
          .from('quotes')
          .select(columns)
          .eq('status', 'accepted')
          .order('accepted_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .overrideTypes<HomeQuote[], { merge: false }>(),
      ])
      if (sent.error) throw sent.error
      if (accepted.error) throw accepted.error
      return [...sent.data, ...accepted.data]
    },
  })
}

/** Factures utiles aux cartes Factures (à encaisser) et Finance (6 mois) : même requête, mise en cache une fois. */
export function useHomeInvoices(organizationId: string, enabled: boolean) {
  const now = new Date()
  const since = windowStartIso(now)
  return useQuery({
    queryKey: [...queryKeys.home(organizationId), 'invoices', since] as const,
    enabled,
    queryFn: async (): Promise<HomeInvoice[]> => {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, kind, status, due_date, issue_date, paid_at, total_ht_cents, total_ttc_cents')
        .neq('status', 'draft')
        .or(`status.eq.issued,issue_date.gte.${since},paid_at.gte.${since}`)
        .overrideTypes<HomeInvoice[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

export function useHomeProspects(organizationId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.home(organizationId), 'prospects'] as const,
    enabled,
    queryFn: async (): Promise<HomeProspect[]> => {
      // « members!owner_member_id » : la table a deux clés vers members (responsable, créateur).
      const { data, error } = await supabase
        .from('prospects')
        .select('id, stage, next_action_date, created_at, owner:members!owner_member_id(name)')
        .overrideTypes<HomeProspect[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Début de semaine (lundi) pour « cette semaine », stable le temps d'un rendu. */
export function useWeekStart(): string {
  return useMemo(() => weekStartIso(new Date()), [])
}

export function useHomeWork(organizationId: string, memberId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.home(organizationId), 'work', memberId] as const,
    enabled,
    queryFn: async (): Promise<HomeTask[]> => {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, project_id, status, project:projects(name)')
        .eq('assignee_member_id', memberId)
        .neq('status', 'done')
        .overrideTypes<HomeTask[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

export interface HomeTeam {
  members: (Pick<Member, 'id' | 'removed_at' | 'invited_at' | 'user_id' | 'weekly_capacity_hours'> & { signed_in?: boolean })[]
  inProgress: number
}

export function useHomeTeam(organizationId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.home(organizationId), 'team'] as const,
    enabled,
    queryFn: async (): Promise<HomeTeam> => {
      const [members, tasks, signIn] = await Promise.all([
        supabase
          .from('members')
          .select('id, removed_at, invited_at, user_id, weekly_capacity_hours')
          .eq('organization_id', organizationId)
          .overrideTypes<HomeTeam['members'], { merge: false }>(),
        supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
        // Invité jamais connecté (le compte est relié dès l'invitation) : carte réservée aux admins, comme la RPC.
        supabase.rpc('member_sign_in_status', { p_organization_id: organizationId }),
      ])
      if (members.error) throw members.error
      if (tasks.error) throw tasks.error
      return { members: withSignIn(members.data, signIn.error ? undefined : signInMap(signIn.data)), inProgress: tasks.count ?? 0 }
    },
  })
}
