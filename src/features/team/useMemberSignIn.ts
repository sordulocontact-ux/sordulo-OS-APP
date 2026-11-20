import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { signInMap } from './teamLogic'

/**
 * Qui s'est déjà connecté (admins seulement : la base refuse les autres). Map id du membre → connecté.
 * Sert à distinguer un invité jamais connecté d'un membre actif.
 */
export function useMemberSignIn(organizationId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['member-sign-in', organizationId ?? ''],
    enabled: Boolean(organizationId) && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('member_sign_in_status', { p_organization_id: organizationId ?? '' })
      if (error) throw error
      return signInMap(data)
    },
  })
}
