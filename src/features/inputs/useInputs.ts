import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Input } from '../../shared/types'
import { isInputActive } from './inputUtils'

const POLL_MS = 2000

/**
 * When an input goes from another status to "ready", the analysis has just written tickets and tasks:
 * refresh the caches that depend on them.
 */
function useInvalidateOnReady(inputs: Input[] | null | undefined) {
  const queryClient = useQueryClient()
  const previous = useRef(new Map<string, Input['status']>())

  useEffect(() => {
    if (!inputs) return
    for (const input of inputs) {
      const before = previous.current.get(input.id)
      if (before && before !== 'ready' && input.status === 'ready') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.tickets(input.project_id) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.inputTickets(input.id) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(input.project_id) })
      }
      previous.current.set(input.id, input.status)
    }
  }, [inputs, queryClient])
}

/** Inputs of a project, most recent first. Polls while one of them is being processed. */
export function useInputs(projectId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.inputs(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inputs')
        .select('*')
        .eq('project_id', projectId ?? '')
        .order('created_at', { ascending: false })
        .overrideTypes<Input[], { merge: false }>()
      if (error) throw error
      return data
    },
    refetchInterval: (q) => (q.state.data?.some((input) => isInputActive(input.status)) ? POLL_MS : false),
  })
  useInvalidateOnReady(query.data)
  return query
}

/** One input. `data` is null when it does not exist (or is not visible). Polls while it is being processed. */
export function useInput(inputId: string | undefined) {
  const query = useQuery({
    queryKey: queryKeys.input(inputId ?? ''),
    enabled: Boolean(inputId),
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
    refetchInterval: (q) => (q.state.data && isInputActive(q.state.data.status) ? POLL_MS : false),
  })
  useInvalidateOnReady(query.data ? [query.data] : null)
  return query
}

/** Number of tickets of this input still waiting for validation. */
export function useProposedTicketCount(inputId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.inputTickets(inputId ?? ''), 'proposed-count'],
    enabled: Boolean(inputId) && enabled,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('input_id', inputId ?? '')
        .eq('status', 'proposed')
      if (error) throw error
      return count ?? 0
    },
  })
}
