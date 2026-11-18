import { useParams } from 'react-router-dom'
import { EmptyState } from '../../components/ui'

export function TicketsTab() {
  const { projectId } = useParams()
  return <EmptyState title="Bientôt disponible" text={`Onglet Tickets (projet ${projectId})`} />
}
