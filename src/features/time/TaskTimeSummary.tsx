import { useState } from 'react'
import { Button } from '../../components/ui'
import type { Task } from '../../shared/types'
import { budget, budgetLabel } from './timeLogic'
import { TimeEntryModal } from './TimeEntryModal'
import styles from './TaskTimeSummary.module.css'

export interface TaskTimeSummaryProps {
  task: Pick<Task, 'id' | 'project_id' | 'title' | 'estimate_hours'>
  /** Minutes déjà passées sur la tâche (minuteur en cours compris). */
  spentMinutes: number
}

/** « 2 h 30 sur 4 h » (rouge au-delà de l'estimation) et saisie manuelle de temps. */
export function TaskTimeSummary({ task, spentMinutes }: TaskTimeSummaryProps) {
  const [adding, setAdding] = useState(false)
  const b = budget(spentMinutes, Math.round((task.estimate_hours ?? 0) * 60))
  return (
    <div className={styles.root}>
      <span className={b.state === 'over' ? styles.over : styles.text}>
        Temps : {budgetLabel(b)}
        {b.state === 'over' ? ' (dépassé)' : ''}
      </span>
      <Button size="sm" variant="ghost" onClick={() => setAdding(true)} aria-label={`Ajouter du temps à “${task.title}”`}>
        Ajouter
      </Button>
      <TimeEntryModal open={adding} onClose={() => setAdding(false)} projectId={task.project_id} taskId={task.id} />
    </div>
  )
}
