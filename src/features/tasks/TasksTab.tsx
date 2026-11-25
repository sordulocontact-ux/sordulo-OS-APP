import { useState, type DragEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { EmptyState, ErrorState, Field, LoadingState, Select, useToast } from '../../components/ui'
import { useOrgMembers } from '../auth'
import { useProjectContext } from '../projects'
import { useNow, useProjectTimeEntries } from '../time/useTimeEntries'
import { minutesByTask } from '../time/timeLogic'
import { LABELS, TASK_PRIORITIES, TASK_STATUSES, type TaskPriority, type TaskStatus } from '../../shared/types'
import {
  PERSON_NONE,
  computeDropPosition,
  filterByPerson,
  formatHours,
  groupByStatus,
  totalHours,
  type BoardTask,
} from './board'
import {
  DUE_FILTERS, filterByDue, filterByPriority, parseDueParam, parsePriorityParam, parisDay, type DueFilter,
} from './schedule'
import { TaskCard } from './TaskCard'
import { useProjectTasks, useUpdateTask, type TaskPatch } from './useProjectTasks'
import styles from './TasksTab.module.css'

const DUE_FILTER_LABELS: Record<Exclude<DueFilter, ''>, string> = {
  overdue: 'En retard',
  today: "Aujourd'hui",
  week: "D'ici dimanche",
  none: 'Sans échéance',
}

interface DropTarget {
  status: TaskStatus
  beforeId: string | null
}

export function TasksTab() {
  const { projectId = '' } = useParams()
  const { project } = useProjectContext()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const person = searchParams.get('person')
  const priority = parsePriorityParam(searchParams.get('priority'))
  const dueFilter = parseDueParam(searchParams.get('due'))
  const { tasks, allTasks, isLoading, isError, refetch } = useProjectTasks(projectId)
  const { data: members = [] } = useOrgMembers(project.organization_id)
  const update = useUpdateTask(projectId, toast.error)
  const { data: timeEntries } = useProjectTimeEntries(projectId)
  const hasRunning = timeEntries?.some((e) => e.ended_at === null) ?? false
  const now = useNow(hasRunning, 30_000)
  const spentByTask = minutesByTask(timeEntries ?? [], now)
  const today = parisDay(now)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [announcement, setAnnouncement] = useState('')

  if (isLoading) return <LoadingState label="Chargement des tâches…" />
  if (isError || !tasks || !allTasks) {
    return <ErrorState message="Impossible de charger les tâches." onRetry={() => void refetch()} />
  }
  if (tasks.length === 0) {
    return (
      <EmptyState
        title="Aucune tâche"
        text="Aucune tâche validée pour l'instant. Ajoute une entrée puis valide les tickets proposés."
        action={<Link to={`/projects/${projectId}/inputs`}>Aller aux entrées</Link>}
      />
    )
  }

  const filtered = filterByDue(filterByPriority(filterByPerson(tasks, person), priority), dueFilter, today)
  const columns = groupByStatus(filtered)
  // Positions are compared inside the full visible column, so a filtered view never inverts the order.
  const fullColumns = groupByStatus(tasks)
  const memberById = new Map(members.map((m) => [m.id, m]))
  // Un membre retiré n'apparaît dans le filtre que s'il garde des tâches (faites) dans ce projet.
  const assigneeIds = new Set(tasks.map((t) => t.assignee_member_id).filter((id): id is string => id !== null))

  const setParam = (key: 'person' | 'priority' | 'due', value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const move = (task: BoardTask, status: TaskStatus, beforeId: string | null) => {
    const position = computeDropPosition(fullColumns[status], task.id, beforeId)
    if (status === task.status && position === task.position) return
    update.mutate({ id: task.id, patch: { status, position } satisfies TaskPatch })
    setAnnouncement(`« ${task.title} » déplacée dans la colonne ${LABELS.taskStatus[status]}.`)
  }

  const reassign = (task: BoardTask, memberId: string | null) => {
    update.mutate({ id: task.id, patch: { assignee_member_id: memberId } satisfies TaskPatch })
    const name = memberId ? (memberById.get(memberId)?.name ?? 'un membre') : null
    setAnnouncement(name ? `« ${task.title} » attribuée à ${name}.` : `« ${task.title} » n'est plus attribuée.`)
  }

  const changePriority = (task: BoardTask, next: TaskPriority) => {
    update.mutate({ id: task.id, patch: { priority: next } satisfies TaskPatch })
    setAnnouncement(`Priorité de « ${task.title} » : ${LABELS.taskPriority[next].toLowerCase()}.`)
  }

  const changeDueDate = (task: BoardTask, dueDate: string | null) => {
    update.mutate({ id: task.id, patch: { due_date: dueDate } satisfies TaskPatch })
    setAnnouncement(dueDate ? `Échéance de « ${task.title} » : ${dueDate}.` : `« ${task.title} » n'a plus d'échéance.`)
  }

  const clearDrag = () => {
    setDraggingId(null)
    setDropTarget(null)
  }

  const handleDrop = (status: TaskStatus, beforeId: string | null) => {
    const task = tasks.find((t) => t.id === draggingId)
    clearDrag()
    if (task && beforeId !== task.id) move(task, status, beforeId)
  }

  const allowDrop = (event: DragEvent<HTMLElement>, target: DropTarget) => {
    if (!draggingId) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    if (dropTarget?.status !== target.status || dropTarget.beforeId !== target.beforeId) setDropTarget(target)
  }

  return (
    <section className={styles.root} aria-label="Tâches du projet">
      <div className={styles.filter}>
        <Field label="Personne">
          <Select value={person ?? ''} onChange={(e) => setParam('person', e.target.value)}>
            <option value="">Tout le monde</option>
            {members
              .filter((member) => member.removed_at === null || assigneeIds.has(member.id))
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.removed_at === null ? member.name : `${member.name} (retiré)`}
                </option>
              ))}
            <option value={PERSON_NONE}>Non attribuées</option>
          </Select>
        </Field>
        <Field label="Priorité">
          <Select value={priority} onChange={(e) => setParam('priority', e.target.value)}>
            <option value="">Toutes</option>
            {[...TASK_PRIORITIES].reverse().map((p) => (
              <option key={p} value={p}>
                {LABELS.taskPriority[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Échéance">
          <Select value={dueFilter} onChange={(e) => setParam('due', e.target.value)}>
            <option value="">Toutes</option>
            {DUE_FILTERS.map((d) => (
              <option key={d} value={d}>
                {DUE_FILTER_LABELS[d]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <p className={styles.live} role="status" aria-live="polite">
        {announcement}
      </p>

      {filtered.length === 0 ? <p className={styles.noMatch}>Aucune tâche pour ces filtres.</p> : null}

      <div className={styles.board}>
        {TASK_STATUSES.map((status) => {
          const columnTasks = columns[status]
          const isTarget = dropTarget?.status === status
          return (
            <section
              key={status}
              className={[styles.column, styles[status], isTarget ? styles.columnOver : ''].filter(Boolean).join(' ')}
              aria-labelledby={`column-${status}`}
              onDragOver={(e) => allowDrop(e, { status, beforeId: null })}
              onDrop={(e) => {
                e.preventDefault()
                handleDrop(status, null)
              }}
            >
              <header className={styles.columnHeader}>
                <h3 id={`column-${status}`} className={styles.columnTitle}>
                  <span className={styles.columnDot} aria-hidden="true" />
                  {LABELS.taskStatus[status]}
                </h3>
                <span className={styles.columnStats}>
                  {columnTasks.length} · {formatHours(totalHours(columnTasks))}
                </span>
              </header>
              <ul className={styles.list}>
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    allTasks={allTasks}
                    members={members}
                    assignee={task.assignee_member_id ? (memberById.get(task.assignee_member_id) ?? null) : null}
                    dragging={draggingId === task.id}
                    today={today}
                    spentMinutes={spentByTask.get(task.id) ?? 0}
                    dropBefore={isTarget && dropTarget.beforeId === task.id && draggingId !== task.id}
                    onDragStart={setDraggingId}
                    onDragEnd={clearDrag}
                    onDragOverCard={(e, t) => allowDrop(e, { status, beforeId: t.id })}
                    onDropOnCard={(e, t) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleDrop(status, t.id)
                    }}
                    onChangeStatus={(t, next) => move(t, next, null)}
                    onChangeAssignee={reassign}
                    onChangePriority={changePriority}
                    onChangeDueDate={changeDueDate}
                  />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </section>
  )
}
