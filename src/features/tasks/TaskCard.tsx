import { canBeAutoAssigned } from '../../shared/assignment'
import type { DragEvent } from 'react'
import { Avatar, Badge, Card, Field, Select, TextInput } from '../../components/ui'
import { LABELS, TASK_PRIORITIES, TASK_STATUSES, type Member, type TaskPriority, type TaskStatus } from '../../shared/types'
import { TaskTimerButton } from '../time/TaskTimerButton'
import { TaskTimeSummary } from '../time/TaskTimeSummary'
import { dueLabel, dueState, isTaskPriority } from './schedule'
import { countBlocked, dependencyLabel, formatHours, getDependency, isTaskStatus, type BoardTask } from './board'
import styles from './TaskCard.module.css'

interface TaskCardProps {
  task: BoardTask
  allTasks: BoardTask[]
  members: Member[]
  assignee: Member | null
  dragging: boolean
  dropBefore: boolean
  /** Jour AAAA-MM-JJ à Paris. */
  today: string
  /** Minutes déjà passées sur la tâche. */
  spentMinutes: number
  onDragStart: (taskId: string) => void
  onDragEnd: () => void
  onDragOverCard: (event: DragEvent<HTMLElement>, task: BoardTask) => void
  onDropOnCard: (event: DragEvent<HTMLElement>, task: BoardTask) => void
  onChangeStatus: (task: BoardTask, status: TaskStatus) => void
  onChangeAssignee: (task: BoardTask, memberId: string | null) => void
  onChangePriority: (task: BoardTask, priority: TaskPriority) => void
  onChangeDueDate: (task: BoardTask, dueDate: string | null) => void
}

export function TaskCard({
  task,
  allTasks,
  members,
  assignee,
  dragging,
  dropBefore,
  today,
  spentMinutes,
  onDragStart,
  onDragEnd,
  onDragOverCard,
  onDropOnCard,
  onChangeStatus,
  onChangeAssignee,
  onChangePriority,
  onChangeDueDate,
}: TaskCardProps) {
  const done = task.status === 'done'
  const due = dueLabel(task.due_date, today, done)
  const dueTone = dueState(task.due_date, today, done)
  const dependency = getDependency(task, allTasks)
  const label = dependencyLabel(dependency)
  const blocking = countBlocked(task.id, allTasks)
  const className = [styles.card, dragging ? styles.dragging : '', dropBefore ? styles.dropBefore : '']
    .filter(Boolean)
    .join(' ')

  return (
    <li
      className={styles.item}
      onDragOver={(e) => onDragOverCard(e, task)}
      onDrop={(e) => onDropOnCard(e, task)}
    >
      <Card
        className={className}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', task.id)
          onDragStart(task.id)
        }}
        onDragEnd={onDragEnd}
      >
        <h4 className={styles.title}>{task.title}</h4>
        {task.ticket ? (
          <p className={styles.ticket}>
            <Badge tone={task.ticket.type}>{LABELS.ticketType[task.ticket.type]}</Badge>
            <span className={styles.ticketTitle}>{task.ticket.title}</span>
          </p>
        ) : null}
        <p className={styles.meta}>
          <Badge tone={task.skill}>{LABELS.skill[task.skill]}</Badge>
          <span className={styles.estimate}>{formatHours(task.estimate_hours)}</span>
          {task.priority !== 'medium' ? (
            <Badge tone={task.priority === 'high' ? 'danger' : 'neutral'}>Priorité {LABELS.taskPriority[task.priority].toLowerCase()}</Badge>
          ) : null}
          {due ? (
            <Badge tone={dueTone === 'overdue' ? 'danger' : dueTone === 'today' ? 'warning' : 'neutral'}>Échéance : {due}</Badge>
          ) : null}
        </p>
        <p className={styles.assignee}>
          {assignee ? (
            <>
              <Avatar name={assignee.name} />
              <span>{assignee.name}</span>
            </>
          ) : (
            <span className={styles.unassigned}>Non attribuée</span>
          )}
        </p>
        {label ? <p className={dependency.blocked ? styles.blocked : styles.after}>{label}</p> : null}
        {blocking > 0 ? <p className={styles.blocking}>Bloque {blocking} tâche(s)</p> : null}
        <TaskTimeSummary task={task} spentMinutes={spentMinutes} />
        {!done ? <TaskTimerButton task={task} /> : null}
        <details className={styles.menu}>
          <summary className={styles.summary}>Modifier, déplacer ou réattribuer</summary>
          <div className={styles.fields}>
            <Select
              aria-label={`Statut de “${task.title}”`}
              value={task.status}
              onChange={(e) => {
                if (isTaskStatus(e.target.value)) onChangeStatus(task, e.target.value)
              }}
            >
              {TASK_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {LABELS.taskStatus[status]}
                </option>
              ))}
            </Select>
            <Field label="Priorité">
              <Select
                value={task.priority}
                onChange={(e) => {
                  if (isTaskPriority(e.target.value)) onChangePriority(task, e.target.value)
                }}
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {LABELS.taskPriority[priority]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Échéance">
              <TextInput type="date" value={task.due_date ?? ''} onChange={(e) => onChangeDueDate(task, e.target.value || null)} />
            </Field>
            <Select
              aria-label={`Attribuée à, pour “${task.title}”`}
              value={task.assignee_member_id ?? ''}
              onChange={(e) => onChangeAssignee(task, e.target.value || null)}
            >
              <option value="">Non attribuée</option>
              {members
                .filter((member) => canBeAutoAssigned(member) || member.id === task.assignee_member_id)
                .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </div>
        </details>
      </Card>
    </li>
  )
}
