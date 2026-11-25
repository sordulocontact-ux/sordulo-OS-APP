import type { BadgeTone } from '../../components/ui/Badge'
import { googleConnectionState, type GoogleAccountConnection, type GoogleService } from '../../lib/google'

/** `connect` et `reconnect` ouvrent le navigateur ; `cancel` arrête l'attente ; `retry` relit la connexion. */
export type GoogleAction = 'connect' | 'reconnect' | 'disconnect' | 'cancel' | 'retry'

export interface GoogleContext {
  service: GoogleService
  /** Dans l'app de bureau (Tauri) ou sur le web. */
  desktop: boolean
  /** Lecture des lignes du compte en cours. */
  loading: boolean
  /** Échec de la lecture (réseau, droits). */
  loadFailed: boolean
  /** Ligne du compte pour ce service (table google_connections), null s'il n'y en a pas. */
  connection: GoogleAccountConnection | null
  /** Identifiants Google compilés dans cette version de l'app de bureau. null : pas encore su. */
  configured: boolean | null
  /** Autorisation de CE service qui attend dans le navigateur. */
  connecting: boolean
  /** Autorisation de l'AUTRE service en cours (une seule à la fois). */
  otherConnecting: boolean
  disconnecting: boolean
}

export interface GoogleView {
  badge: { tone: BadgeTone; label: string }
  /** Phrase d'état affichée dans la carte et la fenêtre Détails. */
  state: string
  /** Complément affiché dans la fenêtre Détails. */
  hint?: string
  action: { kind: GoogleAction | null; label: string; disabled: boolean; loading: boolean; title?: string }
  /** Compte pour le filtre « Connectés ». */
  connected: boolean
}

export const GOOGLE_NAMES: Record<GoogleService, string> = { calendar: 'Google Agenda', gmail: 'Gmail' }

export const GOOGLE_WEB_STATE = 'Dans l’app de bureau'
export const GOOGLE_UNAVAILABLE_STATE = 'Indisponible dans cette version'
export const GOOGLE_TEST_HINT =
  'Lecture seule. Tant que l’app Google de l’agence est en mode Test, Google coupe l’accès au bout de 7 jours : la carte passe alors en « À reconnecter ».'

export function describeGoogle(ctx: GoogleContext): GoogleView {
  const name = GOOGLE_NAMES[ctx.service]
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
      state: `La connexion ${name} n’a pas pu être lue.`,
      action: { kind: 'retry', label: 'Réessayer', disabled: false, loading: false },
      connected: false,
    }
  }
  const row = ctx.connection
  const status = googleConnectionState(row)
  if (ctx.desktop && ctx.connecting) {
    return {
      badge: { tone: 'neutral', label: 'En cours' },
      state: 'Autorisez l’accès dans votre navigateur…',
      hint: GOOGLE_TEST_HINT,
      action: { kind: 'cancel', label: 'Annuler', disabled: false, loading: false },
      connected: false,
    }
  }
  if (status === 'connected') {
    return {
      badge: { tone: 'success', label: 'Connecté' },
      state: row?.account ? `Connecté : ${row.account}` : 'Connecté',
      hint: GOOGLE_TEST_HINT,
      action: { kind: 'disconnect', label: 'Déconnecter', disabled: ctx.disconnecting, loading: ctx.disconnecting },
      connected: true,
    }
  }
  const lost = status === 'lost'
  const badge: GoogleView['badge'] = lost
    ? { tone: 'warning', label: 'À reconnecter' }
    : { tone: 'neutral', label: 'Non connecté' }
  const label = lost ? 'Reconnecter' : 'Connecter'
  const kind: GoogleAction = lost ? 'reconnect' : 'connect'
  const lostState = row?.account
    ? `L’accès au compte ${row.account} a été perdu : reconnectez-le.`
    : `L’accès à ${name} a été perdu : reconnectez le compte.`
  if (!ctx.desktop) {
    return {
      badge,
      state: lost ? `${lostState} ${GOOGLE_WEB_STATE}.` : GOOGLE_WEB_STATE,
      hint: GOOGLE_TEST_HINT,
      action: { kind: null, label, disabled: true, loading: false, title: 'La connexion se fait dans l’app de bureau.' },
      connected: false,
    }
  }
  if (ctx.configured === false) {
    return {
      badge,
      state: GOOGLE_UNAVAILABLE_STATE,
      hint: 'Cette version de l’app de bureau ne contient pas les identifiants Google de l’agence : installe la dernière version.',
      action: { kind: null, label, disabled: true, loading: false, title: GOOGLE_UNAVAILABLE_STATE },
      connected: false,
    }
  }
  return {
    badge,
    state: lost ? lostState : `Non connecté : ${name} n’apparaît pas dans l’île.`,
    hint: GOOGLE_TEST_HINT,
    action: {
      kind,
      label,
      disabled: ctx.otherConnecting,
      loading: false,
      title: ctx.otherConnecting ? 'Une autre autorisation Google est en cours.' : undefined,
    },
    connected: false,
  }
}
