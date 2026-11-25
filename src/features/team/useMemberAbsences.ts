import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { MemberAbsence } from '../../shared/types'
import { absenceRow, type AbsenceDraft } from './profileLogic'

export const memberAbsencesKey = (memberId: string) => ['member-absences', memberId] as const

/** Absences d'un membre (lues par toute l'organisation, écrites par lui ou un admin : la RLS tranche). */
export function useMemberAbsences(memberId: string) {
  return useQuery({
    queryKey: memberAbsencesKey(memberId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_absences')
        .select('*')
        .eq('member_id', memberId)
        .order('start_date')
        .overrideTypes<MemberAbsence[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

export function useAddAbsence(memberId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (draft: AbsenceDraft) => {
      const { error } = await supabase.from('member_absences').insert(absenceRow(memberId, draft))
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: memberAbsencesKey(memberId) }),
  })
}

export function useDeleteAbsence(memberId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('member_absences').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: memberAbsencesKey(memberId) }),
  })
}

export const commissionPlanKey = (memberId: string) => ['commission-plan', memberId] as const
