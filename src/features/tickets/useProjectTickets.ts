import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Input, Ticket } from '../../shared/types'

/** All tickets of a project, newest first. */
export function useProjectTickets(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.tickets(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('project_id', projectId ?? '')
        .order('created_at', { ascending: false })
        .overrideTypes<Ticket[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** All inputs of a project, newest first. */
export function useProjectInputs(projectId: string | undefined) {
  return useQuery({
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
  })
}

export interface TicketTaskStats {
  count: number
  hours: number
}

/** Task count and estimated hours per ticket. Key extends tasks(projectId) so task invalidations refresh it. */
export function useTicketTaskStats(projectId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.tasks(projectId ?? ''), 'ticket-stats'] as const,
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select('ticket_id, estimate_hours')
        .eq('project_id', projectId ?? '')
        .overrideTypes<{ ticket_id: string | null; estimate_hours: number | null }[], { merge: false }>()
      if (error) throw error
      const stats = new Map<string, TicketTaskStats>()
      for (const row of data) {
        if (!row.ticket_id) continue
        const entry = stats.get(row.ticket_id) ?? { count: 0, hours: 0 }
        entry.count += 1
        entry.hours += row.estimate_hours ?? 0
        stats.set(row.ticket_id, entry)
      }
      return stats
    },
  })
}
