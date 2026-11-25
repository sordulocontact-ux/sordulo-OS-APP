import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Badge, EmptyState, ErrorState, LoadingState, Select, useToast } from '../../components/ui'
import table from '../../components/ui/dataTable.module.css'
import { LABELS, TASK_STATUSES, type TaskStatus } from '../../shared/types'
import { formatHours, isTaskStatus } from '../tasks/board'
import { dueLabel, dueState, parisDay } from '../tasks/schedule'
import { TaskTimerButton } from '../time/TaskTimerButton'
import { nonEmptyGroups, groupByDue } from './myTasksLogic'
import { useChangeMyTaskStatus, useMyTasks, type MyTask } from './useMyTasks'
import styles from './MyTasksPage.module.css'

/** Page « Mes tâches » : tout ce qui m'est attribué, de tous les projets, groupé par échéance (Paris). */
export function MyTasksPage() {
  const toast = useToast()
  const { data, isLoading, isError, refetch } = useMyTasks()
  const changeStatus = useChangeMyTaskStatus(toast.error)
  const today = parisDay()
  const groups = useMemo(() => nonEmptyGroups(groupByDue(data?.open ?? [], today)), [data, today])

  const onStatus = (task: MyTask, status: TaskStatus) => changeStatus.mutate({ task, status })

  return (
    <section className={table.page} aria-labelledby="my-tasks-title">
      <h1 id="my-tasks-title">Mes tâches</h1>

      {isLoading ? <LoadingState label="Chargement de tes tâches…" /> : null}
      {isError ? <ErrorState message="Impossible de charger tes tâches." onRetry={() => void refetch()} /> : null}
      {data && data.open.length === 0 ? (
        <EmptyState title="Rien à faire" text="Aucune tâche ne t'est attribuée pour l'instant." />
      ) : null}

      {groups.map(({ group, label, tasks }) => (
        <section key={group} className={styles.group} aria-labelledby={`group-${group}`}>
          <h2 id={`group-${group}`} className={[styles.h2, group === 'overdue' ? styles.overdue : ''].filter(Boolean).join(' ')}>
            {label} <span className={styles.count}>{tasks.length}</span>
          </h2>
          <TaskTable tasks={tasks} today={today} onStatus={onStatus} timer />
        </section>
      ))}

      {data && data.done.length > 0 ? (
        <details className={styles.done}>
          <summary className={styles.summary}>Faites récemment ({data.done.length})</summary>
          <TaskTable tasks={data.done} today={today} onStatus={onStatus} />
        </details>
      ) : null}
    </section>
  )
}

interface TaskTableProps {
  tasks: MyTask[]
  today: string
  onStatus: (task: MyTask, status: TaskStatus) => void
  timer?: boolean
}

function TaskTable({ tasks, today, onStatus, timer = false }: TaskTableProps) {
  return (
    <div className={table.scroll}>
      <table className={table.table}>
        <thead>
          <tr>
            <th scope="col">Tâche</th>
            <th scope="col">Projet</th>
            <th scope="col">Priorité</th>
            <th scope="col">Échéance</th>
            <th scope="col">Statut</th>
            {timer ? <th scope="col">Minuteur</th> : null}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const done = task.status === 'done'
            const state = dueState(task.due_date, today, done)
            const due = dueLabel(task.due_date, today, done)
            return (
              <tr key={task.id} className={table.row}>
                <td>
                  <span className={table.primary}>{task.title}</span>
                  <span className={table.secondLine}>{formatHours(task.estimate_hours)}</span>
                </td>
                <td>
                  {task.project ? (
                    <Link to={`/projects/${task.project.id}/tasks`} className={styles.projectLink}>
                      {task.project.name}
                    </Link>
                  ) : (
                    <span className={table.muted}>Sans projet</span>
                  )}
                </td>
                <td>
                  {task.priority === 'medium' ? (
                    <span className={table.muted}>{LABELS.taskPriority.medium}</span>
                  ) : (
                    <Badge tone={task.priority === 'high' ? 'danger' : 'neutral'}>{LABELS.taskPriority[task.priority]}</Badge>
                  )}
                </td>
                <td>
                  {due ? (
                    <span className={state === 'overdue' ? styles.dueOverdue : state === 'today' ? styles.dueToday : undefined}>{due}</span>
                  ) : (
                    <span className={table.muted}>Aucune</span>
                  )}
                </td>
                <td>
                  <Select
                    aria-label={`Statut de “${task.title}”`}
                    value={task.status}
                    onChange={(e) => {
                      if (isTaskStatus(e.target.value)) onStatus(task, e.target.value)
                    }}
                  >
                    {TASK_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {LABELS.taskStatus[status]}
                      </option>
                    ))}
                  </Select>
                </td>
                {timer ? (
                  <td>
                    <TaskTimerButton task={task} />
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
