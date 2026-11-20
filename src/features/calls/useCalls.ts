import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { isInputActive } from '../inputs/inputUtils'
import type { CallRow } from './callsLogic'

const POLL_MS = 2000

/**
 * Tous les appels (entrées « meeting »). La transcription n'est pas chargée : seule la durée est lue
 * dans le JSON (`transcript->duration_seconds`), et les tickets sont comptés par PostgREST.
 */
export function useCalls() {
  return useQuery({
    queryKey: ['calls'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inputs')
        .select('id, project_id, title, status, created_at, speaker_names, duration:transcript->duration_seconds, project:projects(id, name, client:clients(id, name)), tickets(count)')
        .eq('kind', 'meeting')
        .order('created_at', { ascending: false })
        .overrideTypes<CallRow[], { merge: false }>()
      if (error) throw error
      return data
    },
    refetchInterval: (q) => (q.state.data?.some((call) => isInputActive(call.status)) ? POLL_MS : false),
  })
}
