import { Link } from 'react-router-dom'
import { EmptyState } from '../components/ui'

export function NotFoundPage() {
  return (
    <EmptyState title="Page introuvable" text="Cette adresse n'existe pas." action={<Link to="/">Retour aux projets</Link>} />
  )
}
