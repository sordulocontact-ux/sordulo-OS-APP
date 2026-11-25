import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ActionsMenu, Button, EmptyState, ErrorState, ListToolbar, LoadingState, useToast, type ActionsMenuItem } from '../../components/ui'
import table from '../../components/ui/dataTable.module.css'
import type { AppNotification } from '../../shared/types'
import { NotificationIcon } from './NotificationIcon'
import { notificationKindInfo, notificationMatches, safeLink, timeAgo } from './notificationLogic'
import { PAGE_LIMIT, useMarkAllRead, useNotifications, useSetRead, useUnreadCount } from './useNotifications'
import styles from './notifications.module.css'

const fullDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' })

/** Page /notifications : toutes les notifications récentes, filtre « non lues » dans l'URL (?filtre=non-lues). */
export function NotificationsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const unreadOnly = params.get('filtre') === 'non-lues'
  const { data, isLoading, isError, refetch } = useNotifications(PAGE_LIMIT)
  const unread = useUnreadCount()
  const setRead = useSetRead()
  const markAll = useMarkAllRead()
  const unreadCount = unread.data ?? 0

  const visible = useMemo(
    () => (data ?? []).filter((n) => (!unreadOnly || !n.read_at) && notificationMatches(n, query)),
    [data, unreadOnly, query],
  )

  function setUnreadOnly(value: boolean) {
    const next = new URLSearchParams(params)
    if (value) next.set('filtre', 'non-lues')
    else next.delete('filtre')
    setParams(next, { replace: true })
  }

  function toggleRead(notification: AppNotification) {
    setRead.mutate(
      { ids: [notification.id], read: !notification.read_at },
      { onError: () => toast.error('Impossible de modifier la notification. Réessaie.') },
    )
  }

  function markAllRead() {
    markAll.mutate(undefined, {
      onSuccess: () => toast.success('Toutes les notifications sont lues'),
      onError: () => toast.error('Impossible de tout marquer comme lu. Réessaie.'),
    })
  }

  const actions = (notification: AppNotification): ActionsMenuItem[] => {
    const link = safeLink(notification.link)
    return [
      ...(link
        ? [
            {
              label: 'Ouvrir',
              onSelect: () => {
                if (!notification.read_at) setRead.mutate({ ids: [notification.id], read: true })
                void navigate(link)
              },
            },
          ]
        : []),
      { label: notification.read_at ? 'Marquer comme non lue' : 'Marquer comme lue', onSelect: () => toggleRead(notification) },
    ]
  }

  return (
    <section className={table.page} aria-labelledby="notifications-title">
      <div className={styles.titleRow}>
        <h1 id="notifications-title">Notifications</h1>
        <Button variant="secondary" onClick={markAllRead} disabled={unreadCount === 0} loading={markAll.isPending}>
          Tout marquer comme lu
        </Button>
      </div>
      <ListToolbar
        search={{ value: query, onChange: setQuery, label: 'Rechercher une notification', placeholder: 'Titre, texte, type' }}
        activeFilterCount={unreadOnly ? 1 : 0}
        onResetFilters={() => setUnreadOnly(false)}
        addLabel="Nouvelle notification"
        filters={
          <label className={styles.check}>
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            Non lues seulement
          </label>
        }
      />
      {isLoading ? (
        <LoadingState label="Chargement des notifications…" />
      ) : isError ? (
        <ErrorState message="Impossible de charger les notifications." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="Aucune notification" text="Tu seras prévenu ici à chaque passage de main : tâche attribuée, tickets à valider, proposition de l’IA…" />
      ) : visible.length === 0 ? (
        <EmptyState
          title={unreadOnly && query.trim() === '' ? 'Tout est lu' : 'Aucune notification ne correspond à la recherche ni aux filtres.'}
          action={
            unreadOnly ? (
              <Button variant="secondary" size="sm" onClick={() => setUnreadOnly(false)}>
                Voir toutes les notifications
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={table.scroll}>
          <table className={table.table}>
            <thead>
              <tr>
                <th scope="col">Notification</th>
                <th scope="col" className={styles.kindCol}>
                  Type
                </th>
                <th scope="col" className={styles.dateCol}>
                  Reçue
                </th>
                <th scope="col" className={table.actionsCell}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((notification) => {
                const link = safeLink(notification.link)
                const isUnread = !notification.read_at
                const title = (
                  <span className={isUnread ? styles.unreadTitle : undefined}>
                    {notification.title}
                    {isUnread ? <span className="visually-hidden"> (non lue)</span> : null}
                  </span>
                )
                return (
                  <tr key={notification.id} className={table.row}>
                    <td>
                      <span className={styles.nameCell}>
                        <span className={styles.icon}>
                          <NotificationIcon kind={notification.kind} />
                        </span>
                        <span className={styles.text}>
                          {link ? (
                            <Link
                              to={link}
                              className={table.rowLink}
                              onClick={() => {
                                if (isUnread) setRead.mutate({ ids: [notification.id], read: true })
                              }}
                            >
                              {title}
                            </Link>
                          ) : (
                            title
                          )}
                          {notification.body ? <span className={table.secondLine}>{notification.body}</span> : null}
                        </span>
                        {isUnread ? <span className={styles.dot} aria-hidden="true" /> : null}
                      </span>
                    </td>
                    <td>{notificationKindInfo(notification.kind).label}</td>
                    <td>
                      <time dateTime={notification.created_at} title={fullDate.format(new Date(notification.created_at))}>
                        {timeAgo(notification.created_at)}
                      </time>
                    </td>
                    <td className={table.actionsCell}>
                      <ActionsMenu label={`Actions pour « ${notification.title} »`} items={actions(notification)} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && data.length >= PAGE_LIMIT ? (
        <p className={table.muted}>Les {PAGE_LIMIT} notifications les plus récentes sont affichées.</p>
      ) : null}
    </section>
  )
}
