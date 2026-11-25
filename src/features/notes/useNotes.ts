import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { NoteVisibility } from '../../shared/types'
import type { NotePatch, NoteWithLinks } from './noteLogic'

/** Clés des notes (définies ici : queryKeys.ts n'est pas modifié). */
export const noteKeys = {
  all: () => ['notes'] as const,
  /** projectId vide = toutes les notes visibles. */
  list: (projectId: string) => ['notes', 'list', projectId] as const,
  linkOptions: () => ['notes', 'link-options'] as const,
}

const NOTE_SELECT = '*, author:members(id, name), project:projects(id, name), client:clients(id, name)'

/** Message d'erreur affichable pour une erreur Supabase ou autre. */
export function noteErrorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : ''
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === '42501') return 'Tu n’as pas le droit de modifier cette note.'
  if (code === '23514' && message) return message
  return message ? `Une erreur est survenue : ${message}` : 'Une erreur est survenue. Réessaie.'
}

/** Notes visibles (la RLS filtre perso / équipe), d'un projet si projectId est donné. */
export function useNotes(projectId?: string) {
  return useQuery({
    queryKey: noteKeys.list(projectId ?? ''),
    queryFn: async () => {
      let request = supabase.from('notes').select(NOTE_SELECT)
      if (projectId) request = request.eq('project_id', projectId)
      const { data, error } = await request
        .order('pinned', { ascending: false })
        .order('updated_at', { ascending: false })
        .overrideTypes<NoteWithLinks[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

export interface LinkOption {
  id: string
  name: string
}

/** Projets et clients proposés au rattachement (rôles qui les lisent seulement). */
export function useNoteLinkOptions(enabled: boolean) {
  return useQuery({
    queryKey: noteKeys.linkOptions(),
    enabled,
    queryFn: async () => {
      const [projects, clients] = await Promise.all([
        supabase.from('projects').select('id, name').order('name').overrideTypes<LinkOption[], { merge: false }>(),
        supabase.from('clients').select('id, name').is('archived_at', null).order('name').overrideTypes<LinkOption[], { merge: false }>(),
      ])
      if (projects.error) throw projects.error
      if (clients.error) throw clients.error
      return { projects: projects.data, clients: clients.data }
    },
  })
}

/** Remplace une note dans toutes les listes en cache (sans refetch : le brouillon en cours n'est pas écrasé). */
function replaceInCache(queryClient: QueryClient, note: NoteWithLinks) {
  queryClient.setQueriesData<NoteWithLinks[]>({ queryKey: noteKeys.all() }, (list) =>
    Array.isArray(list) ? list.map((n) => (n.id === note.id ? note : n)) : list,
  )
}

export interface NewNote {
  organizationId: string
  visibility: NoteVisibility
  projectId: string | null
  clientId: string | null
  title?: string
}

export function useCreateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: NewNote) => {
      const { data, error } = await supabase
        .from('notes')
        .insert({
          organization_id: input.organizationId,
          visibility: input.visibility,
          project_id: input.projectId,
          client_id: input.clientId,
          title: input.title ?? '',
        })
        .select(NOTE_SELECT)
        .single<NoteWithLinks>()
      if (error) throw error
      return data
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: noteKeys.all() }),
  })
}

export function useUpdateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: NotePatch & { pinned?: boolean } }) => {
      const { data, error } = await supabase.from('notes').update(patch).eq('id', id).select(NOTE_SELECT).single<NoteWithLinks>()
      if (error) throw error
      return data
    },
    onSuccess: (note, variables) => {
      replaceInCache(queryClient, note)
      // Rattachement changé : la note entre ou sort de la liste d'un projet.
      if ('project_id' in variables.patch) void queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })
    },
  })
}

export function useDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notes').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: noteKeys.all() }),
  })
}
