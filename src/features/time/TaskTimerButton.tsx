import { Button, useToast } from '../../components/ui'
import { formatClock } from './timeLogic'
import { useNow, useTimerActions, type TimerTarget } from './useTimeEntries'
import styles from './TaskTimerButton.module.css'

export interface TaskTimerButtonProps {
  task: TimerTarget
  size?: 'sm' | 'md'
}

/** Démarre ou arrête le minuteur d'une tâche. Un seul minuteur tourne : en démarrer un autre arrête le précédent. */
export function TaskTimerButton({ task, size = 'sm' }: TaskTimerButtonProps) {
  const toast = useToast()
  const { running, start, stop } = useTimerActions()
  const active = running !== null && running.task_id === task.id
  const now = useNow(active)
  const busy = start.isPending || stop.isPending

  function onStart() {
    start.mutate(task, {
      onSuccess: ({ stopped }) =>
        toast.success(stopped ? `Minuteur de « ${stopped} » arrêté, « ${task.title} » démarré.` : `Minuteur démarré : « ${task.title} ».`),
      onError: () => toast.error('Impossible de démarrer le minuteur. Réessaie.'),
    })
  }

  function onStop() {
    if (!running) return
    stop.mutate(running.id, {
      onSuccess: () => toast.success(`Minuteur arrêté : « ${task.title} ».`),
      onError: () => toast.error("Impossible d'arrêter le minuteur. Réessaie."),
    })
  }

  if (active && running) {
    return (
      <Button size={size} variant="danger" onClick={onStop} loading={busy} aria-label={`Arrêter le minuteur de “${task.title}”`}>
        <span className={styles.clock}>{formatClock(now.getTime() - Date.parse(running.started_at))}</span>
        Arrêter
      </Button>
    )
  }
  return (
    <Button size={size} onClick={onStart} loading={busy} aria-label={`Démarrer le minuteur de “${task.title}”`}>
      Démarrer
    </Button>
  )
}
