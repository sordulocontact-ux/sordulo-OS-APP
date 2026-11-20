/**
 * Horloge de la coordination : injectable pour rejouer les scénarios en test sans attendre.
 */

/** Identifiant d'un minuteur, opaque (nombre dans le navigateur, objet dans Node). */
export type TimerId = unknown

export interface IslandClock {
  /** Heure courante en ms (seules les différences comptent). */
  now(): number
  setTimeout(callback: () => void, ms: number): TimerId
  clearTimeout(id: TimerId): void
}

/** Horloge réelle (navigateur, webview Tauri). */
export const systemClock: IslandClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof globalThis.setTimeout>),
}
