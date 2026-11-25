import fileTextIcon from '../../assets/icons/file-text.svg'
import { supabase } from '../../lib/supabase'
import { CLIENT_READ_ROLES } from '../auth/roles'
import { GROUP_LIMIT, orIlike } from '../search/searchLogic'
import type { SearchResult, SearchSource } from '../search/types'

interface Row {
  id: string
  name: string
  summary: string | null
  folder: string
  project_id: string
  project: { name: string } | null
}

/** Lien de l'onglet Fichiers du projet qui ouvre l'aperçu du fichier. */
export function filePath(projectId: string, fileId: string): string {
  return `/projects/${projectId}/files?file=${fileId}`
}

/** Source Cmd+K « Fichiers » : nom et résumé des fichiers rangés (corbeille exclue). À enregistrer avec registerSearchSource. */
export const filesSearchSource: SearchSource = {
  id: 'files',
  label: 'Fichiers',
  roles: CLIENT_READ_ROLES,
  order: 70,
  async search(query, ctx) {
    const { data, error } = await supabase
      .from('project_files')
      .select('id, name, summary, folder, project_id, project:projects(name)')
      .is('deleted_at', null)
      .or(orIlike(['name', 'summary'], query))
      .order('created_at', { ascending: false })
      .limit(GROUP_LIMIT)
      .abortSignal(ctx.signal)
      .overrideTypes<Row[], { merge: false }>()
    if (ctx.signal.aborted) throw new DOMException('Recherche annulée', 'AbortError')
    if (error) throw new Error(error.message)
    return data.map<SearchResult>((row) => ({
      id: row.id,
      title: row.name,
      subtitle: [row.project?.name, row.folder].filter(Boolean).join(' · ') || undefined,
      to: filePath(row.project_id, row.id),
      icon: fileTextIcon,
    }))
  },
}
