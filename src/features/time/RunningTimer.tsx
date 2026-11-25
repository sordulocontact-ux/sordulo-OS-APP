import { Link } from 'react-router-dom'
import { Button, useToast } from '../../components/ui'
import { formatClock } from './timeLogic'
import { useNow, useRunningEntry, useTimerActions } from './useTimeEntries'
import styles from './RunningTimer.module.css'

/** Pastille compacte de l'en-tête : tâche en cours, durée qui défile, arrêt. Rien d'affiché sans minuteur. */
export function RunningTimer() {
  const { data: running } = useRunningEntry()
  if (!running) return null
  return <RunningPill />
}

function RunningPill() {
  const toast = useToast()
  const { running, stop } = useTimerActions()
  const now = useNow(running !== null)
  if (!running) return null
  const title = running.task?.title ?? running.project?.name ?? 'Minuteur en cours'
  const projectName = running.task ? running.project?.name : null
  const to = running.project ? `/projects/${running.project.id}/tasks` : '/'

  return (
    <div className={styles.pill} role="group" aria-label="Minuteur en cours">
      <span className={styles.dot} aria-hidden="true" />
      <Link to={to} className={styles.link} title={projectName ? `${title} (${projectName})` : title}>
        <span className={styles.title}>{title}</span>
      </Link>
      <span className={styles.clock} role="timer" aria-live="off">
        {formatClock(now.getTime() - Date.parse(running.started_at))}
      </span>
      <Button
        size="sm"
        variant="ghost"
        loading={stop.isPending}
        aria-label={`Arrêter le minuteur de “${title}”`}
        onClick={() =>
          stop.mutate(running.id, {
            onSuccess: () => toast.success(`Minuteur arrêté : « ${title} ».`),
            onError: () => toast.error("Impossible d'arrêter le minuteur. Réessaie."),
          })
        }
      >
        Arrêter
      </Button>
    </div>
  )
}
