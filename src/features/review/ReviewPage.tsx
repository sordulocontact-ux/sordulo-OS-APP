import { useParams } from 'react-router-dom'
import { EmptyState } from '../../components/ui'

export function ReviewPage() {
  const { projectId, inputId } = useParams()
  return <EmptyState title="Bientôt disponible" text={`Validation des tickets (projet ${projectId}, entrée ${inputId})`} />
}
