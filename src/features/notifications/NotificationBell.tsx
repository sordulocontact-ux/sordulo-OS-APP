import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button, ErrorState, Spinner } from '../../components/ui'
import bellIcon from '../../assets/nav/bell.svg'
import { NotificationIcon } from './NotificationIcon'
import { bellLabel, notificationKindInfo, safeLink, timeAgo, unreadBadgeText } from './notificationLogic'
import { BELL_LIMIT, useMarkAllRead, useNotifications, useNotificationsRealtime, useSetRead, useUnreadCount } from './useNotifications'
import type { AppNotification } from '../../shared/types'
import styles from './NotificationBell.module.css'

export interface NotificationBellProps {
  /**
   * Où s'ouvre le panneau : à droite du bouton, aligné en bas (bas de la barre latérale, par défaut) ou en haut
   * (haut de la barre latérale), ou sous le bouton aligné à droite (en-tête).
   */
  placement?: 'right-end' | 'right-start' | 'bottom-end'
}

/**
 * Cloche des notifications : pastille du nombre de non lues, panneau des plus récentes. Mise à jour en direct
 * (Supabase Realtime). Clic sur une notification : marquée lue, puis navigation vers son lien.
 * Clavier : flèches entre les notifications, Échap ferme et rend le focus au bouton, Tab hors du panneau le ferme.
 */
export function NotificationBell({ placement = 'right-end' }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const titleId = useId()

  useNotificationsRealtime()
  const unread = useUnreadCount()
  const list = useNotifications(BELL_LIMIT)
  const setRead = useSetRead()
  const markAll = useMarkAllRead()
  const count = unread.data ?? 0
  const badge = unreadBadgeText(count)

  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])

  // À l'ouverture, le focus va sur la première notification (sinon sur le panneau).
  useEffect(() => {
    if (!open) return
    const first = panelRef.current?.querySelector<HTMLElement>('[data-notification-item]')
    ;(first ?? panelRef.current)?.focus()
  }, [open])

  function close(restoreFocus: boolean) {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  // Sur le conteneur : marche aussi quand le focus est resté sur le bouton.
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-notification-item]') ?? [])]
    if (items.length === 0) return
    event.preventDefault()
    const current = items.indexOf(document.activeElement as HTMLElement)
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[current === -1 && event.key === 'ArrowUp' ? items.length - 1 : next]?.focus()
  }

  function onPanelBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null
    if (next && !rootRef.current?.contains(next)) setOpen(false)
  }

  function openNotification(notification: AppNotification) {
    if (!notification.read_at) setRead.mutate({ ids: [notification.id], read: true })
    setOpen(false)
  }

  return (
    <div className={styles.root} ref={rootRef} onKeyDown={onKey}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.button}
        aria-label={bellLabel(count)}
        title="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <img src={bellIcon} alt="" width={16} height={16} />
        {badge ? <span className={styles.dot} aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div
          id={panelId}
          ref={panelRef}
          className={[styles.panel, styles[placement]].join(' ')}
          role="dialog"
          aria-labelledby={titleId}
          tabIndex={-1}
          onBlur={onPanelBlur}
        >
          <div className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              Notifications
            </h2>
            <Button variant="ghost" size="sm" onClick={() => markAll.mutate()} disabled={count === 0} loading={markAll.isPending}>
              Tout marquer comme lu
            </Button>
          </div>
          <div className={styles.body}>
            {list.isLoading ? (
              <div className={styles.state}>
                <Spinner label="Chargement des notifications" />
              </div>
            ) : list.isError ? (
              <ErrorState message="Impossible de charger les notifications." onRetry={() => void list.refetch()} />
            ) : !list.data || list.data.length === 0 ? (
              <div className={styles.state}>
                <p className={styles.emptyTitle}>Aucune notification</p>
                <p className={styles.muted}>Tu seras prévenu ici à chaque passage de main.</p>
              </div>
            ) : (
              <ul className={styles.list}>
                {list.data.map((notification) => (
                  <li key={notification.id}>
                    <NotificationRow notification={notification} onOpen={() => openNotification(notification)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={styles.footer}>
            <Link to="/notifications" className={styles.seeAll} onClick={() => setOpen(false)}>
              Tout voir
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function NotificationRow({ notification, onOpen }: { notification: AppNotification; onOpen: () => void }) {
  const link = safeLink(notification.link)
  const unread = !notification.read_at
  const content = (
    <>
      <span className={styles.icon}>
        <NotificationIcon kind={notification.kind} />
      </span>
      <span className={styles.text}>
        <span className={[styles.itemTitle, unread ? styles.unreadTitle : ''].filter(Boolean).join(' ')}>{notification.title}</span>
        {notification.body ? <span className={styles.itemBody}>{notification.body}</span> : null}
        <span className={styles.meta}>
          {notificationKindInfo(notification.kind).label} · <time dateTime={notification.created_at}>{timeAgo(notification.created_at)}</time>
        </span>
      </span>
      {unread ? (
        <span className={styles.dot}>
          <span className="visually-hidden">Non lue</span>
        </span>
      ) : null}
    </>
  )
  const className = [styles.item, unread ? styles.unread : ''].filter(Boolean).join(' ')
  return link ? (
    <Link to={link} className={className} onClick={onOpen} data-notification-item="">
      {content}
    </Link>
  ) : (
    <button type="button" className={className} onClick={onOpen} data-notification-item="">
      {content}
    </button>
  )
}
