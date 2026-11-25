/**
 * Moments marqués pendant l'enregistrement (élément partagé `markCount`, à gauche du minuteur, île fermée comme
 * ouverte) : étoile en pixel art et nombre de repères. Un repère ajouté (`lastAddedAt`) fait sauter l'étoile et
 * en lâche une deuxième qui grandit en s'effaçant (MARK_FLASH_MS) ; animations réduites : rien ne bouge, le
 * nombre prend la couleur de l'étoile le temps de l'éclat. Aucun repère et pas d'éclat : rien n'est dessiné.
 */
import { ART } from '../art/pixelArt'
import { PixelArtSvg } from '../art/PixelArtSvg'
import { cx } from './cx'
import { useBefore } from './hooks'
import styles from './Island.module.css'
import { markFlashUntil } from './review'
import type { IslandMarkers } from './types'

export function MarkCount({ markers, reduced }: { markers: IslandMarkers | null; reduced: boolean }) {
  const flashing = useBefore(markFlashUntil(markers))
  const count = markers?.count ?? 0
  if (count === 0 && !flashing) return null
  const flashKey = markers?.lastAddedAt ?? 0
  return (
    <span className={cx(styles.markCount, flashing && styles.markFlash)}>
      <span className={styles.markStar}>
        {/* La clé rejoue le saut de l'étoile à chaque nouveau repère. */}
        <PixelArtSvg key={flashing ? flashKey : 'still'} art={ART.star} className={styles.markStarArt ?? ''} />
        {flashing && !reduced && (
          <PixelArtSvg key={`ping-${flashKey}`} art={ART.star} className={cx(styles.markStarArt, styles.markPing)} />
        )}
      </span>
      {count > 0 && <span className={styles.markNumber}>{count}</span>}
    </span>
  )
}
