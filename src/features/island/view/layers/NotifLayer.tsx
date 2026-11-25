/**
 * Notification : icône ou avatar, titre, sous-titre, bouton (et un deuxième, `secondary`, à sa gauche), barre de
 * temps (pause au survol), et la ligne d'appel au-dessus pendant un appel (notifCall : icône, onde et minuteur
 * partagés). Avec deux boutons, la forme s'élargit (NOTIF_SECONDARY) : titre et sous-titre restent lisibles.
 */
import { Fragment, type CSSProperties } from 'react'
import { islandSize } from '../../geometry'
import type { IslandNotification, NotificationAction } from '../../types'
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
  onNotificationAction: (notification: IslandNotification, action?: NotificationAction) => void
}) {
  const shown = useLastNonNull(notification)
  const secondary = shown?.secondary ?? null
  const style: Record<string, string | number> = {}
  if (shown) style['--nd'] = `${shown.durationMs}ms`
  if (secondary) {
    style.width = islandSize(base.platform, base.withCall ? 'notifCall' : 'notif', 0, true, true, {
      notifSecondary: true,
    }).w
  }
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
          {shown.action.type === 'openSession' && !shown.button ? (
            // Notification Claude : un clic ouvre la fenêtre VS Code de la session.
            <button
              type="button"
              className={styles.notifOpen}
              onClick={() => onNotificationAction(shown)}
              aria-label={`${shown.title}, ${shown.subtitle} : ouvrir dans l'éditeur`}
            >
              <NotifVisual notification={shown} />
              <span className={styles.notifText}>
                <strong>{shown.title}</strong>
                <small>{shown.subtitle}</small>
              </span>
            </button>
          ) : (
            <>
              <NotifVisual notification={shown} />
              <span className={styles.notifText}>
                <strong>{shown.title}</strong>
                <small>{shown.subtitle}</small>
              </span>
            </>
          )}
          {secondary && (
            <button
              type="button"
              className={cx(styles.btn, styles.btnGhost, styles.btnSm)}
              onClick={() => onNotificationAction(shown, secondary.action)}
            >
              {secondary.label}
            </button>
          )}
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
