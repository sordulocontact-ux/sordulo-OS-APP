import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Input, InputStatus, Task, Ticket } from '../../shared/types'

export const PROCESSING_STATUSES: readonly InputStatus[] = ['uploaded', 'transcribing', 'analyzing']
const POLL_MS = 2000

/** The input, polled every 2 s while it is still being processed. */
export function useReviewInput(inputId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.input(inputId ?? ''),
    enabled: Boolean(inputId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && PROCESSING_STATUSES.includes(status) ? POLL_MS : false
    },
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inputs')
        .select('*')
        .eq('id', inputId ?? '')
        .limit(1)
        .overrideTypes<Input[], { merge: false }>()
      if (error) throw error
      return data[0] ?? null
    },
  })
}

/** Tickets of an input, oldest first (the order of the analysis). */
export function useInputTickets(inputId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.inputTickets(inputId ?? ''),
    enabled: enabled && Boolean(inputId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('input_id', inputId ?? '')
        .order('created_at', { ascending: true })
        .overrideTypes<Ticket[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Tasks of the tickets of an input. Key extends inputTickets(inputId): invalidating it refreshes both. */
export function useInputTasks(inputId: string | undefined, ticketIds: readonly string[], enabled: boolean) {
  return useQuery({
    queryKey: [...queryKeys.inputTickets(inputId ?? ''), 'tasks', ticketIds] as const,
    enabled: enabled && Boolean(inputId) && ticketIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('*')
        .in('ticket_id', [...ticketIds])
        .order('position', { ascending: true })
        .overrideTypes<Task[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}
