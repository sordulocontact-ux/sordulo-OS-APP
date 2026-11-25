import { useState } from 'react'
import { Button, Modal, useToast } from '../../components/ui'
import type { ProjectFile } from '../../shared/types'
import { FilePreview } from './FilePreview'
import { fileErrorText } from './fileLogic'
import { downloadProjectFile } from './projectFiles'
import styles from './files.module.css'

export interface FilePreviewModalProps {
  file: ProjectFile | null
  onClose: () => void
}

/** Aperçu d'un fichier rangé dans une fenêtre, avec le téléchargement. */
export function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
  const toast = useToast()
  const [downloading, setDownloading] = useState(false)

  async function download() {
    if (!file) return
    setDownloading(true)
    try {
      await downloadProjectFile(file.storage_path, file.name)
    } catch (error) {
      toast.error(fileErrorText(error))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Modal
      open={file !== null}
      onClose={onClose}
      title={file?.name ?? 'Aperçu'}
      actions={
        <Button onClick={() => void download()} loading={downloading}>
          Télécharger
        </Button>
      }
    >
      {file ? (
        <div className={styles.previewBox}>
          <FilePreview storagePath={file.storage_path} name={file.name} mimeType={file.mime_type} />
        </div>
      ) : null}
    </Modal>
  )
}
