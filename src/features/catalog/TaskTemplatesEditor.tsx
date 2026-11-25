import { useId } from 'react'
import { Button, Select, TextInput } from '../../components/ui'
import { LABELS, SKILLS, type Skill } from '../../shared/types'
import { emptyTaskDraft, ESTIMATE_STEP, removeTaskDraft, type TaskErrors, type TaskTemplateDraft } from './catalogLogic'
import styles from './catalog.module.css'

export interface TaskTemplatesEditorProps {
  tasks: TaskTemplateDraft[]
  onChange: (tasks: TaskTemplateDraft[]) => void
  /** Erreurs par tâche, affichées une fois le formulaire soumis. */
  errors?: TaskErrors[]
  disabled?: boolean
}

/** Édition des tâches types d'une prestation : titre, compétence, durée (heures, pas de 0,25), dépendance. */
export function TaskTemplatesEditor({ tasks, onChange, errors, disabled = false }: TaskTemplatesEditorProps) {
  const base = useId()
  const update = (index: number, patch: Partial<TaskTemplateDraft>) =>
    onChange(tasks.map((t, i) => (i === index ? { ...t, ...patch } : t)))

  return (
    <div className={styles.tasks}>
      {tasks.length === 0 ? (
        <p className={styles.hint}>Aucune tâche type. À l’acceptation d’un devis, cette prestation ne proposera pas de tâches.</p>
      ) : (
        <ol className={styles.taskList}>
          {tasks.map((task, index) => {
            const e = errors?.[index] ?? {}
            const n = index + 1
            const id = `${base}-${index}`
            return (
              <li key={index} className={styles.taskRow}>
                <span className={styles.taskNumber} aria-hidden="true">
                  {n}
                </span>
                <div className={styles.taskTitle}>
                  <TextInput
                    aria-label={`Titre de la tâche ${n}`}
                    placeholder="Titre de la tâche"
                    value={task.title}
                    disabled={disabled}
                    aria-invalid={e.title ? true : undefined}
                    aria-describedby={e.title ? `${id}-title` : undefined}
                    onChange={(event) => update(index, { title: event.target.value })}
                  />
                  {e.title ? (
                    <p id={`${id}-title`} className={styles.fieldError}>
                      {e.title}
                    </p>
                  ) : null}
                </div>
                <Select
                  aria-label={`Compétence de la tâche ${n}`}
                  value={task.skill}
                  disabled={disabled}
                  onChange={(event) => update(index, { skill: event.target.value as Skill })}
                >
                  {SKILLS.map((skill) => (
                    <option key={skill} value={skill}>
                      {LABELS.skill[skill]}
                    </option>
                  ))}
                </Select>
                <div className={styles.taskEstimate}>
                  <TextInput
                    aria-label={`Durée estimée de la tâche ${n}, en heures (par pas de ${String(ESTIMATE_STEP).replace('.', ',')})`}
                    placeholder="Heures"
                    inputMode="decimal"
                    className={styles.number}
                    value={task.estimate}
                    disabled={disabled}
                    aria-invalid={e.estimate ? true : undefined}
                    aria-describedby={e.estimate ? `${id}-estimate` : undefined}
                    onChange={(event) => update(index, { estimate: event.target.value })}
                  />
                  {e.estimate ? (
                    <p id={`${id}-estimate`} className={styles.fieldError}>
                      {e.estimate}
                    </p>
                  ) : null}
                </div>
                <div className={styles.taskDepends}>
                  <Select
                    aria-label={`Dépend de, tâche ${n}`}
                    value={task.dependsOn === null ? '' : String(task.dependsOn)}
                    disabled={disabled}
                    aria-invalid={e.dependsOn ? true : undefined}
                    aria-describedby={e.dependsOn ? `${id}-depends` : undefined}
                    onChange={(event) => update(index, { dependsOn: event.target.value === '' ? null : Number(event.target.value) })}
                  >
                    <option value="">Aucune dépendance</option>
                    {tasks.map((other, i) =>
                      i === index ? null : (
                        <option key={i} value={i}>
                          Après la tâche {i + 1}
                          {other.title.trim() ? ` : ${other.title.trim()}` : ''}
                        </option>
                      ),
                    )}
                  </Select>
                  {e.dependsOn ? (
                    <p id={`${id}-depends`} className={styles.fieldError}>
                      {e.dependsOn}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Supprimer la tâche ${n}`}
                  disabled={disabled}
                  onClick={() => onChange(removeTaskDraft(tasks, index))}
                >
                  ×
                </Button>
              </li>
            )
          })}
        </ol>
      )}
      <div>
        <Button size="sm" disabled={disabled} onClick={() => onChange([...tasks, emptyTaskDraft()])}>
          Ajouter une tâche type
        </Button>
      </div>
    </div>
  )
}
