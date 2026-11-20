import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ActionsMenu, Avatar, Icon, Button, EmptyState, ErrorState, Field, ListToolbar, LoadingState, Select, StatCard, type ActionsMenuItem } from '../../components/ui'
import { PROJECT_ROLES, useHasRole } from '../auth/roles'
import plusIcon from '../../assets/icons/plus.svg'
import table from '../../components/ui/dataTable.module.css'
import { formatDate } from '../tickets/format'
import { LABELS, PROJECT_STATUSES } from '../../shared/types'
import type { ProjectWithClient } from './types'
import { ProjectFormModal } from './ProjectFormModal'
import { ProjectStatus } from './ProjectStatus'
import { clientsInProjects, filterProjects, formatDay, NO_CLIENT, overdueHint, parseStatusParam, projectStats, relativeDue } from './projectLogic'
import { useProjects } from './useProjects'
import styles from './ProjectsPage.module.css'

/** Initiales du projet pour le carré « logo » (« App Ibé » → « AI »). */
function projectInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? words.slice(0, 3).map((w) => w[0]) : [...(words[0] ?? '?').slice(0, 3)]
  return letters.join('').toUpperCase()
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useProjects()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ProjectWithClient | null>(null)
  // Finance lit la liste sans rien écrire ni ouvrir de projet (RLS et routes).
  const canWrite = useHasRole(PROJECT_ROLES)

  const status = parseStatusParam(params.get('statut'))
  const client = params.get('client') ?? ''
  const hasFilters = status !== '' || client !== '' || query.trim() !== ''

  function setParam(key: 'statut' | 'client', value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  function clearFilters() {
    setQuery('')
    setParams(new URLSearchParams(), { replace: true })
  }

  const projects = useMemo(() => filterProjects(data ?? [], { query, status, client }), [data, query, status, client])
  const clientOptions = useMemo(() => clientsInProjects(data ?? []), [data])
  const now = new Date()
  const projectActions = (project: ProjectWithClient): ActionsMenuItem[] => [
    { label: 'Modifier', onSelect: () => setEditing(project) },
    { label: 'Ouvrir le projet', onSelect: () => void navigate(`/projects/${project.id}`) },
  ]
  const stats = useMemo(() => projectStats(data ?? [], new Date()), [data])

  return (
    <section className={table.page} aria-labelledby="projects-title">
      <h1 id="projects-title">Projets</h1>
      {data && data.length > 0 ? (
        <div className={table.stats}>
          <StatCard value={stats.inProgress} label="En cours" hint={overdueHint(stats.overdue)} to="?statut=in_progress" />
          <StatCard value={stats.quoteSent} label="Devis envoyés" to="?statut=quote_sent" />
          <StatCard value={stats.delivered} label="Livrés, à encaisser" to="?statut=delivered" />
          <StatCard value={stats.paid} label="Payés" to="?statut=paid" />
        </div>
      ) : null}
      <ListToolbar
        search={{ value: query, onChange: setQuery, label: 'Rechercher un projet', placeholder: 'Nom du projet ou du client' }}
        activeFilterCount={(status !== '' ? 1 : 0) + (client !== '' ? 1 : 0)}
        onResetFilters={() => setParams(new URLSearchParams(), { replace: true })}
        onAdd={canWrite ? () => setCreating(true) : undefined}
        addLabel="Nouveau projet"
        filters={
          <>
            <Field label="Statut">
              <Select value={status} onChange={(e) => setParam('statut', e.target.value)}>
                <option value="">Tous les statuts actifs</option>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s === 'archived' ? 'Archivés' : LABELS.projectStatus[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Client">
              <Select value={client} onChange={(e) => setParam('client', e.target.value)}>
                <option value="">Tous les clients</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value={NO_CLIENT}>Sans client</option>
              </Select>
            </Field>
          </>
        }
      />

      {isLoading ? (
        <LoadingState label="Chargement des projets…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les projets." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Aucun projet"
          text={canWrite ? "Crée le premier projet de l'organisation." : undefined}
          action={
            canWrite ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Icon src={plusIcon} />
                Nouveau projet
              </Button>
            ) : undefined
          }
        />
      ) : projects.length === 0 ? (
        <EmptyState
          title="Aucun projet ne correspond aux filtres."
          action={
            hasFilters ? (
              <Button onClick={clearFilters}>Effacer les filtres</Button>
            ) : undefined
          }
        />
      ) : (
        <div className={table.scroll}>
          <table className={table.table}>
            <thead>
              <tr>
                <th scope="col">Projet</th>
                <th scope="col">Client</th>
                <th scope="col">Statut</th>
                <th scope="col">Échéance</th>
                <th scope="col">Créé le</th>
                {canWrite ? (
                  <th scope="col" className={table.actionsCell}>
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => {
                const due = formatDay(project.due_date)
                const relative = relativeDue(project, now)
                return (
                  <tr key={project.id} className={table.row}>
                    <td>
                      <span className={styles.project}>
                        <span className={styles.logo} aria-hidden="true">
                          {projectInitials(project.name)}
                        </span>
                        {canWrite ? (
                          <Link to={`/projects/${project.id}`} className={table.rowLink}>
                            {project.name}
                          </Link>
                        ) : (
                          <span className={table.primary}>{project.name}</span>
                        )}
                      </span>
                    </td>
                    <td>
                      {project.client ? (
                        <span className={styles.project}>
                          <Avatar name={project.client.name} size="sm" />
                          <Link to={`/clients/${project.client.id}`} className={styles.clientLink}>
                            {project.client.name}
                          </Link>
                        </span>
                      ) : (
                        <span className={table.inactive}>Sans client</span>
                      )}
                    </td>
                    <td>
                      <ProjectStatus status={project.status} />
                    </td>
                    <td>
                      {due ?? <span className={table.inactive}>Non définie</span>}
                      {relative ? (
                        <span className={[table.secondLine, relative.overdue ? table.danger : ''].filter(Boolean).join(' ')}>
                          {relative.text}
                        </span>
                      ) : null}
                    </td>
                    <td>{formatDate(project.created_at)}</td>
                    {canWrite ? (
                      <td className={table.actionsCell}>
                        <ActionsMenu label={`Actions pour ${project.name}`} items={projectActions(project)} />
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {canWrite ? (
        <>
          <ProjectFormModal
            open={creating}
            onClose={() => setCreating(false)}
            defaultClientId={client && client !== NO_CLIENT ? client : null}
            onSaved={(project) => void navigate(`/projects/${project.id}`)}
          />
          <ProjectFormModal open={editing !== null} onClose={() => setEditing(null)} project={editing} />
        </>
      ) : null}
    </section>
  )
}
