import { Avatar, Button, Field, Select, TextInput } from '../../components/ui'
import { LABELS, SKILLS, type Member, type Skill } from '../../shared/types'
import type { TaskDraft } from './diff'
import styles from './TicketCard.module.css'

interface TaskRowProps {
  task: TaskDraft
  members: readonly Member[]
  /** Title of the task this one waits for, when it still exists in the draft. */
  dependsOnTitle: string | null
  errors: { title?: string; estimate?: string } | undefined
  disabled: boolean
  onChange: (task: TaskDraft) => void
  onSkillChange: (skill: Skill) => void
  onRemove: () => void
}

export function TaskRow({ task, members, dependsOnTitle, errors, disabled, onChange, onSkillChange, onRemove }: TaskRowProps) {
  const assignee = task.assigneeId ? members.find((member) => member.id === task.assigneeId) : undefined
  const label = task.title.trim() || 'sans titre'
  return (
    <li className={styles.task}>
      <div className={styles.taskFields}>
        <Field label="Titre de la tâche" error={errors?.title}>
          <TextInput
            value={task.title}
            disabled={disabled}
            onChange={(event) => onChange({ ...task, title: event.target.value })}
          />
        </Field>
        <Field label="Compétence">
          <Select
            value={task.skill}
            disabled={disabled}
            onChange={(event) => onSkillChange(event.target.value as Skill)}
          >
            {SKILLS.map((skill) => (
              <option key={skill} value={skill}>
                {LABELS.skill[skill]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estimation (heures)" error={errors?.estimate}>
          <TextInput
            type="number"
            min={0}
            step={0.5}
            inputMode="decimal"
            value={task.estimate}
            disabled={disabled}
            onChange={(event) => onChange({ ...task, estimate: event.target.value })}
          />
        </Field>
      </div>
      <div className={styles.taskMeta}>
        <span className={styles.assignee}>
          {assignee ? (
            <>
              <Avatar name={assignee.name} />
              <span>{assignee.name}</span>
            </>
          ) : (
            <span className={styles.muted}>Non attribuée</span>
          )}
        </span>
        {dependsOnTitle ? <span className={styles.muted}>Après : {dependsOnTitle}</span> : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onRemove}
          aria-label={`Supprimer la tâche « ${label} »`}
        >
          Supprimer
        </Button>
      </div>
    </li>
  )
}
