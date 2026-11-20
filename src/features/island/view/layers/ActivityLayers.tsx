/**
 * Couches compactes : progression (import, analyse) et musique (hors périmètre, gardée pour les scénarios).
 */
import { RING } from '../../geometry'
import { useLastNonNull } from '../hooks'
import { IslandIcon } from '../icons'
import styles from '../Island.module.css'
import { Layer } from '../Layer'
import { PROGRESS_VISUALS, toneStyle } from '../tone'
import type { ActivityOfKind } from '../types'
import type { BaseLayerProps } from './CallLayers'

/** Hauteurs de base de l'égaliseur (prototype : eqBase) ; la boucle les fait varier. */
const EQ_BASE = [12, 14, 10, 6, 14, 8, 6, 14]

export function MusicLayer({ eqBarRef, ...base }: BaseLayerProps & { eqBarRef: (index: number, el: HTMLElement | null) => void }) {
  return (
    <Layer {...base} state="music" className={styles.layerMusic} label="Musique en lecture">
      <span className={styles.cover} aria-hidden="true" />
      <span className={styles.eq} aria-hidden="true">
        {EQ_BASE.map((h, i) => (
          <i key={i} ref={(el) => eqBarRef(i, el)} style={{ height: h }} />
        ))}
      </span>
    </Layer>
  )
}

/** Anneau de progression (18 px, rayon 7) ; la boucle écrit stroke-dashoffset. */
export function ProgressRing({ barRef, className }: { barRef: (el: SVGCircleElement | null) => void; className?: string }) {
  return (
    <svg className={[styles.ring, className].filter(Boolean).join(' ')} viewBox="0 0 18 18" aria-hidden="true">
      <circle className={styles.ringTrack} cx="9" cy="9" r="7" />
      <circle
        ref={barRef}
        className={styles.ringBar}
        cx="9"
        cy="9"
        r="7"
        strokeDasharray={RING.circumference}
        strokeDashoffset={RING.circumference}
      />
    </svg>
  )
}

export function ProgressLayer({
  progress,
  ringRef,
  ...base
}: BaseLayerProps & { progress: ActivityOfKind<'progress'> | null; ringRef: (el: SVGCircleElement | null) => void }) {
  const shown = useLastNonNull(progress)
  const visual = PROGRESS_VISUALS[shown?.stage ?? 'upload']
  return (
    <Layer
      {...base}
      state="progress"
      className={styles.layerProg}
      style={toneStyle(visual.tone)}
      replayKey={shown ? `${shown.id}:${shown.stage}` : null}
    >
      <span className={styles.progLeft}>
        <IslandIcon name={visual.icon} className={styles.progIcon} />
        <span className={styles.progLabel}>{shown?.label}</span>
      </span>
      <ProgressRing barRef={ringRef} />
    </Layer>
  )
}
