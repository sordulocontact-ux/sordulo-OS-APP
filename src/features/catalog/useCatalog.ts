import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Service } from '../../shared/types'
import type { ServicePayload } from './catalogLogic'

/** Clés du catalogue (définies ici : queryKeys.ts n'est pas modifié). */
export const catalogKeys = {
  all: () => ['services'] as const,
  usage: (serviceId: string) => ['service-usage', serviceId] as const,
}

/** Message d'erreur affichable pour une erreur Supabase ou autre. */
export function catalogErrorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '42501') return 'Tu n’as pas le droit de modifier le catalogue.'
  if (code === '23514' && message) return message
  return message ? `Une erreur est survenue : ${message}` : 'Une erreur est survenue. Réessaie.'
}

/** Toutes les prestations de l'organisation, archivées comprises (le filtre se fait à l'affichage). */
export function useServices() {
  return useQuery({
    queryKey: catalogKeys.all(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('position')
        .order('name')
        .overrideTypes<Service[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Prestations actives, pour le choix dans un devis. */
export function useActiveServices() {
  const query = useServices()
  return { ...query, data: query.data?.filter((s) => s.active) }
}

export function useSaveService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string | null; organizationId: string; payload: ServicePayload }) => {
      if (input.id) {
        const { data, error } = await supabase
          .from('services')
          .update(input.payload)
          .eq('id', input.id)
          .select('*')
          .single()
          .overrideTypes<Service, { merge: false }>()
        if (error) throw error
        return data
      }
      const { data, error } = await supabase
        .from('services')
        .insert({ ...input.payload, organization_id: input.organizationId })
        .select('*')
        .single()
        .overrideTypes<Service, { merge: false }>()
      if (error) throw error
      return data
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: catalogKeys.all() }),
  })
}

export function useSetServiceActive() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('services').update({ active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: catalogKeys.all() }),
  })
}

/** Nombre de devis et de factures visibles qui citent la prestation (service_id dans leurs lignes). */
export async function countServiceUsage(serviceId: string): Promise<number> {
  const needle = [{ service_id: serviceId }]
  const [quotes, invoices] = await Promise.all([
    supabase.from('quotes').select('id', { count: 'exact', head: true }).contains('lines', needle),
    supabase.from('invoices').select('id', { count: 'exact', head: true }).contains('lines', needle),
  ])
  if (quotes.error) throw quotes.error
  // Un membre ne lit pas les factures (RLS) : l'erreur ou le zéro ne bloque pas, il n'y a rien à compter pour lui.
  return (quotes.count ?? 0) + (invoices.error ? 0 : (invoices.count ?? 0))
}

/**
 * Archive la prestation si elle sert déjà (devis, factures), la supprime sinon.
 * Renvoie ce qui a été fait.
 */
export function useRemoveService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (service: Pick<Service, 'id'>): Promise<'archived' | 'deleted'> => {
      const used = await countServiceUsage(service.id)
      if (used > 0) {
        const { error } = await supabase.from('services').update({ active: false }).eq('id', service.id)
        if (error) throw error
        return 'archived'
      }
      const { error } = await supabase.from('services').delete().eq('id', service.id)
      if (error) throw error
      return 'deleted'
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: catalogKeys.all() }),
  })
}
