import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { ProjectWithClient } from './types'

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*, client:clients(*)')
        .order('name')
        .overrideTypes<ProjectWithClient[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}
