import type { UpdateStatus } from '../../shared/desktop-contract'
import { compareVersions } from '../../shared/desktop-version'

/** Intervalle entre deux vérifications de compatibilité : 1 heure. */
export const CHECK_INTERVAL_MS = 60 * 60 * 1000

/** L'app est trop vieille si sa version est strictement inférieure au minimum de l'API. Version illisible = on ne bloque pas. */
export function isTooOld(current: string | null | undefined, minVersion: string | null | undefined): boolean {
  if (!current || !minVersion) return false
  if (!/\d/.test(current) || !/\d/.test(minVersion)) return false
  return compareVersions(current, minVersion) < 0
}

export type UpdateView = { kind: 'working'; label: string } | { kind: 'error'; message: string }

const NO_UPDATE_MESSAGE = 'Aucune mise à jour n’est disponible pour le moment. Réessaie dans quelques minutes.'
const DISABLED_MESSAGE =
  'La mise à jour automatique n’est pas disponible dans cette version. Installe la dernière version depuis le site.'

/** Ce que l'écran affiche selon l'état renvoyé par Rust (et l'erreur de la commande, s'il y en a une). */
export function viewForStatus(status: UpdateStatus | null, commandError: string | null): UpdateView {
  if (commandError) return { kind: 'error', message: commandError }
  if (!status) return { kind: 'working', label: 'Recherche de la mise à jour…' }
  switch (status.state) {
    case 'error':
      return {
        kind: 'error',
        message: status.message ?? 'La mise à jour a échoué.',
      }
    case 'disabled':
      return { kind: 'error', message: DISABLED_MESSAGE }
    case 'up-to-date':
      return { kind: 'error', message: NO_UPDATE_MESSAGE }
    case 'downloading':
      return {
        kind: 'working',
        label: status.available
          ? `Téléchargement de la version ${status.available}…`
          : 'Téléchargement de la mise à jour…',
      }
    case 'ready':
    case 'installing':
      return {
        kind: 'working',
        label: 'Installation en cours. L’app va redémarrer toute seule.',
      }
    case 'idle':
    case 'checking':
    default:
      return { kind: 'working', label: 'Recherche de la mise à jour…' }
  }
}

/** Message affichable pour une erreur de commande Tauri (chaîne française renvoyée par Rust, ou Error). */
export function errorMessage(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error
  if (error instanceof Error && error.message.trim()) return error.message
  return 'La mise à jour a échoué. Réessaie.'
}
