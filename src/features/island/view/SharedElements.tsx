/**
 * Éléments partagés (prototype : .shared / .sh) : ils glissent d'un état à l'autre au lieu de disparaître.
 * Le moteur écrit leur position, leur opacité et la taille de l'icône Claude ; la boucle écrit le minuteur,
 * le temps écoulé et la hauteur des barres de l'onde.
 */
import { MAX_SESSION_ROWS, WAVE, type SharedElementId } from '../geometry'
import type { ClaudeSession, ClaudeSessionStatus } from '../types'
import { cx } from './cx'
import { CallIcon, ClaudeIcon, DropIcon } from './icons'
import styles from './Island.module.css'

const SEG_IDS: SharedElementId[] = ['seg0', 'seg1', 'seg2', 'seg3', 'seg4']

function segClass(status: ClaudeSessionStatus): string | undefined {
  if (status === 'working') return styles.segWorking
  if (status === 'waiting') return styles.segWaiting
  if (status === 'done') return styles.segDone
  return undefined
}

const WAVE_INDEXES = Array.from({ length: WAVE.bars }, (_, i) => i)

export interface SharedElementsProps {
  sessions: readonly ClaudeSession[]
  register: (id: SharedElementId, el: HTMLElement | null) => void
  timerRef: (el: HTMLElement | null) => void
  elapsedRef: (el: HTMLElement | null) => void
  waveBarRef: (index: number, el: HTMLElement | null) => void
}

export function SharedElements({ sessions, register, timerRef, elapsedRef, waveBarRef }: SharedElementsProps) {
  const segs = sessions.slice(0, MAX_SESSION_ROWS)
  return (
    <div className={styles.shared} aria-hidden="true">
      <span className={cx(styles.sh, styles.meetGroup)} ref={(el) => register('meetGroup', el)}>
        <CallIcon />
        <span className={styles.scrollWave}>
          {WAVE_INDEXES.map((i) => (
            <i key={i} ref={(el) => waveBarRef(i, el)} />
          ))}
        </span>
      </span>
      <span
        className={cx(styles.sh, styles.shText, styles.timer)}
        ref={(el) => {
          register('timer', el)
          timerRef(el)
        }}
      />
      <span className={cx(styles.sh, styles.agentIcon, styles.live)} ref={(el) => register('agentIcon', el)}>
        <ClaudeIcon />
      </span>
      <span className={cx(styles.sh, styles.dots)} ref={(el) => register('dots', el)}>
        <i />
        <i />
        <i />
      </span>
      <span
        className={cx(styles.sh, styles.shText, styles.elapsed)}
        ref={(el) => {
          register('elapsed', el)
          elapsedRef(el)
        }}
      />
      <span className={cx(styles.sh, styles.shText, styles.count)} ref={(el) => register('count', el)}>
        {sessions.length}
      </span>
      {segs.map((s, i) => {
        const id = SEG_IDS[i]
        if (!id) return null
        return <span key={id} className={cx(styles.sh, styles.seg, segClass(s.status))} ref={(el) => register(id, el)} />
      })}
      <span className={cx(styles.sh, styles.dropIcon)} ref={(el) => register('dropIcon', el)}>
        <DropIcon />
      </span>
    </div>
  )
}
