import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ActionsMenu, Badge, Button, EmptyState, ErrorState, LoadingState, Modal, Select, Spinner, useToast, type ActionsMenuItem } from '../../components/ui'
import tableStyles from '../../components/ui/dataTable.module.css'
import { filingKeys } from '../../lib/filing'
import { LABELS, type ProjectFile } from '../../shared/types'
import { useCurrentMember } from '../auth/useCurrentMember'
import { useOrgMembers } from '../auth/useOrgMembers'
import { useHasRole, FINANCE_ROLES } from '../auth/roles'
import { dragHasFiles, filesFromDrop } from '../inputs/documentText'
import { useProjectContext } from '../projects/useProjectContext'
import { EditFileModal } from './EditFileModal'
import { FileHistoryModal } from './FileHistoryModal'
import { FilePreviewModal } from './FilePreviewModal'
import { UploadConflictModal, type ConflictAction, type UploadConflict } from './UploadConflictModal'
import {
  FILE_SORT_LABELS,
  fileErrorText,
  filesInFolder,
  folderCounts,
  folderList,
  formatSize,
  kindForFolder,
  planUpload,
  planUploadAsVersion,
  trashedFiles,
  versionHistory,
  versionLabel,
  type FileSort,
} from './fileLogic'
import { formatFileDate } from './format'
import { filesKeys } from './keys'
import {
  deleteProjectFile,
  downloadProjectFile,
  hashFile,
  restoreProjectFile,
  trashProjectFile,
  updateProjectFile,
  uploadProjectFile,
} from './projectFiles'
import { useProjectFiles } from './useFiles'
import styles from './files.module.css'

/** Entrée spéciale de la liste des dossiers. */
const TRASH = '\u0000trash'
const FALLBACK_FOLDER = 'Divers'

/** Onglet « Fichiers » de la page projet : dossiers, envoi direct, aperçu, versions, corbeille. */
export function ProjectFilesTab() {
  const { project } = useProjectContext()
  const { organization } = useCurrentMember()
  const { data: members } = useOrgMembers(organization?.id)
  const { data: files, isLoading, isError, refetch } = useProjectFiles(project.id)
  const queryClient = useQueryClient()
  const toast = useToast()
  const canOpenDocuments = useHasRole(FINANCE_ROLES)
  const [searchParams, setSearchParams] = useSearchParams()

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null)
  const [sort, setSort] = useState<FileSort>('recent')
  const [historyFile, setHistoryFile] = useState<ProjectFile | null>(null)
  const [editFile, setEditFile] = useState<ProjectFile | null>(null)
  const [deleteFile, setDeleteFile] = useState<ProjectFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [conflicts, setConflicts] = useState<UploadConflict[]>([])
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [pickInput, setPickInput] = useState<HTMLInputElement | null>(null)
  /** Fichier dont le prochain envoi est une nouvelle version. */
  const [versionTarget, setVersionTarget] = useState<ProjectFile | null>(null)

  const all = files ?? []
  const folders = folderList(all)
  const counts = folderCounts(all)
  const trashed = trashedFiles(all)

  const previewId = searchParams.get('file')
  const previewFile = previewId ? (all.find((file) => file.id === previewId) ?? null) : null
  // Dossier affiché : le choix de l'utilisateur, sinon celui du fichier ouvert par ?file=, sinon le premier non vide.
  const firstFilled = folders.find((name) => (counts.get(name) ?? 0) > 0) ?? folders[0] ?? FALLBACK_FOLDER
  const folder = selectedFolder ?? (previewFile ? (previewFile.deleted_at ? TRASH : previewFile.folder) : firstFilled)
  const inTrash = folder === TRASH
  const rows = inTrash ? trashed : filesInFolder(all, folder, sort)

  const authorName = (memberId: string | null) => members?.find((member) => member.id === memberId)?.name ?? 'Inconnu'

  function openPreview(file: ProjectFile) {
    setHistoryFile(null)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('file', file.id)
      return next
    })
  }

  function closePreview() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('file')
      return next
    })
  }

  async function refresh() {
    await Promise.all([queryClient.invalidateQueries({ queryKey: filesKeys.project(project.id) }), queryClient.invalidateQueries({ queryKey: filingKeys.all })])
  }

  async function act(success: string, task: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    try {
      await task()
      await refresh()
      if (success) toast.success(success)
      return true
    } catch (error) {
      toast.error(fileErrorText(error))
      return false
    } finally {
      setBusy(false)
    }
  }

  /* ---------- Envoi ---------- */

  async function uploadAll(
    items: { file: File; sha256: string; folder: string; kind: ProjectFile['kind']; versionGroupId: string | null }[],
  ) {
    if (!organization || items.length === 0) return
    setUploading({ done: 0, total: items.length })
    let sent = 0
    const errors: string[] = []
    for (const item of items) {
      try {
        await uploadProjectFile(item.file, item.sha256, {
          organizationId: organization.id,
          projectId: project.id,
          folder: item.folder,
          kind: item.kind,
          versionGroupId: item.versionGroupId,
        })
        sent++
      } catch (error) {
        errors.push(fileErrorText(error))
      }
      setUploading({ done: sent + errors.length, total: items.length })
    }
    setUploading(null)
    await refresh()
    if (sent > 0) toast.success(sent === 1 ? 'Fichier envoyé.' : `${sent} fichiers envoyés.`)
    if (errors.length > 0) toast.error(errors.length === 1 ? errors[0]! : `${errors.length} envois ont échoué : ${errors[0]}`)
  }

  async function startUpload(selected: File[]) {
    if (selected.length === 0 || !organization) return
    const target = versionTarget
    setVersionTarget(null)
    const targetFolder = inTrash ? FALLBACK_FOLDER : folder
    const ready: Parameters<typeof uploadAll>[0] = []
    const pending: UploadConflict[] = []
    try {
      for (const file of selected) {
        const sha256 = await hashFile(file)
        const plan = target ? planUploadAsVersion(all, target, sha256) : planUpload(all, { name: file.name, sha256 })
        if (plan.type === 'new') ready.push({ file, sha256, folder: targetFolder, kind: kindForFolder(targetFolder), versionGroupId: null })
        else if (plan.type === 'version' && target)
          ready.push({ file, sha256, folder: plan.file.folder, kind: plan.file.kind, versionGroupId: plan.file.version_group_id })
        else pending.push({ id: crypto.randomUUID(), file, sha256, plan })
      }
    } catch (error) {
      toast.error(fileErrorText(error))
      return
    }
    setConflicts(pending)
    await uploadAll(ready)
  }

  async function confirmConflicts(decisions: Map<string, ConflictAction>) {
    const targetFolder = inTrash ? FALLBACK_FOLDER : folder
    const items: Parameters<typeof uploadAll>[0] = []
    for (const conflict of conflicts) {
      const action = decisions.get(conflict.id) ?? 'skip'
      if (action === 'skip') continue
      if (action === 'version')
        items.push({
          file: conflict.file,
          sha256: conflict.sha256,
          folder: conflict.plan.file.folder,
          kind: conflict.plan.file.kind,
          versionGroupId: conflict.plan.file.version_group_id,
        })
      else items.push({ file: conflict.file, sha256: conflict.sha256, folder: targetFolder, kind: kindForFolder(targetFolder), versionGroupId: null })
    }
    setConflicts([])
    await uploadAll(items)
  }

  function pickFiles(target: ProjectFile | null) {
    setVersionTarget(target)
    pickInput?.click()
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? [])
    event.target.value = ''
    void startUpload(selected)
  }

  function onDragEnter(event: DragEvent) {
    if (!dragHasFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  function onDragOver(event: DragEvent) {
    if (!dragHasFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(event: DragEvent) {
    if (!dragHasFiles(event.dataTransfer)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  function onDrop(event: DragEvent) {
    if (!dragHasFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    setVersionTarget(null)
    void filesFromDrop(event.dataTransfer).then(startUpload)
  }

  /* ---------- Menu d'une ligne ---------- */

  function menuItems(file: ProjectFile): ActionsMenuItem[] {
    if (file.deleted_at) {
      return [
        { label: 'Restaurer', onSelect: () => void act('Fichier restauré.', () => restoreProjectFile(file.id)) },
        { label: 'Supprimer définitivement', tone: 'danger', onSelect: () => setDeleteFile(file) },
      ]
    }
    const items: ActionsMenuItem[] = [
      { label: 'Aperçu', onSelect: () => openPreview(file) },
      {
        label: 'Télécharger',
        onSelect: () => void downloadProjectFile(file.storage_path, file.name).catch((error: unknown) => toast.error(fileErrorText(error))),
      },
      { label: 'Nouvelle version…', onSelect: () => pickFiles(file) },
    ]
    if (file.version > 1 || versionHistory(all, file.version_group_id).length > 1) {
      items.push({ label: 'Historique des versions', onSelect: () => setHistoryFile(file) })
    }
    items.push(
      { label: 'Renommer ou déplacer', onSelect: () => setEditFile(file) },
      { label: 'Mettre à la corbeille', tone: 'danger', onSelect: () => void act('Fichier mis à la corbeille.', () => trashProjectFile(file.id)) },
    )
    return items
  }

  /* ---------- Rendu ---------- */

  if (isLoading) return <LoadingState label="Chargement des fichiers…" />
  if (isError) return <ErrorState message="Impossible de charger les fichiers." onRetry={() => void refetch()} />

  const documentLink = (file: ProjectFile) => {
    const target = file.quote_id ? { label: 'Devis lié', to: `/quotes/${file.quote_id}` } : file.invoice_id ? { label: 'Facture liée', to: `/invoices/${file.invoice_id}` } : null
    if (!target) return null
    return canOpenDocuments ? (
      <Link to={target.to} className={styles.docLink}>
        {target.label}
      </Link>
    ) : (
      <span className={styles.muted}>{target.label}</span>
    )
  }

  return (
    <section
      className={styles.page}
      aria-labelledby="files-title"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={styles.header}>
        <h2 id="files-title" className={styles.title}>
          Fichiers
        </h2>
        <div className={styles.actions}>
          {!inTrash ? (
            <Select aria-label="Trier les fichiers" value={sort} onChange={(event) => setSort(event.target.value as FileSort)}>
              {(Object.keys(FILE_SORT_LABELS) as FileSort[]).map((key) => (
                <option key={key} value={key}>
                  {FILE_SORT_LABELS[key]}
                </option>
              ))}
            </Select>
          ) : null}
          <Button variant="primary" onClick={() => pickFiles(null)} disabled={uploading !== null}>
            Envoyer des fichiers
          </Button>
        </div>
      </div>
      <input ref={setPickInput} type="file" multiple className={styles.hiddenInput} onChange={onPick} tabIndex={-1} aria-hidden="true" />
      {uploading ? (
        <p className={styles.progress} aria-live="polite">
          <Spinner label="" />
          Envoi : {uploading.done} sur {uploading.total}
        </p>
      ) : (
        <p className={styles.hint}>Glisse des fichiers ici pour les ranger dans « {inTrash ? FALLBACK_FOLDER : folder} ».</p>
      )}

      <div className={styles.layout}>
        <nav className={styles.folders} aria-label="Dossiers">
          {folders.map((name) => (
            <button
              key={name}
              type="button"
              className={styles.folder}
              aria-current={folder === name ? 'true' : undefined}
              onClick={() => setSelectedFolder(name)}
            >
              <span className={styles.folderName}>{name}</span>
              <span className={styles.count}>{counts.get(name) ?? 0}</span>
            </button>
          ))}
          <button type="button" className={styles.folder} aria-current={inTrash ? 'true' : undefined} onClick={() => setSelectedFolder(TRASH)}>
            <span className={styles.folderName}>Corbeille</span>
            <span className={styles.count}>{trashed.length}</span>
          </button>
        </nav>

        <div className={styles.list}>
          {rows.length === 0 ? (
            <EmptyState
              title={inTrash ? 'La corbeille est vide' : `Aucun fichier dans « ${folder} »`}
              text={inTrash ? 'Les fichiers mis à la corbeille restent ici jusqu’à leur suppression définitive.' : 'Envoie un fichier ou glisse-le dans cette page.'}
              action={
                inTrash ? null : (
                  <Button onClick={() => pickFiles(null)} disabled={uploading !== null}>
                    Envoyer des fichiers
                  </Button>
                )
              }
            />
          ) : (
            <div className={tableStyles.scroll}>
              <table className={tableStyles.table}>
                <thead>
                  <tr>
                    <th scope="col" className={styles.colName}>
                      Nom
                    </th>
                    <th scope="col">Type</th>
                    <th scope="col">Taille</th>
                    <th scope="col">{inTrash ? 'Supprimé le' : 'Ajouté'}</th>
                    <th scope="col" className={tableStyles.actionsCell}>
                      <span className={styles.srOnly}>Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((file) => (
                    <tr key={file.id} className={tableStyles.row}>
                      <td>
                        <div className={styles.nameCell}>
                          {file.deleted_at ? (
                            <span className={tableStyles.primary}>{file.name}</span>
                          ) : (
                            <button type="button" className={styles.nameButton} onClick={() => openPreview(file)}>
                              {file.name}
                            </button>
                          )}
                          {versionLabel(file.version) ? <Badge tone="primary">{versionLabel(file.version)}</Badge> : null}
                        </div>
                        {file.summary ? <span className={tableStyles.secondLine}>{file.summary}</span> : null}
                        {documentLink(file)}
                      </td>
                      <td>
                        <Badge>{LABELS.fileKind[file.kind]}</Badge>
                      </td>
                      <td>{formatSize(file.size_bytes)}</td>
                      <td>
                        {formatFileDate(file.deleted_at ?? file.created_at)}
                        <span className={tableStyles.secondLine}>{authorName(file.uploaded_by)}</span>
                      </td>
                      <td className={tableStyles.actionsCell}>
                        <ActionsMenu label={`Actions pour ${file.name}`} items={menuItems(file)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {dragging ? <div className={styles.dropOverlay}>Dépose les fichiers pour les envoyer</div> : null}

      <FilePreviewModal file={previewFile} onClose={closePreview} />
      <FileHistoryModal file={historyFile} files={all} authorName={authorName} onPreview={openPreview} onClose={() => setHistoryFile(null)} />
      <EditFileModal
        file={editFile}
        folders={folders}
        busy={busy}
        onClose={() => setEditFile(null)}
        onSave={(file, changes) => {
          void act('Fichier modifié.', () => updateProjectFile(file.id, changes)).then((ok) => {
            if (ok) setEditFile(null)
          })
        }}
      />
      <UploadConflictModal
        conflicts={conflicts}
        busy={uploading !== null}
        onCancel={() => setConflicts([])}
        onConfirm={(decisions) => void confirmConflicts(decisions)}
      />
      <Modal
        open={deleteFile !== null}
        onClose={() => setDeleteFile(null)}
        title="Supprimer définitivement ?"
        dismissible={!busy}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleteFile(null)} disabled={busy}>
              Annuler
            </Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() => {
                const target = deleteFile
                if (!target) return
                void act('Fichier supprimé.', () => deleteProjectFile(target)).then(() => setDeleteFile(null))
              }}
            >
              Supprimer définitivement
            </Button>
          </>
        }
      >
        <p>« {deleteFile?.name} » sera supprimé pour de bon. Un fichier utilisé par un livrable ne peut pas être supprimé.</p>
      </Modal>
    </section>
  )
}
