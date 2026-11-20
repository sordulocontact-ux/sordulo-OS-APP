/**
 * Petits magasins observables (get / set / subscribe), lisibles par useSyncExternalStore.
 * Pur : ni React ni Tauri.
 */

export interface ReadableStore<T> {
  get: () => T
  /** Renvoie la désinscription. */
  subscribe: (listener: () => void) => () => void
}

export interface Store<T> extends ReadableStore<T> {
  set: (value: T) => void
}

/** Magasin à valeur unique. `set` ne prévient les abonnés que si la valeur change (comparaison `Object.is`). */
export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return
      value = next
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Magasin d'objet mis à jour par morceaux : `patch` ne prévient que si au moins un champ change. */
export interface PatchStore<T extends object> extends ReadableStore<T> {
  patch: (partial: Partial<T>) => void
}

export function createPatchStore<T extends object>(initial: T): PatchStore<T> {
  const store = createStore<T>(Object.freeze({ ...initial }))
  return {
    get: store.get,
    subscribe: store.subscribe,
    patch: (partial) => {
      const current = store.get()
      const changed = (Object.keys(partial) as (keyof T)[]).some((key) => !Object.is(partial[key], current[key]))
      if (changed) store.set(Object.freeze({ ...current, ...partial }))
    },
  }
}
