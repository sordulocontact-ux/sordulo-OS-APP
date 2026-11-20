import type { IslandSourceContext } from '../source'

/**
 * Abonnement à un événement Tauri (les wrappers de src/lib/desktop.ts renvoient une promesse de
 * désabonnement) : ignore les événements après l'arrêt de la source et se désabonne même si l'abonnement
 * aboutit après. Renvoie l'arrêt.
 */
export function listen<T>(
  ctx: Pick<IslandSourceContext, 'isDisposed'>,
  subscribe: (handler: (payload: T) => void) => Promise<() => void>,
  handler: (payload: T) => void,
): () => void {
  let stopped = false
  let off: (() => void) | null = null
  subscribe((payload) => {
    if (!stopped && !ctx.isDisposed()) handler(payload)
  })
    .then((unlisten) => {
      if (stopped) unlisten()
      else off = unlisten
    })
    .catch((e: unknown) => console.warn('[île] abonnement impossible :', e))
  return () => {
    stopped = true
    off?.()
    off = null
  }
}
