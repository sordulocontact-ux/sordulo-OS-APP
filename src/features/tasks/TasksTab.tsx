import { useParams } from 'react-router-dom'
import { EmptyState } from '../../components/ui'

export function TasksTab() {
  const { projectId } = useParams()
  return <EmptyState title="Bientôt disponible" text={`Onglet Tâches (projet ${projectId})`} />
}
