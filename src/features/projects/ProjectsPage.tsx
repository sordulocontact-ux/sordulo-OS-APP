import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState, SearchField } from '../../components/ui'
import { formatDate } from '../tickets/format'
import { useProjects } from './useProjects'
import styles from './ProjectsPage.module.css'

/** Libellé et couleur de pastille des statuts de projet (texte libre en base, « active » par défaut). */
function projectStatus(status: string): { label: string; tone: 'active' | 'idle' } {
  if (status === 'active') return { label: 'En cours', tone: 'active' }
  if (status === 'paused') return { label: 'En pause', tone: 'idle' }
  if (status === 'done' || status === 'archived') return { label: 'Terminé', tone: 'idle' }
  return { label: status, tone: 'idle' }
}

/** Initiales du projet pour le carré « logo » (« App Ibé » → « AI »). */
function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? words.slice(0, 3).map((w) => w[0]) : [...(words[0] ?? '?').slice(0, 3)]
  return letters.join('').toUpperCase()
}

export function ProjectsPage() {
  const { data, isLoading, isError, refetch } = useProjects()
  const [query, setQuery] = useState('')

  const projects = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!data || !q) return data ?? []
    return data.filter((p) => p.name.toLowerCase().includes(q) || (p.client?.name ?? '').toLowerCase().includes(q))
  }, [data, query])

  return (
    <section className={styles.page} aria-labelledby="projects-title">
      <h1 id="projects-title">Projets</h1>
      <SearchField label="Rechercher un projet" value={query} onChange={(e) => setQuery(e.target.value)} />
      {isLoading ? (
        <LoadingState label="Chargement des projets…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les projets." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Aucun projet" text="Les projets de l'organisation apparaîtront ici." />
      ) : projects.length === 0 ? (
        <EmptyState title="Aucun projet ne correspond à la recherche." />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Projet</th>
              <th scope="col">Client</th>
              <th scope="col">Statut</th>
              <th scope="col">Créé le</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => {
              const status = projectStatus(project.status)
              return (
                <tr key={project.id} className={styles.row}>
                  <td>
                    <span className={styles.project}>
                      <span className={styles.logo} aria-hidden="true">
                        {projectInitials(project.name)}
                      </span>
                      <Link to={`/projects/${project.id}`} className={styles.name}>
                        {project.name}
                      </Link>
                    </span>
                  </td>
                  <td>{project.client?.name ?? 'Sans client'}</td>
                  <td>
                    <span className={styles.status}>
                      <span className={[styles.dot, styles[status.tone]].join(' ')} aria-hidden="true" />
                      {status.label}
                    </span>
                  </td>
                  <td>{formatDate(project.created_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
