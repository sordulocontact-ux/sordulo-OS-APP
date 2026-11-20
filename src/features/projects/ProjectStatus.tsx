import type { ProjectStatus as Status } from '../../shared/types'
import { LABELS } from '../../shared/types'
import styles from './ProjectStatus.module.css'

/** Couleur de pastille par statut : pas commencé (gris), en attente (orange), en cours (bleu), terminé (vert). */
const TONE: Record<Status, 'idle' | 'warning' | 'info' | 'success'> = {
  prospect: 'idle',
  quote_sent: 'warning',
  in_progress: 'info',
  delivered: 'success',
  paid: 'success',
  archived: 'idle',
}

/** Figma « Projet » : petit carré coloré + libellé. La couleur n'est jamais seule : le libellé suit. */
export function ProjectStatus({ status }: { status: Status }) {
  return (
    <span className={styles.status}>
      <span className={[styles.dot, styles[TONE[status]]].join(' ')} aria-hidden="true" />
      {LABELS.projectStatus[status] ?? status}
    </span>
  )
}
