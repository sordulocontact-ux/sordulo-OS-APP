import type { UpdateStatus } from '../../shared/desktop-contract'

export type DesktopAppTone = 'muted' | 'success' | 'danger'

export interface DesktopAppAction {
  /** check : rechercher (et télécharger) ; install : installer la version prête, l'app redémarre. */
  kind: 'check' | 'install'
  label: string
  busy: boolean
}

export interface DesktopAppView {
  /** « Version 0.2.3 », vide tant que l'état n'est pas connu. */
  version: string
  status: string
  tone: DesktopAppTone
  action: DesktopAppAction | null
}

const CHECK = 'Rechercher une mise à jour'
const INSTALL = 'Installer et redémarrer'

/**
 * Carte « Application de bureau » des paramètres : version, état de la mise à jour et action, d'après l'état
 * envoyé par Rust (src-tauri/src/updater.rs) et l'erreur de la dernière commande (prioritaire).
 */
export function desktopAppView(status: UpdateStatus | null, commandError: string | null): DesktopAppView {
  const version = status ? `Version ${status.current}` : ''
  if (status?.state === 'disabled') {
    return {
      version,
      status: 'Version de développement : les mises à jour ne concernent que la version installée.',
      tone: 'muted',
      action: null,
    }
  }
  if (commandError) {
    return { version, status: commandError, tone: 'danger', action: { kind: 'check', label: 'Réessayer', busy: false } }
  }
  if (!status) return { version, status: '', tone: 'muted', action: null }
  const available = status.available ?? ''
  switch (status.state) {
    case 'checking':
      return { version, status: 'Recherche d’une mise à jour…', tone: 'muted', action: { kind: 'check', label: CHECK, busy: true } }
    case 'downloading':
      return {
        version,
        status: available ? `Téléchargement de la version ${available}…` : 'Téléchargement de la mise à jour…',
        tone: 'muted',
        action: { kind: 'check', label: CHECK, busy: true },
      }
    case 'ready':
      return {
        version,
        status: `Version ${available} prête. L’app redémarre pour l’installer.`,
        tone: 'success',
        action: { kind: 'install', label: INSTALL, busy: false },
      }
    case 'installing':
      return {
        version,
        status: 'Installation en cours. L’app va redémarrer toute seule.',
        tone: 'muted',
        action: { kind: 'install', label: INSTALL, busy: true },
      }
    case 'up-to-date':
      return { version, status: 'À jour.', tone: 'success', action: { kind: 'check', label: CHECK, busy: false } }
    case 'error':
      return {
        version,
        status: status.message ?? 'La dernière recherche a échoué.',
        tone: 'danger',
        action: { kind: 'check', label: 'Réessayer', busy: false },
      }
    case 'idle':
    default:
      return {
        version,
        status: 'Vérifiée toute seule toutes les 15 minutes.',
        tone: 'muted',
        action: { kind: 'check', label: CHECK, busy: false },
      }
  }
}
