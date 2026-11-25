/** Logique pure de la page « Fichiers » de l'agence : filtres, tri, options, résumés. Sans React ni Supabase. */
import { DEFAULT_FOLDERS, type ProjectFile } from '../../shared/types'

export const FILES_PAGE_SIZE = 100

export interface FileRow extends ProjectFile {
  project: { name: string; client_id: string; client: { id: string; name: string } | null } | null
}

export interface FileFilters {
  query: string
  clientId: string
  projectId: string
  kind: string
  folder: string
}

export const EMPTY_FILTERS: FileFilters = { query: '', clientId: '', projectId: '', kind: '', folder: '' }

/** Nombre de filtres de la liste actifs (la recherche a son propre champ, elle n'est pas comptée). */
export function activeFilterCount(filters: FileFilters): number {
  return [filters.clientId, filters.projectId, filters.kind, filters.folder].filter((value) => value !== '').length
}

/** Un filtre appliqué (recherche comprise) : sert à choisir entre « aucun fichier » et « aucun résultat ». */
export function hasAnyFilter(filters: FileFilters): boolean {
  return activeFilterCount(filters) > 0 || filters.query.trim() !== ''
}

/** Projets proposés dans le filtre : ceux du client choisi, sinon tous. */
export function projectOptions<T extends { id: string; name: string; client_id: string | null }>(projects: readonly T[], clientId: string): T[] {
  return projects.filter((project) => clientId === '' || project.client_id === clientId)
}

/** Identifiants de projet à filtrer côté serveur : le projet choisi, sinon ceux du client, sinon null (pas de filtre). */
export function projectIdsFilter(
  projects: readonly { id: string; client_id: string | null }[],
  filters: Pick<FileFilters, 'clientId' | 'projectId'>,
): string[] | null {
  if (filters.projectId !== '') return [filters.projectId]
  if (filters.clientId !== '') return projects.filter((project) => project.client_id === filters.clientId).map((project) => project.id)
  return null
}

/** Dossiers proposés : les dossiers types, puis les dossiers libres vus dans les lignes chargées. */
export function folderOptions(rows: readonly Pick<ProjectFile, 'folder'>[]): string[] {
  const defaults = new Set<string>(DEFAULT_FOLDERS)
  const custom = new Set<string>()
  for (const row of rows) if (!defaults.has(row.folder)) custom.add(row.folder)
  return [...DEFAULT_FOLDERS, ...Array.from(custom).sort((a, b) => a.localeCompare(b, 'fr'))]
}

export type SortKey = 'name' | 'kind' | 'project' | 'client' | 'folder' | 'size' | 'date'
export type SortDirection = 'asc' | 'desc'

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' })

function compareBy(a: FileRow, b: FileRow, key: SortKey): number {
  switch (key) {
    case 'name':
      return collator.compare(a.name, b.name)
    case 'kind':
      return collator.compare(a.kind, b.kind)
    case 'project':
      return collator.compare(a.project?.name ?? '', b.project?.name ?? '')
    case 'client':
      return collator.compare(a.project?.client?.name ?? '', b.project?.client?.name ?? '')
    case 'folder':
      return collator.compare(a.folder, b.folder)
    case 'size':
      return (a.size_bytes ?? 0) - (b.size_bytes ?? 0)
    case 'date':
      return a.created_at.localeCompare(b.created_at)
  }
}

/** Tri stable ; à égalité, le plus récent d'abord. */
export function sortRows(rows: readonly FileRow[], key: SortKey, direction: SortDirection): FileRow[] {
  const sign = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => compareBy(a, b, key) * sign || b.created_at.localeCompare(a.created_at))
}

/** Regroupe les lignes par projet (ordre alphabétique des projets) : sert au résumé et aux tests de répartition. */
export function groupByProject(rows: readonly FileRow[]): { projectId: string; name: string; rows: FileRow[] }[] {
  const groups = new Map<string, { projectId: string; name: string; rows: FileRow[] }>()
  for (const row of rows) {
    const group = groups.get(row.project_id) ?? { projectId: row.project_id, name: row.project?.name ?? 'Projet', rows: [] }
    group.rows.push(row)
    groups.set(row.project_id, group)
  }
  return Array.from(groups.values()).sort((a, b) => collator.compare(a.name, b.name))
}

/** Ajoute une page de résultats sans doublon (une ligne ne passe jamais deux fois). */
export function mergePages(pages: readonly (readonly FileRow[])[]): FileRow[] {
  const seen = new Set<string>()
  const merged: FileRow[] = []
  for (const page of pages) {
    for (const row of page) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      merged.push(row)
    }
  }
  return merged
}

/** « 100 fichiers sur 230 », « 1 fichier », « 3 fichiers ». */
export function countLabel(loaded: number, total: number | null): string {
  const noun = (n: number) => `${n} fichier${n > 1 ? 's' : ''}`
  if (total !== null && total > loaded) return `${loaded} fichiers sur ${total}`
  return noun(loaded)
}

/** « 1 dépôt en attente », « 3 dépôts en attente ». */
export function pendingLabel(count: number): string {
  return `${count} dépôt${count > 1 ? 's' : ''} en attente`
}
