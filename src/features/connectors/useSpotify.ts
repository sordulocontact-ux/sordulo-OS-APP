import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  isDesktop,
  onSpotify,
  spotifyCancelConnect,
  spotifyConnect,
  spotifySetConnection,
  spotifyStatus,
} from '../../lib/desktop'
import {
  cleanSpotifyClientId,
  desktopConnectionOf,
  forgetSpotifyAccount,
  isValidSpotifyClientId,
  readSpotifyConnection,
  saveSpotifyAuthorization,
  saveSpotifyClientId,
} from '../../lib/spotify'
import {
  SPOTIFY_CLIENT_ID_EMPTY,
  SPOTIFY_CLIENT_ID_INVALID,
  describeSpotify,
  type SpotifyAction,
  type SpotifyView,
} from './spotify'

// Clé locale : src/lib/queryKeys.ts n'est pas de ce lot.
const SPOTIFY_CONNECTION_KEY = ['spotify-connection'] as const

export interface SpotifyConnector {
  view: SpotifyView
  /** Erreur de la déconnexion (la lecture a sa propre vue « Erreur »). */
  error: string | null
  /** Dans l'app de bureau : la fenêtre lance aussi l'autorisation (sur le web, elle enregistre le Client ID). */
  desktop: boolean
  /** Client ID déjà enregistré sur le compte (pré-rempli dans la fenêtre), ou chaîne vide. */
  savedClientId: string
  /** Fenêtre du Client ID ouverte (par `run('connect')` ou `run('reconnect')`). */
  connectOpen: boolean
  closeConnect: () => void
  /** Erreur de la fenêtre : `field` sous le champ du Client ID, `form` dans la fenêtre. */
  connectError: { field: string | null; form: string | null }
  /** Enregistrement du Client ID ou autorisation en cours. */
  connecting: boolean
  /** Autorisation qui attend dans le navigateur (app de bureau). */
  waitingForBrowser: boolean
  /**
   * Enregistre le Client ID sur le compte, puis (app de bureau) autorise le compte dans le navigateur et
   * enregistre la connexion. Vrai si c'est fait.
   */
  connect: (clientId: string) => Promise<boolean>
  /** Arrête une autorisation qui attend dans le navigateur. */
  cancelConnect: () => void
  run: (kind: SpotifyAction) => void
  resetConnectError: () => void
}

function messageOf(e: unknown): string {
  const text = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return text || 'L’opération a échoué. Réessayez.'
}

/** Connexion Spotify du compte Sordulo OS (web et app de bureau). Les jetons ne sortent jamais de ce hook. */
export function useSpotify(): SpotifyConnector {
  const desktop = isDesktop()
  const client = useQueryClient()
  const query = useQuery({ queryKey: SPOTIFY_CONNECTION_KEY, queryFn: readSpotifyConnection })
  const [connectOpen, setConnectOpen] = useState(false)
  const [connectError, setConnectError] = useState<{ field: string | null; form: string | null }>({ field: null, form: null })
  /** Autorisation en attente vue par Rust (survit à un démontage de la page). */
  const [rustConnecting, setRustConnecting] = useState(false)
  const [waitingForBrowser, setWaitingForBrowser] = useState(false)
  /** L'autorisation en cours a été annulée : son erreur n'est pas montrée. */
  const cancelled = useRef(false)

  useEffect(() => {
    if (!desktop) return
    let alive = true
    let unlisten: (() => void) | undefined
    spotifyStatus().then(
      (s) => alive && setRustConnecting(s.connecting),
      () => undefined,
    )
    onSpotify((s) => {
      if (alive) setRustConnecting(s.connecting)
    }).then(
      (off) => (alive ? (unlisten = off) : off()),
      () => undefined,
    )
    return () => {
      alive = false
      unlisten?.()
    }
  }, [desktop])

  const refresh = useCallback(() => client.invalidateQueries({ queryKey: SPOTIFY_CONNECTION_KEY }), [client])

  const save = useMutation({
    mutationFn: async (clientId: string) => {
      await saveSpotifyClientId(clientId)
      if (!desktop) return
      cancelled.current = false
      setWaitingForBrowser(true)
      try {
        const authorization = await spotifyConnect({ clientId })
        const row = await saveSpotifyAuthorization(clientId, authorization)
        // Rust prend la connexion tout de suite (l'île la relit aussi régulièrement).
        await spotifySetConnection(desktopConnectionOf(row)).catch((e: unknown) =>
          console.warn('[connecteurs] connexion Spotify non transmise à l’app de bureau :', e),
        )
      } finally {
        setWaitingForBrowser(false)
      }
    },
    onSettled: refresh,
  })

  const remove = useMutation({
    mutationFn: async () => {
      await forgetSpotifyAccount()
      if (desktop) {
        await spotifySetConnection(null).catch((e: unknown) =>
          console.warn('[connecteurs] déconnexion Spotify non transmise à l’app de bureau :', e),
        )
      }
    },
    onSettled: refresh,
  })

  const connect = useCallback(
    async (raw: string) => {
      const clientId = cleanSpotifyClientId(raw)
      setConnectError({ field: null, form: null })
      if (!clientId) {
        setConnectError({ field: SPOTIFY_CLIENT_ID_EMPTY, form: null })
        return false
      }
      if (!isValidSpotifyClientId(clientId)) {
        setConnectError({ field: SPOTIFY_CLIENT_ID_INVALID, form: null })
        return false
      }
      try {
        await save.mutateAsync(clientId)
        return true
      } catch (e) {
        if (!cancelled.current) setConnectError({ field: null, form: messageOf(e) })
        return false
      }
    },
    [save],
  )

  const cancelConnect = useCallback(() => {
    if (!desktop) return
    cancelled.current = true
    spotifyCancelConnect().catch((e: unknown) => console.warn('[connecteurs] annulation Spotify impossible :', e))
  }, [desktop])

  const resetConnectError = useCallback(() => {
    setConnectError({ field: null, form: null })
    save.reset()
  }, [save])

  const run = useCallback(
    (kind: SpotifyAction) => {
      if (kind === 'connect' || kind === 'reconnect') {
        setConnectOpen(true)
      } else if (kind === 'disconnect') {
        remove.reset()
        remove.mutate()
      } else {
        void query.refetch()
      }
    },
    [query, remove],
  )

  const data = query.data ?? null
  const view = describeSpotify({
    desktop,
    loading: query.isPending,
    loadFailed: query.isError,
    connection: data,
    connecting: rustConnecting || waitingForBrowser,
    disconnecting: remove.isPending,
  })

  return {
    view,
    error: remove.isError ? `Spotify : ${messageOf(remove.error)}` : null,
    desktop,
    savedClientId: data?.clientId ?? '',
    connectOpen,
    closeConnect: () => setConnectOpen(false),
    connectError,
    connecting: save.isPending,
    waitingForBrowser,
    connect,
    cancelConnect,
    run,
    resetConnectError,
  }
}
