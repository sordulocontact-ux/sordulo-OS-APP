import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import type { Prospect, ProspectStage } from '../../shared/types'

const RIGHTS_MESSAGE = 'Seuls les admins et la prospection peuvent modifier les prospects.'

/** Message d'erreur affichable (français) pour une erreur Supabase ou autre. */
export function prospectErrorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '42501' || /row-level security|permission denied|not allowed|forbidden/i.test(message)) return RIGHTS_MESSAGE
  return message ? `Une erreur est survenue : ${message}` : 'Une erreur est survenue. Réessaie.'
}

/** Tous les prospects de l'organisation (le tri et les filtres se font à l'affichage). */
export function useProspects() {
  return useQuery({
    queryKey: queryKeys.prospects(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prospects')
        .select('*')
        .overrideTypes<Prospect[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Un prospect ; `data` vaut null s'il n'existe pas ou n'est pas visible. */
export function useProspect(prospectId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.prospect(prospectId ?? ''),
    enabled: Boolean(prospectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prospects')
        .select('*')
        .eq('id', prospectId ?? '')
        .limit(1)
        .overrideTypes<Prospect[], { merge: false }>()
      if (error) throw error
      return data[0] ?? null
    },
  })
}

/** Champs modifiables d'un prospect (valeurs déjà trimées, vide = null). */
export interface ProspectFields {
  company: string
  website: string | null
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  source: string | null
  stage: ProspectStage
  next_action_date: string | null
  notes: string | null
  owner_member_id: string | null
}

function useInvalidateProspects() {
  const queryClient = useQueryClient()
  return (prospectId?: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.prospects() })
    if (prospectId) void queryClient.invalidateQueries({ queryKey: queryKeys.prospect(prospectId) })
  }
}

export function useCreateProspect() {
  const invalidate = useInvalidateProspects()
  return useMutation({
    mutationFn: async ({ organizationId, createdBy, fields }: { organizationId: string; createdBy: string | null; fields: ProspectFields }) => {
      const { data, error } = await supabase
        .from('prospects')
        .insert({ ...fields, organization_id: organizationId, created_by: createdBy })
        .select()
        .overrideTypes<Prospect[], { merge: false }>()
      if (error) throw error
      const prospect = data[0]
      if (!prospect) throw new Error(RIGHTS_MESSAGE)
      return prospect
    },
    onSettled: () => invalidate(),
  })
}

/** Met à jour un prospect choisi à l'appel (la liste réutilise un seul hook pour toutes les lignes). */
export function useUpdateProspect() {
  const invalidate = useInvalidateProspects()
  return useMutation({
    mutationFn: async ({ prospectId, fields }: { prospectId: string; fields: Partial<ProspectFields> }) => {
      const { data, error } = await supabase
        .from('prospects')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', prospectId)
        .select('id')
      if (error) throw error
      // La RLS filtre sans erreur : aucune ligne modifiée = droit refusé.
      if (!data || data.length === 0) throw new Error(RIGHTS_MESSAGE)
    },
    onSettled: (_data, _error, variables) => invalidate(variables.prospectId),
  })
}

/** Convertit un prospect en client (idempotent côté base) et renvoie l'id du client. */
export function useConvertProspect() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (prospectId: string) => {
      const { data, error } = await supabase.rpc('convert_prospect', { p_prospect_id: prospectId })
      if (error) throw error
      return String(data)
    },
    onSettled: (_data, _error, prospectId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospect(prospectId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients() })
    },
  })
}
