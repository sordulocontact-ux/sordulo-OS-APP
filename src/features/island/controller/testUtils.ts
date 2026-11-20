/**
 * Outils des tests du contrôleur (pas de Vitest ici : les tests passent leurs espions).
 */
import { FakeClock } from '../coordinator/fakeClock'
import type { IslandProjectOption } from '../view/types'
import { startIslandRuntime, type DefaultActions } from './runtime'
import { SIGNED_OUT, type IslandSessionInfo, type IslandSource } from './source'
import { createStore } from './store'

export const SIGNED_IN: IslandSessionInfo = { status: 'signedIn', userId: 'u-1', memberId: 'm-1', organizationId: 'o-1' }

export const PROJECTS: readonly IslandProjectOption[] = [
  { id: 'p-1', name: 'App Ibé' },
  { id: 'p-2', name: 'Site Sordulo' },
]

/** Faux événement Tauri : `subscribe` a la forme des wrappers de src/lib/desktop.ts. */
export function fakeEvent<T>() {
  const handlers = new Set<(payload: T) => void>()
  return {
    subscribe: (handler: (payload: T) => void) => {
      handlers.add(handler)
      return Promise.resolve(() => {
        handlers.delete(handler)
      })
    },
    emit: (payload: T) => handlers.forEach((handler) => handler(payload)),
    get listeners() {
      return handlers.size
    },
  }
}

/** Laisse passer les promesses en attente (vraies tâches, l'horloge simulée ne bouge pas). */
export async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

export function setupRuntime(options: {
  sources: readonly IslandSource[]
  signedIn?: boolean
  projects?: readonly IslandProjectOption[]
  defaultActions?: DefaultActions
}) {
  const clock = new FakeClock(1_000_000)
  const session = createStore<IslandSessionInfo>(options.signedIn === false ? SIGNED_OUT : SIGNED_IN)
  const projects = createStore<readonly IslandProjectOption[]>(options.projects ?? PROJECTS)
  const runtime = startIslandRuntime({
    sources: options.sources,
    session,
    projects,
    clock,
    defaultActions: options.defaultActions ?? { openMain: () => {}, openUrl: () => {} },
  })
  return { clock, session, projects, runtime, coordinator: runtime.coordinator, snap: () => runtime.coordinator.getSnapshot() }
}
