import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { BillingIssuer } from '../../shared/types'
import type { IssuerValues } from './issuerLogic'

/** Tous les émetteurs de l'organisation, archivés compris (lecture admin et finance : vide pour les autres rôles). */
export function useIssuers(organizationId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.issuers(organizationId ?? ''),
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('billing_issuers')
        .select('*')
        .eq('organization_id', organizationId ?? '')
        .order('display_name')
        .overrideTypes<BillingIssuer[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** La RLS ne renvoie pas d'erreur quand elle refuse une écriture : zéro ligne modifiée. */
function rlsRefused() {
  return Object.assign(new Error('row-level security'), { code: '42501' })
}

export function useCreateIssuer(organizationId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: IssuerValues) => {
      if (!organizationId) throw new Error('Organisation introuvable.')
      const { data, error } = await supabase
        .from('billing_issuers')
        .insert({ ...values, organization_id: organizationId })
        .select()
        .overrideTypes<BillingIssuer[], { merge: false }>()
      if (error) throw error
      const created = data[0]
      if (!created) throw rlsRefused()
      return created
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.issuers(organizationId ?? '') }),
  })
}

/** Modifie des colonnes d'un émetteur (champs saisis, ou `archived_at` pour archiver / réactiver). */
export function useUpdateIssuer(organizationId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<IssuerValues> & { archived_at?: string | null } }) => {
      const { data, error } = await supabase
        .from('billing_issuers')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
      if (error) throw error
      if (data.length === 0) throw rlsRefused()
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.issuers(organizationId ?? '') }),
  })
}

/**
 * Change l'émetteur par défaut. Un seul `is_default` par organisation (index unique partiel) :
 * on retire d'abord l'ancien, puis on pose le nouveau.
 */
export function useSetDefaultIssuer(organizationId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, previousDefaultId }: { id: string; previousDefaultId: string | null }) => {
      if (previousDefaultId && previousDefaultId !== id) {
        const { data, error } = await supabase
          .from('billing_issuers')
          .update({ is_default: false })
          .eq('id', previousDefaultId)
          .select('id')
        if (error) throw error
        if (data.length === 0) throw rlsRefused()
      }
      const { data, error } = await supabase.from('billing_issuers').update({ is_default: true }).eq('id', id).select('id')
      if (error) throw error
      if (data.length === 0) throw rlsRefused()
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.issuers(organizationId ?? '') }),
  })
}
