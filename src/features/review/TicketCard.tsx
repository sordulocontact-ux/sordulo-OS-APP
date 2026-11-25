import { canBeAutoAssigned } from '../../shared/assignment'
import { Badge, Button, Card, Field, Select, Textarea, TextInput } from '../../components/ui'
import {
  LABELS,
  TICKET_PRIORITIES,
  TICKET_TYPES,
  type Member,
  type Skill,
  type Ticket,
  type TicketPriority,
  type TicketType,
} from '../../shared/types'
import { ticketHours } from '../../shared/assignment'
import {
  assignTicket,
  changeTaskSkill,
  parseEstimate,
  makeNewTaskDraft,
  ticketAssigneeOf,
  type TaskDraft,
  type TicketDraft,
  type TicketErrors,
} from './diff'
import { MarkerBadge } from '../tickets/MarkerBadge'
import { ticketCardId } from './reviewSync'
import { TaskRow } from './TaskRow'
import styles from './TicketCard.module.css'

interface TicketCardProps {
  ticket: Ticket
  draft: TicketDraft
  members: readonly Member[]
  relatedTitle: string | null
  errors: TicketErrors
  dirty: boolean
  /** This card is being saved. */
  busy: boolean
  /** Another action (save all) is running: freeze the form. */
  frozen: boolean
  /** Arrivée sur `?ticket=<id>` (île) : mise en évidence brève. */
  highlighted?: boolean
  onHighlightEnd?: () => void
  onChange: (draft: TicketDraft) => void
  onValidate: () => void
  onReject: () => void
}

export function TicketCard({
  ticket,
  draft,
  members,
  relatedTitle,
  errors,
  dirty,
  busy,
  frozen,
  highlighted = false,
  onHighlightEnd,
  onChange,
  onValidate,
  onReject,
}: TicketCardProps) {
  const disabled = busy || frozen
  const headingId = `ticket-${ticket.id}`

  function setTask(next: TaskDraft) {
    onChange({ ...draft, tasks: draft.tasks.map((task) => (task.id === next.id ? next : task)) })
  }

  function removeTask(id: string) {
    onChange({ ...draft, tasks: draft.tasks.filter((task) => task.id !== id) })
  }

  function addTask() {
    const task = makeNewTaskDraft(`new-${crypto.randomUUID()}`, members.filter(canBeAutoAssigned), 'dev', ticketAssigneeOf(draft))
    onChange({ ...draft, tasks: [...draft.tasks, task] })
  }

  const titleForLabel = draft.title.trim() || ticket.title
  const holder = ticketAssigneeOf(draft)
  const hours = ticketHours(draft.tasks.map((task) => ({ estimate_hours: parseEstimate(task.estimate) ?? null })))

  return (
    <Card
      id={ticketCardId(ticket.id)}
      tabIndex={-1}
      className={[styles.card, highlighted ? styles.highlighted : ''].filter(Boolean).join(' ')}
      aria-labelledby={headingId}
      role="group"
      onAnimationEnd={(e) => {
        if (highlighted && e.target === e.currentTarget) onHighlightEnd?.()
      }}
    >
      <header className={styles.header}>
        <h2 id={headingId} className={styles.heading}>
          {titleForLabel}
        </h2>
        <div className={styles.badges}>
          {ticket.from_marker ? <MarkerBadge /> : null}
          {ticket.area ? <Badge>{ticket.area}</Badge> : null}
          {dirty ? <Badge tone="warning">Modifications non enregistrées</Badge> : null}
        </div>
      </header>

      <div className={styles.assignment}>
        <Field label="Personne (tout le ticket)">
          <Select
            value={holder ?? ''}
            disabled={disabled || draft.tasks.length === 0}
            onChange={(e) => onChange(assignTicket(draft, e.target.value || null))}
          >
            {holder === null ? <option value="">{draft.tasks.length > 1 ? 'Plusieurs personnes' : 'Personne'}</option> : null}
            {members
              .filter((member) => canBeAutoAssigned(member) || member.id === holder)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </Select>
        </Field>
        <p className={styles.muted}>
          Environ {String(Math.round(hours * 100) / 100).replace('.', ',')} h
          {ticket.assignment_note ? ` · ${ticket.assignment_note}` : ''}
        </p>
      </div>

      <div className={styles.grid}>
        <div className={styles.wide}>
          <Field label="Titre" error={errors.title}>
            <TextInput value={draft.title} disabled={disabled} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
          </Field>
        </div>
        <Field label="Type">
          <Select
            value={draft.type}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, type: e.target.value as TicketType })}
          >
            {TICKET_TYPES.map((type) => (
              <option key={type} value={type}>
                {LABELS.ticketType[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priorité">
          <Select
            value={draft.priority}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, priority: e.target.value as TicketPriority })}
          >
            {TICKET_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {LABELS.ticketPriority[priority]}
              </option>
            ))}
          </Select>
        </Field>
        <div className={styles.wide}>
          <Field label="Description">
            <Textarea
              rows={10}
              value={draft.description}
              disabled={disabled}
              onChange={(e) => onChange({ ...draft, description: e.target.value })}
            />
          </Field>
        </div>
      </div>

      {ticket.source_quote ? (
        <figure className={styles.quote}>
          <figcaption className={styles.quoteLabel}>Passage de l'entrée</figcaption>
          <blockquote className={styles.quoteText}>{ticket.source_quote}</blockquote>
        </figure>
      ) : null}
      {ticket.related_ticket_id ? (
        <p className={styles.muted}>Suite de : {relatedTitle ?? 'un ticket existant'}</p>
      ) : null}

      <section className={styles.tasks} aria-label={`Tâches du ticket « ${titleForLabel} »`}>
        <h3 className={styles.tasksTitle}>Tâches ({draft.tasks.length})</h3>
        {draft.tasks.length === 0 ? <p className={styles.muted}>Aucune tâche.</p> : null}
        <ul className={styles.taskList}>
          {draft.tasks.map((task) => {
            const dependency = task.dependsOnId ? draft.tasks.find((other) => other.id === task.dependsOnId) : undefined
            return (
              <TaskRow
                key={task.id}
                task={task}
                members={members}
                dependsOnTitle={dependency ? dependency.title.trim() || 'tâche sans titre' : null}
                errors={errors.tasks[task.id]}
                disabled={disabled}
                onChange={setTask}
                onSkillChange={(skill: Skill) => setTask(changeTaskSkill(task, skill))}
                onRemove={() => removeTask(task.id)}
              />
            )
          })}
        </ul>
        <div>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={addTask}>
            Ajouter une tâche
          </Button>
        </div>
      </section>

      <footer className={styles.actions}>
        <Button
          variant="danger"
          disabled={frozen}
          loading={busy}
          onClick={onReject}
          aria-label={`Refuser le ticket « ${titleForLabel} »`}
        >
          Refuser
        </Button>
        <Button
          variant="primary"
          disabled={frozen}
          loading={busy}
          onClick={onValidate}
          aria-label={`Valider le ticket « ${titleForLabel} »`}
        >
          Valider
        </Button>
      </footer>
    </Card>
  )
}
