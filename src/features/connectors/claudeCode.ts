import type { ClaudeConnection } from '../../shared/desktop-contract'
import type { BadgeTone } from '../../components/ui/Badge'

export type ClaudeCodeAction = 'connect' | 'disconnect'

export interface ClaudeCodeContext {
  /** Dans l'app de bureau (Tauri) ou sur le web. */
  desktop: boolean
  /** Connexion ou déconnexion en cours (appel de commande). */
  busy: boolean
}

export interface ClaudeCodeView {
  badge: { tone: BadgeTone; label: string }
  /** Phrase d'état affichée sur la carte et dans la fenêtre Détails. */
  state: string
  action: { kind: ClaudeCodeAction | null; label: string; disabled: boolean; loading: boolean; title?: string }
  /** Compte pour le filtre « Connectés ». */
  connected: boolean
}

export const CLAUDE_CODE_WEB_TITLE = 'Se connecte depuis l’app de bureau'

/** Relais Claude Code de CET ordinateur : hooks présents dans ~/.claude/settings.json. */
export function describeClaudeCode(connection: ClaudeConnection | null, ctx: ClaudeCodeContext): ClaudeCodeView {
  if (!ctx.desktop) {
    return {
      badge: { tone: 'neutral', label: 'App de bureau' },
      state: 'Se connecte depuis l’app de bureau : le relais est propre à chaque ordinateur.',
      action: { kind: null, label: 'Connecter', disabled: true, loading: false, title: CLAUDE_CODE_WEB_TITLE },
      connected: false,
    }
  }
  const connected = connection?.connected ?? false
  if (ctx.busy) {
    return {
      badge: { tone: 'neutral', label: 'En cours' },
      state: connected ? 'Déconnexion…' : 'Connexion…',
      action: {
        kind: null,
        label: connected ? 'Déconnexion…' : 'Connexion…',
        disabled: true,
        loading: true,
      },
      connected,
    }
  }
  if (connected) {
    return {
      badge: { tone: 'success', label: 'Connecté' },
      state: 'Connecté : les sessions Claude Code de cet ordinateur apparaissent dans l’île.',
      action: { kind: 'disconnect', label: 'Déconnecter', disabled: false, loading: false },
      connected: true,
    }
  }
  return {
    badge: { tone: 'neutral', label: 'Non connecté' },
    state: 'Non connecté : l’île ne voit pas les sessions Claude Code de cet ordinateur.',
    action: { kind: 'connect', label: 'Connecter', disabled: false, loading: false },
    connected: false,
  }
}
