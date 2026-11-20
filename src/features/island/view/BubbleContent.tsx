/**
 * Contenu de la bulle de l'activité secondaire (prototype : bubbleContent) : icône d'appel, pochette,
 * icône Claude ou anneau de progression.
 */
import type { Activity } from '../types'
import { ProgressRing } from './layers/ActivityLayers'
import { CallIcon, ClaudeIcon, IslandIcon } from './icons'
import styles from './Island.module.css'
import { PROGRESS_VISUALS, toneStyle } from './tone'

export function BubbleContent({
  activity,
  ringRef,
}: {
  activity: Activity | null
  ringRef: (el: SVGCircleElement | null) => void
}) {
  if (!activity) return null
  switch (activity.kind) {
    case 'meet':
      return <CallIcon />
    case 'music':
      return <span className={styles.cover} />
    case 'agent':
    case 'multi':
      return <ClaudeIcon />
    case 'progress': {
      const visual = PROGRESS_VISUALS[activity.stage]
      return (
        <span className={styles.bubbleRing} style={toneStyle(visual.tone)}>
          <ProgressRing barRef={ringRef} />
          <IslandIcon name={visual.icon} className={styles.bubbleIco} />
        </span>
      )
    }
  }
}
