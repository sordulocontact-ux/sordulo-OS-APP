/**
 * Contenu de la bulle de l'activité secondaire (prototype : bubbleContent) : icône d'appel, pochette,
 * icône Claude ou anneau de progression.
 */
import type { Activity, IslandMusic } from '../types'
import { ProgressRing } from './layers/ActivityLayers'
import { CallIcon, ClaudeIcon, IslandIcon, MusicCover } from './icons'
import styles from './Island.module.css'
import { PROGRESS_VISUALS, toneStyle } from './tone'

export function BubbleContent({
  activity,
  music = null,
  ringRef,
}: {
  activity: Activity | null
  /** Lecture en cours : petite pochette (ou dégradé de repli) quand la musique est dans la bulle. */
  music?: IslandMusic | null
  ringRef: (el: SVGCircleElement | null) => void
}) {
  if (!activity) return null
  switch (activity.kind) {
    case 'meet':
      return <CallIcon service={activity.service} />
    case 'music':
      return <MusicCover artworkUrl={music?.artworkUrl} />
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
