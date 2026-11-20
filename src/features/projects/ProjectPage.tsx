/*
 * Choix de données : ProjectPage charge le projet via useProject(projectId) et le transmet
 * aux onglets enfants par <Outlet context={{ project }} /> (lu avec useProjectContext()).
 * Les pages hors de cet Outlet (InputDetailPage, ReviewPage) lisent projectId dans l'URL et
 * appellent useProject(projectId) : même clé de requête, donc servi par le cache TanStack Query.
 */
import { useState } from 'react'
import { Link, Outlet, useParams } from 'react-router-dom'
import { BackLink, Button, EmptyState, ErrorState, LoadingState, Tabs, type TabItem } from '../../components/ui'
import { ProjectFormModal } from './ProjectFormModal'
import { ProjectStatus } from './ProjectStatus'
import { formatDay } from './projectLogic'
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
  const [editing, setEditing] = useState(false)

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
  const due = formatDay(project.due_date)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <BackLink to="/" label="Projets" />
        <div className={styles.titleRow}>
          <h1>{project.name}</h1>
          <Button onClick={() => setEditing(true)}>Modifier</Button>
        </div>
        <p className={styles.meta}>
          <ProjectStatus status={project.status} />
          {project.client ? (
            <Link to={`/clients/${project.client.id}`} className={styles.clientLink}>
              {project.client.name}
            </Link>
          ) : (
            <span>Sans client</span>
          )}
          {due ? <span>Échéance : {due}</span> : null}
        </p>
      </header>
      <Tabs items={TABS} label="Sections du projet" />
      <Outlet context={context} />
      <ProjectFormModal open={editing} onClose={() => setEditing(false)} project={project} />
    </div>
  )
}
