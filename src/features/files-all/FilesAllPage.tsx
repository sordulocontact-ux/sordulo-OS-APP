import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, Field, ListToolbar, LoadingState, Select, Spinner } from '../../components/ui'
import table from '../../components/ui/dataTable.module.css'
import { FILE_KINDS, LABELS } from '../../shared/types'
import { useCurrentMember } from '../auth/useCurrentMember'
import { useOrgMembers } from '../auth/useOrgMembers'
import { formatSize, kindLabel, versionLabel } from '../files/fileLogic'
import { FilePreviewModal } from '../files/FilePreviewModal'
import { filePath } from '../files/filesSearch'
import { formatFileDate } from '../files/format'
import { openFileDrop } from '../files/openFileDrop'
import { useFilingDirectory } from '../files/useFiles'
import {
  EMPTY_FILTERS,
  activeFilterCount,
  countLabel,
  folderOptions,
  hasAnyFilter,
  pendingLabel,
  projectIdsFilter,
  projectOptions,
  sortRows,
  type FileFilters,
  type FileRow,
  type SortDirection,
  type SortKey,
} from './filesAllLogic'
import { useAllFiles, usePendingIntakeCount } from './useAllFiles'
import styles from './filesAll.module.css'

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Nom' },
  { key: 'kind', label: 'Type' },
  { key: 'project', label: 'Projet' },
  { key: 'client', label: 'Client' },
  { key: 'folder', label: 'Dossier' },
  { key: 'size', label: 'Taille' },
  { key: 'date', label: 'Date' },
]

/** Tous les fichiers rangés de l'agence : recherche, filtres, tableau triable, aperçu. */
export function FilesAllPage() {
  const { member, organization } = useCurrentMember()
  const organizationId = organization?.id
  const { data: members } = useOrgMembers(organizationId)
  const { data: directory } = useFilingDirectory(organizationId)
  const [filters, setFilters] = useState<FileFilters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'date', direction: 'desc' })
  const [previewed, setPreviewed] = useState<FileRow | null>(null)

  const projects = directory?.projects
  const projectIds = useMemo(() => (projects ? projectIdsFilter(projects, filters) : null), [projects, filters])
  // Tant que l'annuaire n'est pas là, un filtre client ne peut pas être traduit : on attend.
  const waitingDirectory = filters.clientId !== '' && !directory
  const files = useAllFiles(waitingDirectory ? undefined : organizationId, filters, projectIds)
  const pending = usePendingIntakeCount(organizationId, member?.id, member?.role === 'admin')

  const sorted = useMemo(() => sortRows(files.rows, sort.key, sort.direction), [files.rows, sort])
  const folders = useMemo(() => folderOptions(files.rows), [files.rows])
  const authors = useMemo(() => new Map((members ?? []).map((m) => [m.id, m.name])), [members])

  function set<K extends keyof FileFilters>(key: K, value: FileFilters[K]) {
    setFilters((current) => {
      const next = { ...current, [key]: value }
      // Changer de client invalide un projet d'un autre client.
      if (key === 'clientId') next.projectId = ''
      return next
    })
  }

  function toggleSort(key: SortKey) {
    setSort((current) => (current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'date' || key === 'size' ? 'desc' : 'asc' }))
  }

  const filtered = hasAnyFilter(filters)
  const loading = files.isLoading || waitingDirectory

  return (
    <section className={table.page} aria-labelledby="files-all-title">
      <h1 id="files-all-title">Fichiers</h1>

      {pending.data ? (
        <Link to="/files/inbox" className={styles.pending}>
          <Badge tone="warning">{pending.data}</Badge>
          <span>{pendingLabel(pending.data)}</span>
          <span className={styles.pendingHint}>Voir la boîte de dépôt</span>
        </Link>
      ) : null}

      <ListToolbar
        search={{ value: filters.query, onChange: (value) => set('query', value), label: 'Rechercher un fichier', placeholder: 'Nom ou résumé' }}
        activeFilterCount={activeFilterCount(filters)}
        onResetFilters={() => setFilters((current) => ({ ...EMPTY_FILTERS, query: current.query }))}
        onAdd={() => openFileDrop()}
        addLabel="Déposer un fichier"
        filters={
          <>
            <Field label="Client">
              <Select value={filters.clientId} onChange={(e) => set('clientId', e.target.value)}>
                <option value="">Tous les clients</option>
                {(directory?.clients ?? []).map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Projet">
              <Select value={filters.projectId} onChange={(e) => set('projectId', e.target.value)}>
                <option value="">Tous les projets</option>
                {projectOptions(directory?.projects ?? [], filters.clientId).map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Type de fichier">
              <Select value={filters.kind} onChange={(e) => set('kind', e.target.value)}>
                <option value="">Tous les types</option>
                {FILE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {LABELS.fileKind[kind]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Dossier">
              <Select value={filters.folder} onChange={(e) => set('folder', e.target.value)}>
                <option value="">Tous les dossiers</option>
                {folders.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        }
      />

      {loading ? (
        <LoadingState label="Chargement des fichiers…" />
      ) : files.isError ? (
        <ErrorState message="Impossible de charger les fichiers." onRetry={() => void files.refetch()} />
      ) : sorted.length === 0 ? (
        filtered ? (
          <EmptyState title="Aucun fichier ne correspond à la recherche ni aux filtres." />
        ) : (
          <EmptyState
            title="Aucun fichier rangé"
            text="Dépose un devis, une facture ou une maquette : l'IA propose le projet et le dossier."
            action={<Button onClick={() => openFileDrop()}>Déposer un fichier</Button>}
          />
        )
      ) : (
        <>
          <p className={styles.count} aria-live="polite">
            {countLabel(sorted.length, files.total)}
          </p>
          <div className={table.scroll}>
            <table className={`${table.table} ${styles.wide}`}>
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      <button type="button" className={styles.sortButton} onClick={() => toggleSort(column.key)}>
                        {column.label}
                        {sort.key === column.key ? <span aria-hidden="true">{sort.direction === 'asc' ? ' ↑' : ' ↓'}</span> : null}
                      </button>
                    </th>
                  ))}
                  <th scope="col">Version</th>
                  <th scope="col">Auteur</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((file) => (
                  <tr key={file.id} className={table.row}>
                    <td>
                      <button type="button" className={`${table.rowLink} ${styles.nameButton}`} onClick={() => setPreviewed(file)} title={file.summary ?? undefined}>
                        {file.name}
                      </button>
                    </td>
                    <td>
                      <Badge>{kindLabel(file.kind)}</Badge>
                    </td>
                    <td>
                      <Link to={filePath(file.project_id, file.id)} className={styles.projectLink}>
                        {file.project?.name ?? 'Projet'}
                      </Link>
                    </td>
                    <td>{file.project?.client?.name ?? <span className={table.muted}>Aucun</span>}</td>
                    <td>{file.folder}</td>
                    <td className={styles.numeric}>{formatSize(file.size_bytes)}</td>
                    <td>{formatFileDate(file.created_at)}</td>
                    <td>{versionLabel(file.version) || <span className={table.muted}>V1</span>}</td>
                    <td>{file.uploaded_by ? (authors.get(file.uploaded_by) ?? <span className={table.muted}>Inconnu</span>) : <span className={table.muted}>Aucun</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {files.hasNextPage ? (
            <div className={styles.more}>
              <Button variant="secondary" onClick={() => void files.fetchNextPage()} disabled={files.isFetchingNextPage}>
                {files.isFetchingNextPage ? <Spinner /> : null}
                Charger les 100 suivants
              </Button>
            </div>
          ) : null}
        </>
      )}

      <FilePreviewModal file={previewed} onClose={() => setPreviewed(null)} />
    </section>
  )
}
