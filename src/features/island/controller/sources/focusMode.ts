/**
 * Source « concentration » : mode concentration du menu du soleil, lu au démarrage puis suivi.
 * Pendant un appel, les notifications attendent la fin de l'appel (voir la coordination).
 */
import type { FocusModeState } from '../../../../shared/desktop-contract'
import type { IslandSource } from '../source'
import { listen } from './listen'

export interface FocusModeDeps {
  getFocusMode: () => Promise<FocusModeState>
  onFocusMode: (handler: (state: FocusModeState) => void) => Promise<() => void>
}

export function createFocusModeSource(deps: FocusModeDeps): IslandSource {
  return {
    id: 'concentration',
    start(ctx) {
      let changed = false
      const stop = listen(ctx, deps.onFocusMode, (state) => {
        changed = true
        ctx.coordinator.setFocusMode(state.on)
      })
      deps
        .getFocusMode()
        .then((state) => {
          // Un changement reçu entre-temps est plus récent que la lecture.
          if (!ctx.isDisposed() && !changed) ctx.coordinator.setFocusMode(state.on)
        })
        .catch((e: unknown) => console.warn('[île] mode concentration :', e))
      return { dispose: stop }
    },
  }
}
