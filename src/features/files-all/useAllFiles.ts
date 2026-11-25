import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { PENDING_INTAKE_STATUSES } from '../../lib/filing'
import { supabase } from '../../lib/supabase'
import { orIlike } from '../search/searchLogic'
import { FILES_PAGE_SIZE, mergePages, type FileFilters, type FileRow } from './filesAllLogic'

export const filesAllKeys = {
  list: (orgId: string, filters: FileFilters, projectIds: string[] | null) => ['files-all', 'list', orgId, filters, projectIds] as const,
  pending: (orgId: string, scope: string) => ['files-all', 'pending', orgId, scope] as const,
}

interface Page {
  rows: FileRow[]
  total: number | null
  from: number
}

/** Fichiers rangés de tous les projets visibles, 100 par page. Filtres appliqués côté serveur ; la RLS retire ce qui est réservé. */
export function useAllFiles(organizationId: string | undefined, filters: FileFilters, projectIds: string[] | null) {
  const query = useInfiniteQuery({
    queryKey: filesAllKeys.list(organizationId ?? '', filters, projectIds),
    enabled: Boolean(organizationId),
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<Page> => {
      // Un client sans projet : aucun résultat, sans requête.
      if (projectIds !== null && projectIds.length === 0) return { rows: [], total: 0, from: pageParam }
      let request = supabase
        .from('project_files')
        .select('*, project:projects(name, client_id, client:clients(id, name))', { count: 'exact' })
        .is('deleted_at', null)
      if (projectIds !== null) request = request.in('project_id', projectIds)
      if (filters.kind !== '') request = request.eq('kind', filters.kind)
      if (filters.folder !== '') request = request.eq('folder', filters.folder)
      const text = filters.query.trim()
      if (text !== '') request = request.or(orIlike(['name', 'summary'], text))
      const { data, error, count } = await request
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + FILES_PAGE_SIZE - 1)
        .overrideTypes<FileRow[], { merge: false }>()
      if (error) throw new Error(error.message)
      return { rows: data, total: count, from: pageParam }
    },
    getNextPageParam: (last) => (last.rows.length < FILES_PAGE_SIZE ? undefined : last.from + FILES_PAGE_SIZE),
  })
  const pages = query.data?.pages ?? []
  return {
    ...query,
    rows: mergePages(pages.map((page) => page.rows)),
    total: pages[0]?.total ?? null,
  }
}

/** Nombre de dépôts en attente (les miens ; tous ceux de l'organisation pour un admin). */
export function usePendingIntakeCount(organizationId: string | undefined, memberId: string | undefined, isAdmin: boolean) {
  return useQuery({
    queryKey: filesAllKeys.pending(organizationId ?? '', isAdmin ? 'all' : (memberId ?? '')),
    enabled: Boolean(organizationId && memberId),
    staleTime: 15_000,
    queryFn: async () => {
      let request = supabase
        .from('file_intakes')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId ?? '')
        .in('status', [...PENDING_INTAKE_STATUSES])
      if (!isAdmin) request = request.eq('created_by', memberId ?? '')
      const { count, error } = await request
      if (error) throw new Error(error.message)
      return count ?? 0
    },
  })
}
