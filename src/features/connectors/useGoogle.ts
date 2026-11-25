import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { googleCancelConnect, googleConnect, googleStatus, isDesktop, onGoogle } from '../../lib/desktop'
import {
  deleteGoogleConnection,
  readGoogleConnections,
  saveGoogleAuthorization,
  type GoogleService,
} from '../../lib/google'
import { GOOGLE_NAMES, describeGoogle, type GoogleAction, type GoogleView } from './google'

// Clé locale : src/lib/queryKeys.ts n'est pas de ce lot.
const GOOGLE_CONNECTIONS_KEY = ['google-connections'] as const

export interface GoogleConnector {
  view: GoogleView
  /** Erreur de la connexion ou de la déconnexion (la lecture a sa propre vue « Erreur »). */
  error: string | null
  run: (kind: GoogleAction) => void
}

function messageOf(e: unknown): string {
  const text = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return text || 'L’opération a échoué. Réessayez.'
}

/** Connexion d'un service Google du compte Sordulo OS (web et app de bureau). Les jetons ne sortent jamais de ce hook. */
export function useGoogle(service: GoogleService): GoogleConnector {
  const desktop = isDesktop()
  const client = useQueryClient()
  const query = useQuery({ queryKey: GOOGLE_CONNECTIONS_KEY, queryFn: readGoogleConnections })
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [connectingService, setConnectingService] = useState<GoogleService | null>(null)
  /** L'autorisation en cours a été annulée : son erreur n'est pas montrée. */
  const [cancelled, setCancelled] = useState(false)

  useEffect(() => {
    if (!desktop) return
    let alive = true
    let unlisten: (() => void) | undefined
    const apply = (s: { configured: boolean; connecting: GoogleService | null }) => {
      if (!alive) return
      setConfigured(s.configured)
      setConnectingService(s.connecting)
    }
    googleStatus().then(apply, () => undefined)
    onGoogle(apply).then(
      (off) => (alive ? (unlisten = off) : off()),
      () => undefined,
    )
    return () => {
      alive = false
      unlisten?.()
    }
  }, [desktop])

  const refresh = useCallback(() => client.invalidateQueries({ queryKey: GOOGLE_CONNECTIONS_KEY }), [client])

  const connect = useMutation({
    mutationFn: async () => {
      setCancelled(false)
      const authorization = await googleConnect({ service })
      await saveGoogleAuthorization(authorization)
    },
    onSettled: refresh,
  })

  const remove = useMutation({
    mutationFn: () => deleteGoogleConnection(service),
    onSettled: refresh,
  })

  const run = useCallback(
    (kind: GoogleAction) => {
      if (kind === 'connect' || kind === 'reconnect') {
        connect.reset()
        connect.mutate()
      } else if (kind === 'disconnect') {
        remove.reset()
        remove.mutate()
      } else if (kind === 'cancel') {
        setCancelled(true)
        googleCancelConnect().catch((e: unknown) => console.warn('[connecteurs] annulation Google impossible :', e))
      } else {
        void query.refetch()
      }
    },
    [connect, remove, query],
  )

  const view = describeGoogle({
    service,
    desktop,
    loading: query.isPending,
    loadFailed: query.isError,
    connection: query.data?.[service] ?? null,
    configured,
    connecting: connect.isPending || connectingService === service,
    otherConnecting: connectingService !== null && connectingService !== service,
    disconnecting: remove.isPending,
  })

  const failure = connect.isError && !cancelled ? connect.error : remove.isError ? remove.error : null
  return {
    view,
    error: failure ? `${GOOGLE_NAMES[service]} : ${messageOf(failure)}` : null,
    run,
  }
}
