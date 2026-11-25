import { useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useCurrentMember } from '../auth/useCurrentMember'
import { isMonday, recapNotificationBody, recapWeeks } from './recapLogic'

/** Type de la notification (create_notification accepte tout type en [a-z0-9_.]). */
export const RECAP_NOTIFICATION_KIND = 'recap.weekly'

function alreadyTried(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function markTried(key: string): void {
  try {
    window.sessionStorage.setItem(key, '1')
  } catch {
    // Stockage indisponible : la base dédoublonne de toute façon.
  }
}

/**
 * Le lundi (Paris), à la première ouverture de l'app, crée « Récap de la semaine » pour le membre connecté.
 * Dédoublonnée par la base (`recap-<AAAA-Www>`, semaine ISO du lundi) : plusieurs onglets, appareils ou
 * rechargements n'en créent qu'une. Pas de cron : tout se calcule à l'ouverture. À monter dans AppLayout.
 */
export function useWeeklyRecapNotification(): void {
  const { member } = useCurrentMember()
  const memberId = member?.id
  const role = member?.role

  useEffect(() => {
    if (!memberId || role === 'prospection' || !isMonday()) return
    const weeks = recapWeeks()
    const dedupeKey = `recap-${weeks.key}`
    const storageKey = `sordulo.${dedupeKey}.${memberId}`
    if (alreadyTried(storageKey)) return
    markTried(storageKey)
    void supabase
      .rpc('create_notification', {
        p_member_id: memberId,
        p_kind: RECAP_NOTIFICATION_KIND,
        p_title: 'Récap de la semaine',
        p_body: recapNotificationBody(weeks.previous),
        p_link: '/recap',
        p_payload: { week: weeks.key },
        p_dedupe_key: dedupeKey,
      })
      .then(({ error }) => {
        // Échec réseau ou droit : on retentera à la prochaine session (la clé de session est retirée).
        if (error) {
          try {
            window.sessionStorage.removeItem(storageKey)
          } catch {
            // Sans stockage, rien à retirer.
          }
        }
      })
  }, [memberId, role])
}
