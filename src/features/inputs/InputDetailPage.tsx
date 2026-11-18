import { useParams } from 'react-router-dom'
import { EmptyState } from '../../components/ui'

export function InputDetailPage() {
  const { projectId, inputId } = useParams()
  return <EmptyState title="Bientôt disponible" text={`Détail de l'entrée (projet ${projectId}, entrée ${inputId})`} />
}
