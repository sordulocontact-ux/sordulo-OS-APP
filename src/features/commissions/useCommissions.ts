import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { CommissionPlan, CommissionStatus } from '../../shared/types'
import type { CommissionRow } from './commissionLogic'

const KEY = ['commissions'] as const
const PLANS_KEY = ['commission-plans'] as const

/**
 * Commissions visibles (la RLS limite l'apporteur aux siennes). Société via le prospect (apporteur et agence),
 * sinon via le client (la finance ne lit pas les prospects) : un champ qu'on ne peut pas lire arrive à null.
 */
export function useCommissions() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commissions')
        .select('*, prospect:prospects(company), client:clients(name)')
        .order('created_at', { ascending: false })
        .overrideTypes<CommissionRow[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Barèmes lisibles : le sien pour l'apporteur, tous pour admin et finance. */
export function useCommissionPlans() {
  return useQuery({
    queryKey: PLANS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('commission_plans').select('*').overrideTypes<CommissionPlan[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

export function commissionErrorText(error: unknown): string {
  const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : ''
  if (/row-level security|permission denied/i.test(message)) return 'Seuls les admins et la finance peuvent changer le statut.'
  return message ? `Une erreur est survenue : ${message}` : 'Une erreur est survenue. Réessaie.'
}

export function useUpdateCommissionStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CommissionStatus }) => {
      const { data, error } = await supabase.from('commissions').update({ status }).eq('id', id).select('id')
      if (error) throw error
      // La RLS filtre sans erreur : aucune ligne modifiée = droit refusé.
      if (!data || data.length === 0) throw new Error('Seuls les admins et la finance peuvent changer le statut.')
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })
}
