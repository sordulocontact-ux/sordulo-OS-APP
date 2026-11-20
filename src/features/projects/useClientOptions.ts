import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Client } from '../../shared/types'

/**
 * Clients non archivés triés par nom, pour le Select du formulaire projet.
 * `keepClientId` : client actuel du projet, ajouté s'il est archivé pour rester affiché.
 */
export function useClientOptions(keepClientId?: string | null) {
  return useQuery({
    queryKey: [...queryKeys.clients(), 'options', keepClientId ?? ''],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .is('archived_at', null)
        .order('name')
        .overrideTypes<Client[], { merge: false }>()
      if (error) throw error
      if (keepClientId && !data.some((c) => c.id === keepClientId)) {
        const { data: kept, error: keptError } = await supabase
          .from('clients')
          .select('*')
          .eq('id', keepClientId)
          .overrideTypes<Client[], { merge: false }>()
        if (keptError) throw keptError
        return [...data, ...kept].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
      }
      return data
    },
  })
}
