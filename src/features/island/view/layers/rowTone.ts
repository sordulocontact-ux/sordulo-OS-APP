/**
 * Couleur du statut d'une ligne « aussi en cours » (sous l'appel dans meetOpen, sous la musique dans musicOpen).
 * Hors des fichiers de composants pour garder le rechargement à chaud de Vite.
 */
import styles from '../Island.module.css'
import type { BackgroundRow } from '../labels'

export const ROW_TONE_CLASS: Record<BackgroundRow['tone'], string | undefined> = {
  muted: undefined,
  done: styles.stDone,
  conflict: styles.stConflict,
  error: styles.stError,
  waiting: styles.stWaiting,
}
