import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge, Button, EmptyState, ErrorState, LoadingState, StatCard } from '../../components/ui'
import table from '../../components/ui/dataTable.module.css'
import { useCurrentMember, useOrgMembers } from '../auth'
import { useProjectContext } from '../projects'
import { useProjectTasks } from '../tasks/useProjectTasks'
import type { TimeEntry } from '../../shared/types'
import {
  budget, budgetLabel, canEditEntry, entryMinutes, formatDuration, localDay, minutesByMember, soldMinutes, taskTimeRows, totalMinutes,
} from './timeLogic'
import { TimeEntryModal } from './TimeEntryModal'
import { useNow, useProjectTimeEntries } from './useTimeEntries'
import styles from './ProjectTimeTab.module.css'

const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

/** Onglet « Temps » de la page projet : réel contre vendu, par personne, par tâche, et les entrées. */
export function ProjectTimeTab() {
  const { projectId = '' } = useParams()
  const { project } = useProjectContext()
  const { member } = useCurrentMember()
  const entriesQuery = useProjectTimeEntries(projectId)
  const tasksQuery = useProjectTasks(projectId)
  const { data: members = [] } = useOrgMembers(project.organization_id)
  const [editing, setEditing] = useState<TimeEntry | null>(null)
  const [adding, setAdding] = useState(false)
  const entries = entriesQuery.data
  const hasRunning = entries?.some((e) => e.ended_at === null) ?? false
  const now = useNow(hasRunning, 30_000)

  const sold = useMemo(() => soldMinutes(tasksQuery.tasks ?? []), [tasksQuery.tasks])
  const memberName = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members])
  const taskTitle = useMemo(() => new Map((tasksQuery.allTasks ?? []).map((t) => [t.id, t.title])), [tasksQuery.allTasks])

  if (entriesQuery.isLoading || tasksQuery.isLoading) return <LoadingState label="Chargement du temps…" />
  if (entriesQuery.isError || tasksQuery.isError || !entries || !tasksQuery.tasks) {
    return (
      <ErrorState
        message="Impossible de charger le temps du projet."
        onRetry={() => {
          void entriesQuery.refetch()
          void tasksQuery.refetch()
        }}
      />
    )
  }

  const isAdmin = member?.role === 'admin'
  const spent = totalMinutes(entries, now)
  const total = budget(spent, sold)
  const perMember = [...minutesByMember(entries, now)].sort((a, b) => b[1] - a[1])
  const perTask = taskTimeRows(tasksQuery.tasks, entries, now)
  const projectOnly = entries.filter((e) => e.task_id === null).reduce((sum, e) => sum + entryMinutes(e, now), 0)
  const taskOptions = tasksQuery.tasks.map((t) => ({ id: t.id, title: t.title }))

  const toolbar = (
    <div className={table.toolbar}>
      <div className={table.toolbarEnd}>
        <Button variant="primary" onClick={() => setAdding(true)}>
          Ajouter du temps
        </Button>
      </div>
    </div>
  )

  const modals = (
    <>
      <TimeEntryModal open={adding} onClose={() => setAdding(false)} projectId={projectId} tasks={taskOptions} />
      <TimeEntryModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        projectId={projectId}
        tasks={taskOptions}
        entry={editing}
      />
    </>
  )

  if (entries.length === 0) {
    return (
      <section className={styles.root} aria-label="Temps du projet">
        {toolbar}
        <EmptyState
          title="Aucun temps enregistré"
          text="Démarre un minuteur sur une tâche du kanban, ou ajoute du temps à la main."
        />
        {sold > 0 ? <p className={styles.note}>Temps vendu : {formatDuration(sold)}.</p> : null}
        {modals}
      </section>
    )
  }

  return (
    <section className={styles.root} aria-label="Temps du projet">
      {toolbar}

      <div className={table.stats}>
        <StatCard value={formatDuration(total.spent)} label="Temps réel" hint={projectOnly > 0 ? `dont ${formatDuration(projectOnly)} sans tâche` : undefined} />
        <StatCard value={formatDuration(sold)} label="Temps vendu" hint="Somme des estimations des tâches" />
        <StatCard
          value={total.state === 'unknown' ? '–' : `${total.remaining < 0 ? '+' : ''}${formatDuration(Math.abs(total.remaining))}`}
          label={total.remaining < 0 ? 'Dépassement' : 'Reste sur le vendu'}
          hint={total.percent === null ? 'Aucune tâche estimée' : `${total.percent} % du temps vendu consommé`}
        />
      </div>
      {total.state === 'over' ? (
        <p className={styles.alert} role="status">
          Le temps réel dépasse le temps vendu : cette prestation n'est pas rentable au tarif actuel.
        </p>
      ) : null}

      <div className={styles.two}>
        <div>
          <h2 className={styles.h2}>Par personne</h2>
          <div className={table.scroll}>
            <table className={table.table}>
              <thead>
                <tr>
                  <th scope="col">Personne</th>
                  <th scope="col">Temps</th>
                </tr>
              </thead>
              <tbody>
                {perMember.map(([id, minutes]) => (
                  <tr key={id} className={table.row}>
                    <td className={table.primary}>{memberName.get(id) ?? 'Membre retiré'}</td>
                    <td>{formatDuration(minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className={styles.h2}>Par tâche</h2>
          {perTask.length === 0 ? (
            <p className={styles.note}>Aucune tâche estimée ni chronométrée.</p>
          ) : (
            <div className={table.scroll}>
              <table className={table.table}>
                <thead>
                  <tr>
                    <th scope="col">Tâche</th>
                    <th scope="col">Passé sur estimé</th>
                  </tr>
                </thead>
                <tbody>
                  {perTask.map((row) => (
                    <tr key={row.taskId} className={table.row}>
                      <td className={table.primary}>{row.title}</td>
                      <td>
                        {budgetLabel(row.budget)} {row.budget.state === 'over' ? <Badge tone="danger">Dépassé</Badge> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div>
        <h2 className={styles.h2}>Entrées</h2>
        <div className={table.scroll}>
          <table className={table.table}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Personne</th>
                <th scope="col">Tâche</th>
                <th scope="col">Durée</th>
                <th scope="col">Note</th>
                <th scope="col" className={table.actionsCell}>
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const running = entry.ended_at === null
                const editable = !running && canEditEntry(entry, member?.id ?? null, isAdmin)
                return (
                  <tr key={entry.id} className={table.row}>
                    <td>{dayFormat.format(new Date(localDay(entry.started_at) + 'T12:00:00'))}</td>
                    <td>{memberName.get(entry.member_id) ?? 'Membre retiré'}</td>
                    <td>{entry.task_id ? (taskTitle.get(entry.task_id) ?? 'Tâche supprimée') : <span className={table.muted}>Projet</span>}</td>
                    <td>{running ? <Badge tone="info">En cours</Badge> : formatDuration(entryMinutes(entry, now))}</td>
                    <td className={table.muted}>{entry.note}</td>
                    <td className={table.actionsCell}>
                      {editable ? (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(entry)} aria-label="Modifier cette entrée de temps">
                          Modifier
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {modals}
    </section>
  )
}
