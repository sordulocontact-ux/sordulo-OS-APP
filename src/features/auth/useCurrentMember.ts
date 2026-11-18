import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Member, Organization } from '../../shared/types'
import { useAuth } from './useAuth'

type MemberWithOrganization = Member & { organization: Organization }

async function readMembers(userId: string): Promise<MemberWithOrganization[]> {
  const { data, error } = await supabase
    .from('members')
    .select('*, organization:organizations(*)')
    .eq('user_id', userId)
    .overrideTypes<MemberWithOrganization[], { merge: false }>()
  if (error) throw error
  return data
}

async function fetchCurrentMember(userId: string): Promise<MemberWithOrganization | null> {
  const first = await readMembers(userId)
  if (first[0]) return first[0]
  // Account created before the seed: link it to its member row, then read again.
  const { error } = await supabase.rpc('claim_membership')
  if (error) throw error
  const second = await readMembers(userId)
  return second[0] ?? null
}

export interface CurrentMember {
  member: Member | null
  organization: Organization | null
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: () => void
}

export function useCurrentMember(): CurrentMember {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const query = useQuery({
    queryKey: queryKeys.currentMember(userId),
    queryFn: () => fetchCurrentMember(userId),
    enabled: Boolean(userId),
  })
  const row = query.data ?? null
  return {
    member: row ? stripOrganization(row) : null,
    organization: row?.organization ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  }
}

function stripOrganization(row: MemberWithOrganization): Member {
  const { organization: _organization, ...member } = row
  void _organization
  return member
}
