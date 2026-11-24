import type { BadgeTone } from '../../components/ui/Badge'
import { spotifyConnectionState, type SpotifyAccountConnection } from '../../lib/spotify'

/** `connect` et `reconnect` ouvrent la fenêtre du Client ID ; `retry` relit la connexion. */
export type SpotifyAction = 'connect' | 'reconnect' | 'disconnect' | 'retry'

export interface SpotifyContext {
  /** Dans l'app de bureau (Tauri) ou sur le web. */
  desktop: boolean
  /** Lecture de la ligne du compte en cours. */
  loading: boolean
  /** Échec de la lecture (réseau, droits). */
  loadFailed: boolean
  /** Ligne du compte (table spotify_connections), null s'il n'y en a pas. */
  connection: SpotifyAccountConnection | null
  /** Autorisation qui attend dans le navigateur (app de bureau). */
  connecting: boolean
  disconnecting: boolean
}

export interface SpotifyView {
  badge: { tone: BadgeTone; label: string }
  /** Phrase d'état affichée dans la carte et la fenêtre Détails. */
  state: string
  /** Complément (type de compte), quand connecté. */
  hint?: string
  /** Information complémentaire (sur le web : l'autorisation se fait depuis l'app de bureau). */
  notice?: string
  action: { kind: SpotifyAction | null; label: string; disabled: boolean; loading: boolean; title?: string }
  /** Compte pour le filtre « Connectés ». */
  connected: boolean
}

export const SPOTIFY_WEB_NOTICE = 'L’autorisation du compte Spotify se fait depuis l’app de bureau.'

/** Messages de la fenêtre du Client ID. Ne contiennent jamais de jeton. */
export const SPOTIFY_CLIENT_ID_EMPTY = 'Collez le Client ID de votre app Spotify.'
export const SPOTIFY_CLIENT_ID_INVALID =
  'Ce Client ID n’a pas la bonne forme : 32 lettres et chiffres, copiés depuis les réglages de votre app Spotify.'

export function describeSpotify(ctx: SpotifyContext): SpotifyView {
  if (ctx.loading) {
    return {
      badge: { tone: 'neutral', label: 'Chargement' },
      state: 'Lecture de la connexion…',
      action: { kind: null, label: 'Connecter', disabled: true, loading: true },
      connected: false,
    }
  }
  if (ctx.loadFailed) {
    return {
      badge: { tone: 'warning', label: 'Erreur' },
      state: 'La connexion Spotify n’a pas pu être lue.',
      action: { kind: 'retry', label: 'Réessayer', disabled: false, loading: false },
      connected: false,
    }
  }
  if (ctx.desktop && ctx.connecting) {
    return {
      badge: { tone: 'neutral', label: 'En cours' },
      state: 'Connexion dans le navigateur…',
      action: { kind: null, label: 'Connexion dans le navigateur…', disabled: true, loading: true },
      connected: false,
    }
  }
  const notice = ctx.desktop ? undefined : SPOTIFY_WEB_NOTICE
  const row = ctx.connection
  switch (spotifyConnectionState(row)) {
    case 'connected':
      return {
        badge: { tone: 'success', label: 'Connecté' },
        state: row?.account ? `Connecté : ${row.account}` : 'Connecté',
        hint: row?.premium ? 'Premium : commandes depuis l’île' : 'Compte gratuit : affichage seulement',
        action: {
          kind: 'disconnect',
          label: 'Déconnecter',
          disabled: ctx.disconnecting,
          loading: ctx.disconnecting,
        },
        connected: true,
      }
    case 'lost':
      return {
        badge: { tone: 'warning', label: 'À reconnecter' },
        state: row?.account
          ? `L’accès au compte Spotify ${row.account} a été perdu : reconnectez-le.`
          : 'L’accès à Spotify a été perdu : reconnectez le compte.',
        notice,
        action: { kind: 'reconnect', label: 'Reconnecter', disabled: false, loading: false },
        connected: false,
      }
    case 'clientId':
      return {
        badge: { tone: 'neutral', label: 'Non connecté' },
        state: ctx.desktop
          ? 'Client ID enregistré : connectez le compte Spotify.'
          : 'Client ID enregistré : connectez le compte Spotify depuis l’app de bureau.',
        notice,
        action: {
          kind: 'connect',
          label: ctx.desktop ? 'Connecter' : 'Modifier le Client ID',
          disabled: false,
          loading: false,
        },
        connected: false,
      }
    case 'none':
      return {
        badge: { tone: 'neutral', label: 'Non connecté' },
        state: 'Non connecté : la musique d’un autre appareil n’apparaît pas dans l’île.',
        notice,
        action: { kind: 'connect', label: 'Connecter', disabled: false, loading: false },
        connected: false,
      }
  }
}
