import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryKeys } from '../../lib/queryKeys'
import { runAi } from '../../lib/ai'
import type { PitchRequest, PitchResponse } from '../../shared/ai/pitch'
import type { ProspectAuditRequest, ProspectAuditResponse } from '../../shared/ai/prospectAudit'
import type { Prospect, ProspectStage, Service } from '../../shared/types'
import { shouldPollAudit } from './prospectLogic'

const RIGHTS_MESSAGE = 'Tu n’as pas le droit de modifier ce prospect.'

/** Message d'erreur affichable (français) pour une erreur Supabase ou autre. */
export function prospectErrorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (/row-level security|permission denied|not allowed|forbidden/i.test(message)) return RIGHTS_MESSAGE
  // Règles de la base (trigger des prospects) : le message est déjà écrit pour l'utilisateur.
  if ((code === '42501' || code === 'P0001') && message) return message
  if (code === '42501') return RIGHTS_MESSAGE
  return message ? `Une erreur est survenue : ${message}` : 'Une erreur est survenue. Réessaie.'
}

/** Tous les prospects de l'organisation (le tri et les filtres se font à l'affichage). */
export function useProspects() {
  return useQuery({
    queryKey: queryKeys.prospects(),
    queryFn: async () => {
      const { data, error } = await supabase.from('prospects').select('*').overrideTypes<Prospect[], { merge: false }>()
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
    // Pré-audit en cours (ou tout juste lancé) : relit la fiche pour afficher le résultat dès qu'il arrive.
    refetchInterval: (query) => (query.state.data && shouldPollAudit(query.state.data, new Date()) ? 4000 : false),
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

/** Autres colonnes modifiables d'un prospect (fiche : audit humain, offre, argumentaire, refus, opposition). */
export interface ProspectDetailFields {
  registered_at: string
  audit_notes: string | null
  recommended_service_id: string | null
  offer_notes: string | null
  pitch: string | null
  lost_reason: string | null
  do_not_contact: boolean
}

export type ProspectChanges = Partial<ProspectFields & ProspectDetailFields>

function useInvalidateProspects() {
  const queryClient = useQueryClient()
  return (prospectId?: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.prospects() })
    if (prospectId)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.prospect(prospectId),
      })
  }
}

export function useCreateProspect() {
  const invalidate = useInvalidateProspects()
  return useMutation({
    // created_by, updated_at, won_at et client_id sont posés par la base (pas de droit d’écriture sur ces colonnes).
    mutationFn: async ({
      organizationId,
      fields,
    }: {
      organizationId: string
      fields: ProspectChanges & Pick<ProspectFields, 'company' | 'stage'>
    }) => {
      const { data, error } = await supabase
        .from('prospects')
        .insert({ ...fields, organization_id: organizationId })
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
    mutationFn: async ({ prospectId, fields }: { prospectId: string; fields: ProspectChanges }) => {
      const { data, error } = await supabase.from('prospects').update(fields).eq('id', prospectId).select('id')
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
      const { data, error } = await supabase.rpc('convert_prospect', {
        p_prospect_id: prospectId,
      })
      if (error) throw error
      return String(data)
    },
    onSettled: (_data, _error, prospectId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects() })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.prospect(prospectId),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients() })
    },
  })
}

/** Prestations actives du catalogue (lues par toute l'organisation, apporteur compris). */
export function useCatalogServices() {
  return useQuery({
    queryKey: ['prospect-catalog-services'] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('position', { ascending: true })
        .order('name', { ascending: true })
        .overrideTypes<Service[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/**
 * Lance (ou relance) le pré-audit d'un prospect. Le résultat est écrit par le serveur : la fiche et la liste sont
 * relues à la fin. En attendant, l'état « en cours » est posé tout de suite dans le cache.
 */
export function useRunProspectAudit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (prospectId: string) =>
      runAi<ProspectAuditRequest, ProspectAuditResponse>('prospectAudit', {
        prospectId,
      }),
    onMutate: (prospectId) => {
      queryClient.setQueryData<Prospect | null>(queryKeys.prospect(prospectId), (old) => (old ? { ...old, audit_status: 'running' } : old))
    },
    onSettled: (_data, _error, prospectId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.prospects() })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.prospect(prospectId),
      })
    },
  })
}

/** Génère l'argumentaire (écrit par le serveur dans prospects.pitch). */
export function useRunPitch() {
  const invalidate = useInvalidateProspects()
  return useMutation({
    mutationFn: (prospectId: string) => runAi<PitchRequest, PitchResponse>('pitch', { prospectId }),
    onSettled: (_data, _error, prospectId) => invalidate(prospectId),
  })
}
