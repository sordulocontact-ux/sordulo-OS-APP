import type { BadgeTone } from '../../components/ui/Badge'

export interface VercelContext {
  /** Lecture de la connexion en cours. */
  loading: boolean
  /** Échec de la lecture (réseau, droits). */
  loadFailed: boolean
  /** Une connexion existe pour ce compte. */
  connected: boolean
  /** Nom du compte Vercel enregistré à la connexion. */
  account: string | null
  /** Déconnexion en cours. */
  disconnecting: boolean
}

export interface VercelView {
  badge: { tone: BadgeTone; label: string }
  state: string
  action: { kind: 'connect' | 'disconnect' | 'retry'; label: string; loading: boolean; disabled: boolean }
  connected: boolean
}

export function describeVercel(ctx: VercelContext): VercelView {
  if (ctx.loading) {
    return {
      badge: { tone: 'neutral', label: 'Chargement' },
      state: 'Lecture de la connexion…',
      action: { kind: 'connect', label: 'Connecter', loading: true, disabled: true },
      connected: false,
    }
  }
  if (ctx.loadFailed) {
    return {
      badge: { tone: 'warning', label: 'Erreur' },
      state: 'La connexion Vercel n’a pas pu être lue.',
      action: { kind: 'retry', label: 'Réessayer', loading: false, disabled: false },
      connected: false,
    }
  }
  if (ctx.connected) {
    return {
      badge: { tone: 'success', label: 'Connecté' },
      state: ctx.account ? `Connecté : ${ctx.account}` : 'Connecté',
      action: { kind: 'disconnect', label: 'Déconnecter', loading: ctx.disconnecting, disabled: ctx.disconnecting },
      connected: true,
    }
  }
  return {
    badge: { tone: 'neutral', label: 'Non connecté' },
    state: 'Non connecté : collez un jeton Vercel pour suivre vos déploiements.',
    action: { kind: 'connect', label: 'Connecter', loading: false, disabled: false },
    connected: false,
  }
}

/** Message de la fenêtre de connexion. Ne contient jamais le jeton. */
export const VERCEL_TOKEN_REFUSED = 'Vercel refuse ce jeton : il est invalide, expiré ou révoqué. Créez-en un nouveau.'
export const VERCEL_TOKEN_EMPTY = 'Collez le jeton créé sur Vercel.'
