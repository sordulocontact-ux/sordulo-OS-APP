import { Link } from 'react-router-dom'
import { Badge, Card, EmptyState, ErrorState, LoadingState } from '../../components/ui'
import { useProjects } from './useProjects'
import styles from './ProjectsPage.module.css'

export function ProjectsPage() {
  const { data, isLoading, isError, refetch } = useProjects()

  return (
    <section className={styles.page} aria-labelledby="projects-title">
      <h1 id="projects-title">Projets</h1>
      {isLoading ? (
        <LoadingState label="Chargement des projets…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les projets." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Aucun projet" text="Les projets de l'organisation apparaîtront ici." />
      ) : (
        <ul className={styles.list}>
          {data.map((project) => (
            <li key={project.id}>
              <Card interactive className={styles.item}>
                <div className={styles.info}>
                  <Link to={`/projects/${project.id}`} className={styles.name}>
                    {project.name}
                  </Link>
                  <span className={styles.client}>{project.client?.name ?? 'Sans client'}</span>
                </div>
                <Badge>{project.status}</Badge>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
