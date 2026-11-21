import { useCallback, useEffect, useState } from 'react'
import { isDesktop, onSpotify, spotifyConnect, spotifyDisconnect, spotifyStatus } from '../../lib/desktop'
import type { SpotifyStatus } from '../../shared/desktop-contract'
import { describeSpotify, spotifyClientId, type SpotifyAction, type SpotifyView } from './spotify'

export interface SpotifyConnector {
  view: SpotifyView
  /** Erreur du dernier appel (connexion, déconnexion, lecture). */
  error: string | null
  run: (kind: SpotifyAction) => void
}

function message(e: unknown): string {
  const text = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return text ? `Spotify : ${text}` : 'Spotify : l’opération a échoué. Réessayez.'
}

/** État vivant du connecteur Spotify (app de bureau seulement). */
export function useSpotify(): SpotifyConnector {
  const desktop = isDesktop()
  const clientId = spotifyClientId(import.meta.env.VITE_SPOTIFY_CLIENT_ID)
  const [status, setStatus] = useState<SpotifyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!desktop) return
    let alive = true
    let unlisten: (() => void) | undefined
    spotifyStatus().then(
      (s) => alive && setStatus(s),
      (e: unknown) => alive && setError(message(e)),
    )
    onSpotify((s) => {
      if (alive) {
        setStatus(s)
        setError(null)
      }
    }).then(
      (off) => (alive ? (unlisten = off) : off()),
      () => undefined,
    )
    return () => {
      alive = false
      unlisten?.()
    }
  }, [desktop])

  const run = useCallback(
    (kind: SpotifyAction) => {
      setError(null)
      const call = kind === 'disconnect' ? spotifyDisconnect() : spotifyConnect({ clientId })
      call.then(setStatus, (e: unknown) => setError(message(e)))
    },
    [clientId],
  )

  return { view: describeSpotify(status, { desktop, clientId }), error, run }
}
