import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { getFile } from '../../lib/filing'
import type { DirectoryProject } from './fileLogic'
import { filesKeys } from './keys'
import { listProjectFiles, signedFileUrl } from './projectFiles'

export function useProjectFiles(projectId: string | undefined) {
  return useQuery({
    queryKey: filesKeys.project(projectId ?? ''),
    enabled: Boolean(projectId),
    queryFn: () => listProjectFiles(projectId ?? ''),
  })
}

export interface FilingDirectory {
  clients: { id: string; name: string }[]
  projects: DirectoryProject[]
}

/** Clients et projets de l'organisation (listes de l'écran de rangement, noms des libellés). */
export function useFilingDirectory(organizationId: string | undefined) {
  return useQuery({
    queryKey: filesKeys.directory(organizationId ?? ''),
    enabled: Boolean(organizationId),
    staleTime: 60_000,
    queryFn: async (): Promise<FilingDirectory> => {
      const [clients, projects] = await Promise.all([
        supabase.from('clients').select('id, name').order('name').overrideTypes<{ id: string; name: string }[], { merge: false }>(),
        supabase
          .from('projects')
          .select('id, name, client_id')
          .order('name')
          .overrideTypes<DirectoryProject[], { merge: false }>(),
      ])
      if (clients.error) throw clients.error
      if (projects.error) throw projects.error
      return { clients: clients.data, projects: projects.data }
    },
  })
}

/** URL signée d'un objet du bucket, valable 2 minutes (relue au besoin). */
export function useSignedUrl(path: string | null) {
  return useQuery({
    queryKey: filesKeys.signed(path ?? ''),
    enabled: Boolean(path),
    staleTime: 60_000,
    gcTime: 60_000,
    queryFn: () => signedFileUrl(path ?? ''),
  })
}

/** Un fichier rangé par son id (lien d'un doublon, version précédente). */
export function useProjectFile(fileId: string | null | undefined) {
  return useQuery({
    queryKey: [...filesKeys.all, 'one', fileId ?? ''] as const,
    enabled: Boolean(fileId),
    queryFn: () => getFile(fileId ?? ''),
  })
}

export interface LinkedDocument {
  id: string
  label: string
}

/** Devis et factures d'un projet (lisibles par admin et finance ; les autres rôles reçoivent des listes vides). */
export function useProjectDocuments(projectId: string | undefined) {
  return useQuery({
    queryKey: filesKeys.projectDocuments(projectId ?? ''),
    enabled: Boolean(projectId),
    staleTime: 60_000,
    queryFn: async () => {
      const [quotes, invoices] = await Promise.all([
        supabase.from('quotes').select('id, number, title').eq('project_id', projectId ?? '').order('created_at', { ascending: false }),
        supabase.from('invoices').select('id, number, title').eq('project_id', projectId ?? '').order('created_at', { ascending: false }),
      ])
      const label = (row: { number: string | null; title: string }) => [row.number, row.title].filter(Boolean).join(' · ')
      const toDocs = (rows: { id: string; number: string | null; title: string }[] | null): LinkedDocument[] =>
        (rows ?? []).map((row) => ({ id: row.id, label: label(row) }))
      return { quotes: quotes.error ? [] : toDocs(quotes.data), invoices: invoices.error ? [] : toDocs(invoices.data) }
    },
  })
}
