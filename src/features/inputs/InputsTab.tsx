import { useParams } from 'react-router-dom'
import { EmptyState } from '../../components/ui'

export function InputsTab() {
  const { projectId } = useParams()
  return <EmptyState title="Bientôt disponible" text={`Onglet Entrées (projet ${projectId})`} />
}
