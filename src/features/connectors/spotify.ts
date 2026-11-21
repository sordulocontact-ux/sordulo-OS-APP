import type { SpotifyStatus } from '../../shared/desktop-contract'
import type { BadgeTone } from '../../components/ui/Badge'

export type SpotifyAction = 'connect' | 'reconnect' | 'disconnect'

export interface SpotifyContext {
  /** Dans l'app de bureau (Tauri) ou sur le web. */
  desktop: boolean
  /** VITE_SPOTIFY_CLIENT_ID ; vide ou absent = connexion impossible. */
  clientId: string | undefined
}

export interface SpotifyView {
  badge: { tone: BadgeTone; label: string }
  /** Phrase d'état affichée dans la fenêtre Détails. */
  state: string
  /** Complément (type de compte), quand connecté. */
  hint?: string
  /** Message d'avertissement ou de configuration (hors erreur d'appel). */
  notice?: string
  action: { kind: SpotifyAction | null; label: string; disabled: boolean; loading: boolean; title?: string }
  /** Compte pour le filtre « Connectés ». */
  connected: boolean
}

export const SPOTIFY_MISSING_CLIENT_ID = 'Client ID Spotify manquant (VITE_SPOTIFY_CLIENT_ID dans .env.local)'
export const SPOTIFY_WEB_TITLE = 'Se connecte depuis l’app de bureau'

export function spotifyClientId(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export function describeSpotify(status: SpotifyStatus | null, ctx: SpotifyContext): SpotifyView {
  if (!ctx.desktop) {
    return {
      badge: { tone: 'neutral', label: 'App de bureau' },
      state: 'Se connecte depuis l’app de bureau : la connexion est propre à chaque ordinateur.',
      action: { kind: null, label: 'Connecter', disabled: true, loading: false, title: SPOTIFY_WEB_TITLE },
      connected: false,
    }
  }
  const missing = !ctx.clientId?.trim()
  const s: SpotifyStatus = status ?? { connected: false, account: null, premium: false, needsReconnect: false, connecting: false }

  if (s.connecting) {
    return {
      badge: { tone: 'neutral', label: 'En cours' },
      state: 'Connexion dans le navigateur…',
      action: { kind: null, label: 'Connexion dans le navigateur…', disabled: true, loading: true },
      connected: false,
    }
  }
  if (s.needsReconnect) {
    return {
      badge: { tone: 'warning', label: 'À reconnecter' },
      state: 'L’accès à Spotify a été perdu : reconnectez le compte.',
      notice: missing ? SPOTIFY_MISSING_CLIENT_ID : undefined,
      action: { kind: 'reconnect', label: 'Reconnecter', disabled: missing, loading: false },
      connected: false,
    }
  }
  if (s.connected) {
    return {
      badge: { tone: 'success', label: 'Connecté' },
      state: s.account ? `Connecté : ${s.account}` : 'Connecté',
      hint: s.premium ? 'Premium : commandes depuis l’île' : 'Compte gratuit : affichage seulement',
      action: { kind: 'disconnect', label: 'Déconnecter', disabled: false, loading: false },
      connected: true,
    }
  }
  return {
    badge: { tone: 'neutral', label: 'Non connecté' },
    state: 'Non connecté : la musique d’un autre appareil n’apparaît pas dans l’île.',
    notice: missing ? SPOTIFY_MISSING_CLIENT_ID : undefined,
    action: { kind: 'connect', label: 'Connecter', disabled: missing, loading: false },
    connected: false,
  }
}
