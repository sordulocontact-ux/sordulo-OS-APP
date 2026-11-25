import { Badge, Button, Modal } from '../../components/ui'
import type { ProjectFile } from '../../shared/types'
import { formatFileDate } from './format'
import { formatSize, versionHistory } from './fileLogic'
import styles from './files.module.css'

export interface FileHistoryModalProps {
  /** Une version du fichier dont on veut l'historique (null = fermé). */
  file: ProjectFile | null
  files: readonly ProjectFile[]
  authorName: (memberId: string | null) => string
  onPreview: (file: ProjectFile) => void
  onClose: () => void
}

/** Versions d'un fichier (version_group_id) avec ce qui change d'une version à l'autre. */
export function FileHistoryModal({ file, files, authorName, onPreview, onClose }: FileHistoryModalProps) {
  const versions = file ? versionHistory(files, file.version_group_id) : []
  return (
    <Modal open={file !== null} onClose={onClose} title={file ? `Versions de ${versions[0]?.name ?? file.name}` : 'Versions'}>
      <ol className={styles.history}>
        {versions.map((version) => (
          <li key={version.id} className={styles.historyItem}>
            <div className={styles.historyHead}>
              <Badge tone={version.deleted_at ? 'neutral' : 'primary'}>V{version.version}</Badge>
              <span className={styles.historyMeta}>
                {formatFileDate(version.created_at)} · {authorName(version.uploaded_by)}
                {version.size_bytes !== null ? ` · ${formatSize(version.size_bytes)}` : ''}
              </span>
              {version.deleted_at ? <Badge tone="warning">Corbeille</Badge> : null}
              <span className={styles.historyAction}>
                <Button size="sm" variant="ghost" onClick={() => onPreview(version)}>
                  Aperçu
                </Button>
              </span>
            </div>
            <p className={styles.historyChange}>{version.change_summary ?? (version.version === 1 ? 'Première version.' : 'Aucun résumé des changements.')}</p>
          </li>
        ))}
      </ol>
    </Modal>
  )
}
