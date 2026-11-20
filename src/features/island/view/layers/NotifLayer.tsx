/**
 * Notification : icône ou avatar, titre, sous-titre, bouton, barre de temps (pause au survol), et la ligne
 * d'appel au-dessus pendant un appel (notifCall : icône, onde et minuteur partagés).
 */
import { Fragment, type CSSProperties } from 'react'
import type { IslandNotification } from '../../types'
import { cx } from '../cx'
import { useLastNonNull } from '../hooks'
import { ClaudeIcon, IslandIcon } from '../icons'
import styles from '../Island.module.css'
import { Layer } from '../Layer'
import { toneStyle } from '../tone'
import type { BaseLayerProps } from './CallLayers'

function NotifVisual({ notification }: { notification: IslandNotification }) {
  const { visual } = notification
  if (visual.type === 'avatar') {
    return (
      <span className={cx(styles.notifIcon, styles.notifAvatar)} aria-hidden="true">
        {visual.initials}
      </span>
    )
  }
  return (
    <span className={styles.notifIcon} style={toneStyle(notification.tone)} aria-hidden="true">
      {visual.type === 'claude' ? <ClaudeIcon /> : <IslandIcon name={visual.icon} />}
    </span>
  )
}

export function NotifLayer({
  notification,
  onNotificationAction,
  ...base
}: BaseLayerProps & {
  notification: IslandNotification | null
  onNotificationAction: (notification: IslandNotification) => void
}) {
  const shown = useLastNonNull(notification)
  const style: Record<string, string> = {}
  if (shown) style['--nd'] = `${shown.durationMs}ms`
  return (
    <Layer
      {...base}
      state="notif"
      className={cx(styles.layerNotif, base.withCall && styles.withCall)}
      style={style as CSSProperties}
      label={shown?.title}
      replayKey={shown?.id ?? null}
    >
      <span className={styles.notifCall} aria-hidden="true" />
      {shown && (
        // La clé relance la coche et la barre de temps à chaque nouvelle notification.
        <Fragment key={shown.id}>
          <NotifVisual notification={shown} />
          <span className={styles.notifText}>
            <strong>{shown.title}</strong>
            <small>{shown.subtitle}</small>
          </span>
          {shown.button && (
            <button
              type="button"
              className={cx(styles.btn, styles.btnMain, styles.btnSm)}
              onClick={() => onNotificationAction(shown)}
            >
              {shown.button}
            </button>
          )}
          <span className={styles.notifProgress} aria-hidden="true" />
        </Fragment>
      )}
    </Layer>
  )
}
