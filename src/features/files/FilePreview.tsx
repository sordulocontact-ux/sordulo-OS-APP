import { ErrorState, LoadingState } from '../../components/ui'
import { previewKind } from './fileLogic'
import { useSignedUrl } from './useFiles'
import styles from './files.module.css'

export interface FilePreviewProps {
  storagePath: string
  name: string
  mimeType: string | null
}

/** Aperçu dans le navigateur : image ou PDF (URL signée courte). Les autres formats se téléchargent. */
export function FilePreview({ storagePath, name, mimeType }: FilePreviewProps) {
  const kind = previewKind(name, mimeType)
  const { data: url, isLoading, isError, refetch } = useSignedUrl(kind === 'none' ? null : storagePath)

  if (kind === 'none') return <p className={styles.noPreview}>Pas d’aperçu pour ce type de fichier. Télécharge-le pour l’ouvrir.</p>
  if (isLoading) return <LoadingState label="Chargement de l’aperçu…" />
  if (isError || !url) return <ErrorState message="Impossible d’afficher l’aperçu." onRetry={() => void refetch()} />
  if (kind === 'image') return <img src={url} alt={name} className={styles.previewImage} />
  return <iframe src={url} title={`Aperçu de ${name}`} className={styles.previewFrame} />
}
