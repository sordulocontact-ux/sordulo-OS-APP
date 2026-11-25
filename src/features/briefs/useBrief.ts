import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { runAi } from '../../lib/ai'
import type { BriefRequest, BriefResponse } from '../../shared/ai/brief'
import type { QuoteDraftRequest, QuoteDraftResponse } from '../../shared/ai/quoteDraft'
import type { Brief, BriefContent } from '../../shared/types'

const briefKey = (inputId: string) => ['brief', inputId] as const
const briefQuoteKey = (quoteId: string) => ['brief-quote', quoteId] as const

/** Brief d'une entrée ; data = null s'il n'existe pas encore. */
export function useBrief(inputId: string) {
  return useQuery({
    queryKey: briefKey(inputId),
    queryFn: async () => {
      const { data, error } = await supabase.from('briefs').select('*').eq('input_id', inputId).maybeSingle<Brief>()
      if (error) throw error
      return data
    },
  })
}

/** Numéro du devis créé depuis le brief (null si supprimé entre-temps). */
export function useBriefQuote(quoteId: string | null) {
  return useQuery({
    queryKey: briefQuoteKey(quoteId ?? ''),
    enabled: quoteId !== null,
    queryFn: async () => {
      const { data, error } = await supabase.from('quotes').select('id, number').eq('id', quoteId ?? '').maybeSingle<{ id: string; number: string }>()
      if (error) throw error
      return data
    },
  })
}

export function useGenerateBrief(inputId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => runAi<BriefRequest, BriefResponse>('brief', { inputId }),
    onSuccess: ({ brief }) => queryClient.setQueryData(briefKey(inputId), brief),
  })
}

export function useSaveBrief(inputId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ briefId, content }: { briefId: string; content: BriefContent }) => {
      const { data, error } = await supabase.from('briefs').update({ content }).eq('id', briefId).select().single<Brief>()
      if (error) throw error
      return data
    },
    onSuccess: (brief) => queryClient.setQueryData(briefKey(inputId), brief),
  })
}

export function useCreateQuoteDraft(inputId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (briefId: string) => runAi<QuoteDraftRequest, QuoteDraftResponse>('quoteDraft', { briefId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: briefKey(inputId) })
      void queryClient.invalidateQueries({ queryKey: ['quotes'] })
    },
  })
}
