/**
 * Données des notifications du membre connecté : liste, nombre de non lues, marquer comme lu, temps réel.
 * La RLS ne montre que ses propres notifications ; on filtre en plus sur son membre (multi-organisation).
 */
import { useEffect, useId } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { AppNotification } from '../../shared/types'
import { useCurrentMember } from '../auth/useCurrentMember'

/** Clés TanStack Query de la feature (toutes sous `notifications/<membre>`). */
export const notificationKeys = {
  all: (memberId: string) => ['notifications', memberId] as const,
  list: (memberId: string, limit: number) => ['notifications', memberId, 'list', limit] as const,
  unread: (memberId: string) => ['notifications', memberId, 'unread'] as const,
}

/** Nombre de notifications montrées dans le panneau de la cloche. */
export const BELL_LIMIT = 15
/** Nombre de notifications chargées sur la page /notifications. */
export const PAGE_LIMIT = 200

/** Notifications récentes du membre, les plus récentes d'abord. */
export function useNotifications(limit: number) {
  const { member } = useCurrentMember()
  const memberId = member?.id ?? ''
  return useQuery({
    queryKey: notificationKeys.list(memberId, limit),
    enabled: Boolean(memberId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false })
        .limit(limit)
        .overrideTypes<AppNotification[], { merge: false }>()
      if (error) throw error
      return data
    },
  })
}

/** Nombre de notifications non lues du membre (compte exact, sans charger les lignes). */
export function useUnreadCount() {
  const { member } = useCurrentMember()
  const memberId = member?.id ?? ''
  return useQuery({
    queryKey: notificationKeys.unread(memberId),
    enabled: Boolean(memberId),
    queryFn: async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('member_id', memberId)
        .is('read_at', null)
      if (error) throw error
      return count ?? 0
    },
  })
}

/** Marque des notifications comme lues (ou non lues), puis recharge. */
export function useSetRead() {
  const queryClient = useQueryClient()
  const { member } = useCurrentMember()
  const memberId = member?.id ?? ''
  return useMutation({
    mutationFn: async ({ ids, read }: { ids: readonly string[]; read: boolean }) => {
      if (ids.length === 0) return
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: read ? new Date().toISOString() : null })
        .in('id', [...ids])
      if (error) throw error
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all(memberId) }),
  })
}

/** Marque toutes les notifications non lues du membre comme lues. */
export function useMarkAllRead() {
  const queryClient = useQueryClient()
  const { member } = useCurrentMember()
  const memberId = member?.id ?? ''
  return useMutation({
    mutationFn: async () => {
      if (!memberId) return
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('member_id', memberId)
        .is('read_at', null)
      if (error) throw error
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all(memberId) }),
  })
}

/**
 * Temps réel : toute insertion ou mise à jour d'une notification du membre recharge la liste et le compte
 * (Supabase Realtime, postgres_changes filtré sur member_id ; la RLS s'applique aux événements).
 * Nom de canal propre à chaque composant monté : la cloche et la page peuvent écouter en même temps.
 */
export function useNotificationsRealtime() {
  const queryClient = useQueryClient()
  const { member } = useCurrentMember()
  const memberId = member?.id ?? ''
  const instance = useId()
  useEffect(() => {
    if (!memberId) return
    const refresh = () => void queryClient.invalidateQueries({ queryKey: notificationKeys.all(memberId) })
    const filter = `member_id=eq.${memberId}`
    const channel = supabase
      .channel(`notifications-${memberId}-${instance}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter }, refresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter }, refresh)
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [memberId, instance, queryClient])
}

export interface CreateNotificationParams {
  /** Destinataire (membre actif de l'organisation, soi-même compris). */
  memberId: string
  /** Type : lettres minuscules, chiffres, « . » et « _ » (ex. « invoice.overdue »). */
  kind: string
  title: string
  body?: string | null
  /** Route de l'app, commence par « / ». */
  link?: string | null
  payload?: Record<string, unknown>
  /** Une seule notification par destinataire et clé (récap du lundi, relances, seuils…). */
  dedupeKey?: string | null
}

/**
 * Crée une notification par la RPC create_notification. Renvoie son id, ou null si la clé de
 * dédoublonnage existe déjà pour ce destinataire (ou s'il est retiré). Erreur Supabase sinon.
 */
export async function createNotification(params: CreateNotificationParams): Promise<string | null> {
  const { data, error } = await supabase.rpc('create_notification', {
    p_member_id: params.memberId,
    p_kind: params.kind,
    p_title: params.title,
    p_body: params.body ?? null,
    p_link: params.link ?? null,
    p_payload: params.payload ?? {},
    p_dedupe_key: params.dedupeKey ?? null,
  })
  if (error) throw error
  return typeof data === 'string' ? data : null
}
