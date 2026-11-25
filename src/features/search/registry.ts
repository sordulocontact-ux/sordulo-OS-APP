import type { SearchSource } from './types'

const sources = new Map<string, SearchSource>()
const listeners = new Set<() => void>()
let snapshot: readonly SearchSource[] = []

function publish() {
  snapshot = Array.from(sources.values())
  listeners.forEach((listener) => listener())
}

/**
 * Ajoute une source de recherche (Fichiers, Contrats…). Réenregistrer le même `id` la remplace.
 * Renvoie une fonction qui la retire.
 */
export function registerSearchSource(source: SearchSource): () => void {
  sources.set(source.id, source)
  publish()
  return () => {
    if (sources.get(source.id) === source) {
      sources.delete(source.id)
      publish()
    }
  }
}

/** Instantané stable (même référence tant que le registre ne change pas) : compatible `useSyncExternalStore`. */
export function getSearchSources(): readonly SearchSource[] {
  return snapshot
}

export function subscribeSearchSources(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
