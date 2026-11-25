import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Deliverable, DeliverableComment, DeliverableVersion, DeliverableVersionStatus, ProjectFile } from '../../shared/types'
import { uploadDeliverableVersion, type UploadVersionInput } from './uploadDeliverable'

export type VersionFile = Pick<ProjectFile, 'id' | 'name' | 'mime_type' | 'storage_path' | 'deleted_at' | 'version_group_id'>
export type VersionWithFile = DeliverableVersion & { file: VersionFile | null }
export type DeliverableWithVersions = Deliverable & { versions: VersionWithFile[] }

/** Clés de la fonctionnalité (hors src/lib/queryKeys.ts, partagé). */
export const deliverableKeys = {
  list: (projectId: string) => ['deliverables', projectId] as const,
  comments: (versionId: string) => ['deliverable-comments', versionId] as const,
  fileUrl: (path: string) => ['deliverable-file-url', path] as const,
}

/** Lien de lecture signé : valable une heure, redemandé avant expiration. */
const SIGNED_URL_SECONDS = 3600

/** Message affichable pour une erreur Supabase ou autre. */
export function deliverableErrorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '42501') return 'Tu n’as pas le droit de faire cette action.'
  return message ? `Une erreur est survenue : ${message}` : 'Une erreur est survenue. Réessaie.'
}

/** Livrables du projet avec leurs versions (et le fichier de chaque version), dans l'ordre. */
export function useDeliverables(projectId: string | undefined) {
  return useQuery({
    queryKey: deliverableKeys.list(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deliverables')
        .select('*, versions:deliverable_versions(*, file:project_files(id, name, mime_type, storage_path, deleted_at, version_group_id))')
        .eq('project_id', projectId ?? '')
        .order('position')
        .order('created_at')
        .overrideTypes<DeliverableWithVersions[], { merge: false }>()
      if (error) throw error
      return data.map((d) => ({ ...d, versions: [...d.versions].sort((a, b) => a.version - b.version) }))
    },
  })
}

export function useVersionComments(versionId: string | undefined) {
  return useQuery({
    queryKey: deliverableKeys.comments(versionId ?? ''),
    enabled: Boolean(versionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deliverable_comments')
        .select('*')
        .eq('version_id', versionId ?? '')
        .order('created_at')
        .overrideTypes<DeliverableComment[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** URL de lecture signée d'un fichier du bucket « files » (lecture permise par les politiques). */
export function useSignedFileUrl(storagePath: string | null | undefined) {
  return useQuery({
    queryKey: deliverableKeys.fileUrl(storagePath ?? ''),
    enabled: Boolean(storagePath),
    staleTime: (SIGNED_URL_SECONDS - 600) * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from('files').createSignedUrl(storagePath ?? '', SIGNED_URL_SECONDS)
      if (error) throw error
      return data.signedUrl
    },
  })
}

export function useCreateDeliverable(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { title: string; description: string | null; position: number }) => {
      const { data, error } = await supabase
        .from('deliverables')
        .insert({ project_id: projectId, title: input.title, description: input.description, position: input.position })
        .select('*')
        .single()
      if (error) throw error
      return data as Deliverable
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: deliverableKeys.list(projectId) }),
  })
}

export function useUpdateDeliverable(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; title: string; description: string | null }) => {
      const { error } = await supabase
        .from('deliverables')
        .update({ title: input.title, description: input.description })
        .eq('id', input.id)
      if (error) throw error
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: deliverableKeys.list(projectId) }),
  })
}

export function useDeleteDeliverable(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('deliverables').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: deliverableKeys.list(projectId) }),
  })
}

export function useUploadVersion(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<UploadVersionInput, 'projectId'>) => uploadDeliverableVersion({ ...input, projectId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: deliverableKeys.list(projectId) }),
  })
}

/** Décision notée par l'équipe (validation reçue par mail, retour arrière). */
export function useSetVersionStatus(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { versionId: string; status: DeliverableVersionStatus; decidedByName: string | null }) => {
      const { error } = await supabase
        .from('deliverable_versions')
        .update({ status: input.status, decided_by_name: input.status === 'pending' ? null : input.decidedByName })
        .eq('id', input.versionId)
      if (error) throw error
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: deliverableKeys.list(projectId) }),
  })
}

export function useAddComment(versionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { x: number | null; y: number | null; body: string }) => {
      const { error } = await supabase.from('deliverable_comments').insert({ version_id: versionId, x: input.x, y: input.y, body: input.body })
      if (error) throw error
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: deliverableKeys.comments(versionId) }),
  })
}

export function useSetCommentResolved(versionId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; resolved: boolean }) => {
      const { error } = await supabase
        .from('deliverable_comments')
        .update({ resolved_at: input.resolved ? new Date().toISOString() : null })
        .eq('id', input.id)
      if (error) throw error
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: deliverableKeys.comments(versionId) }),
  })
}
