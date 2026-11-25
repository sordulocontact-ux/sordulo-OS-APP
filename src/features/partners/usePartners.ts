import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Partner, PartnerProject, Project } from '../../shared/types'
import type { PartnerPayload } from './partnerLogic'

/** Clés du réseau (définies ici : queryKeys.ts n'est pas modifié). */
export const partnerKeys = {
  all: () => ['partners'] as const,
  list: () => ['partners', 'list'] as const,
  detail: (id: string) => ['partners', 'detail', id] as const,
  projects: (id: string) => ['partners', 'projects', id] as const,
}

export type PartnerProjectWithProject = PartnerProject & { project: Pick<Project, 'id' | 'name' | 'status'> | null }

/** Message d'erreur affichable pour une erreur Supabase ou autre. */
export function partnerErrorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '42501') return 'Tu n’as pas le droit de modifier le réseau.'
  if (code === '23505') return 'Ce projet est déjà lié à ce partenaire.'
  if (code === '23514' && message) return message
  return message ? `Une erreur est survenue : ${message}` : 'Une erreur est survenue. Réessaie.'
}

/** Tous les partenaires de l'organisation, archivés compris (le filtre se fait à l'affichage). */
export function usePartners() {
  return useQuery({
    queryKey: partnerKeys.list(),
    queryFn: async () => {
      const { data, error } = await supabase.from('partners').select('*').order('name').overrideTypes<Partner[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

export function usePartner(id: string | undefined) {
  return useQuery({
    queryKey: partnerKeys.detail(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partners')
        .select('*')
        .eq('id', id ?? '')
        .maybeSingle<Partner>()
      if (error) throw error
      return data
    },
  })
}

export function usePartnerProjects(partnerId: string | undefined) {
  return useQuery({
    queryKey: partnerKeys.projects(partnerId ?? ''),
    enabled: Boolean(partnerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partner_projects')
        .select('*, project:projects(id, name, status)')
        .eq('partner_id', partnerId ?? '')
        .order('created_at', { ascending: false })
        .overrideTypes<PartnerProjectWithProject[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

export function useSavePartner() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string | null; organizationId: string; payload: PartnerPayload }) => {
      if (input.id) {
        const { data, error } = await supabase
          .from('partners')
          .update(input.payload)
          .eq('id', input.id)
          .select('*')
          .single<Partner>()
        if (error) throw error
        return data
      }
      const { data, error } = await supabase
        .from('partners')
        .insert({ ...input.payload, organization_id: input.organizationId })
        .select('*')
        .single<Partner>()
      if (error) throw error
      return data
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: partnerKeys.all() }),
  })
}

export function useSetPartnerArchived() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase
        .from('partners')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: partnerKeys.all() }),
  })
}

export function useDeletePartner() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('partners').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: partnerKeys.all() }),
  })
}

export function useAddPartnerProject(partnerId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { projectId: string; role: string | null; amountCents: number | null }) => {
      const { error } = await supabase
        .from('partner_projects')
        .insert({ partner_id: partnerId, project_id: input.projectId, role: input.role, amount_cents: input.amountCents })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: partnerKeys.projects(partnerId) }),
  })
}

export function useRemovePartnerProject(partnerId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase.from('partner_projects').delete().eq('id', linkId)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: partnerKeys.projects(partnerId) }),
  })
}
