import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Member } from '../../shared/types'

/** All members of an organization (assignment, filter by person). */
export function useOrgMembers(organizationId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.members(organizationId ?? ''),
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .eq('organization_id', organizationId ?? '')
        .order('name')
        .overrideTypes<Member[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}
