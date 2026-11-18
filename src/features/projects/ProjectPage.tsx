/*
 * Choix de données : ProjectPage charge le projet via useProject(projectId) et le transmet
 * aux onglets enfants par <Outlet context={{ project }} /> (lu avec useProjectContext()).
 * Les pages hors de cet Outlet (InputDetailPage, ReviewPage) lisent projectId dans l'URL et
 * appellent useProject(projectId) : même clé de requête, donc servi par le cache TanStack Query.
 */
import { Link, Outlet, useParams } from 'react-router-dom'
import { BackLink, EmptyState, ErrorState, LoadingState, Tabs, type TabItem } from '../../components/ui'
import { useProject } from './useProject'
import type { ProjectOutletContext } from './useProjectContext'
import styles from './ProjectPage.module.css'

const TABS: TabItem[] = [
  { to: 'tickets', label: 'Tickets' },
  { to: 'tasks', label: 'Tâches' },
  { to: 'inputs', label: 'Entrées' },
]

export function ProjectPage() {
  const { projectId } = useParams()
  const { data: project, isLoading, isError, refetch } = useProject(projectId)

  if (isLoading) return <LoadingState label="Chargement du projet…" />
  if (isError) return <ErrorState message="Impossible de charger le projet." onRetry={() => void refetch()} />
  if (!project) {
    return (
      <EmptyState
        title="Projet introuvable"
        text="Ce projet n'existe pas ou tu n'y as pas accès."
        action={<Link to="/">Retour aux projets</Link>}
      />
    )
  }

  const context: ProjectOutletContext = { project }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <BackLink to="/" label="Projets" />
        <h1>{project.name}</h1>
        <p className={styles.client}>{project.client?.name ?? 'Sans client'}</p>
      </header>
      <Tabs items={TABS} label="Sections du projet" />
      <Outlet context={context} />
    </div>
  )
}
