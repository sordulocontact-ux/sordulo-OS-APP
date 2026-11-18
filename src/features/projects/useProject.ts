import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { ProjectWithClient } from './types'

/** One project with its client. `data` is null when the project does not exist (or is not visible). */
export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.project(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*, client:clients(*)')
        .eq('id', projectId ?? '')
        .limit(1)
        .overrideTypes<ProjectWithClient[], { merge: false }>()
      if (error) throw error
      return data[0] ?? null
    },
  })
}
