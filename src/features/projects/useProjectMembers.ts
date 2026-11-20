import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { ProjectMember } from '../../shared/types'

/** Membres affectés à un projet (vide = toute l'équipe). */
export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projectMembers(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_members')
        .select('*')
        .eq('project_id', projectId ?? '')
        .overrideTypes<ProjectMember[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}
