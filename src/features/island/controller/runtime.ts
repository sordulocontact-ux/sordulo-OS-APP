/**
 * Contrôleur de l'île : relie l'app (Tauri, Supabase, relais Claude Code…) à la coordination et au rendu.
 * Pur : ni React ni Tauri ici (la page React est ./IslandController.tsx, les accès réels sont injectés).
 *
 * Fonctionnement
 * - Une fenêtre île = un runtime : une IslandCoordinator, un magasin des données du rendu (`view`), un bus
 *   d'événements entre sources, et les sources démarrées.
 * - Une **source** (./source.ts) branche une origine d'événements : appel détecté et enregistrement
 *   (sources/call.ts), envoi de l'audio (sources/upload.ts), suivi de l'analyse (sources/analysis.ts),
 *   mode concentration (sources/focusMode.ts), musique écoutée (sources/music.ts), déploiements Vercel
 *   (sources/deployments.ts). Elle reçoit un IslandSourceContext, pousse activités et
 *   notifications dans la coordination, remplit `view` (appel, niveaux, sessions, dépôt…) et peut prendre en
 *   charge des gestes de l'île et des actions de notification.
 * - Les boutons des notifications passent par `runAction` : la notification est fermée
 *   (`endNotification`), puis l'action est exécutée par la ou les sources qui la prennent, sinon par défaut
 *   (dismiss : rien ; openMain : fenêtre principale sur la route ; openUrl : navigateur ; showSessions : rien
 *   tant que le lot Claude Code ne la prend pas).
 *
 * Ajouter une source (attribution de tâches, Claude Code, glisser-déposer…)
 * 1. Créer `sources/<nom>.ts` qui exporte un `IslandSource` (ou une fabrique `create<Nom>Source(deps)` pour
 *    pouvoir la tester avec de faux accès, comme sources/upload.ts).
 * 2. L'ajouter au tableau ISLAND_SOURCES de `sources/index.ts`. C'est le seul endroit à toucher.
 * ```ts
 * // sources/assignments.ts
 * export const assignmentsSource: IslandSource = {
 *   id: 'attribution',
 *   start(ctx) {
 *     const stop = ctx.whenSignedIn(() => {
 *       // abonnement Realtime… puis, pour chaque tâche attribuée par quelqu'un d'autre :
 *       ctx.coordinator.notify(createNotification('assign', { assignerName, assignerInitials, taskTitle, route }))
 *     })
 *     return { dispose: stop }
 *   },
 * }
 * // sources/index.ts
 * export const ISLAND_SOURCES = [..., assignmentsSource]
 * ```
 */
import { IslandCoordinator } from '../coordinator'
import { systemClock, type IslandClock } from '../coordinator/clock'
import type { IslandNotification, NotificationAction } from '../types'
import type { IslandProjectOption } from '../view/types'
import { createIslandBus, type IslandBus } from './bus'
import {
  EMPTY_VIEW_DATA,
  type IslandActionHandler,
  type IslandGestureName,
  type IslandGestures,
  type IslandSessionInfo,
  type IslandSource,
  type IslandSourceContext,
  type IslandSourceHandle,
  type IslandViewData,
} from './source'
import { createPatchStore, type PatchStore, type ReadableStore } from './store'

/** Attente par défaut d'une connexion (relecture de la session partagée avec la fenêtre principale). */
export const SIGN_IN_WAIT_MS = 2500

/** Comportements par défaut des actions, injectés (Tauri dans l'app, faux en test). */
export interface DefaultActions {
  openMain: (route: string) => Promise<void> | void
  openUrl: (url: string) => Promise<void> | void
}

export interface IslandRuntimeOptions {
  sources: readonly IslandSource[]
  session: ReadableStore<IslandSessionInfo>
  projects: ReadableStore<readonly IslandProjectOption[]>
  defaultActions: DefaultActions
  /** Relit la session partagée (connexion faite dans la fenêtre principale). */
  refreshSession?: () => Promise<void>
  clock?: IslandClock
  /** Mode concentration au démarrage. */
  focusMode?: boolean
}

export interface IslandRuntime {
  coordinator: IslandCoordinator
  view: PatchStore<IslandViewData>
  bus: IslandBus
  /** Bouton d'une notification : ferme la notification puis exécute son action. */
  runAction: (notification: IslandNotification, action?: NotificationAction) => void
  /** Gestes de l'île, distribués aux sources qui les prennent. */
  gestures: IslandGestures
  dispose: () => void
}

function silently(run: () => unknown): void {
  try {
    const result = run()
    if (result instanceof Promise) result.catch((e: unknown) => console.warn('[île]', e))
  } catch (e) {
    console.warn('[île]', e)
  }
}

export function startIslandRuntime(options: IslandRuntimeOptions): IslandRuntime {
  const clock = options.clock ?? systemClock
  const coordinator = new IslandCoordinator({ clock, focusMode: options.focusMode })
  const view = createPatchStore<IslandViewData>(EMPTY_VIEW_DATA)
  const bus = createIslandBus()
  const { session } = options
  let disposed = false

  function whenSignedIn(callback: () => void): () => void {
    if (session.get().status === 'signedIn') {
      callback()
      return () => {}
    }
    const unsubscribe = session.subscribe(() => {
      if (disposed || session.get().status !== 'signedIn') return
      unsubscribe()
      callback()
    })
    return unsubscribe
  }

  function waitForSignedIn(timeoutMs = SIGN_IN_WAIT_MS): Promise<boolean> {
    if (session.get().status === 'signedIn') return Promise.resolve(true)
    return new Promise((resolve) => {
      let settled = false
      const finish = (value: boolean) => {
        if (settled) return
        settled = true
        clock.clearTimeout(timer)
        cancel()
        resolve(value)
      }
      const timer = clock.setTimeout(() => finish(false), timeoutMs)
      const cancel = whenSignedIn(() => finish(true))
      if (options.refreshSession) silently(options.refreshSession)
    })
  }

  const ctx: IslandSourceContext = {
    coordinator,
    clock,
    view,
    session,
    projects: options.projects,
    bus,
    waitForSignedIn,
    whenSignedIn,
    isDisposed: () => disposed,
  }

  const handles: { id: string; handle: IslandSourceHandle }[] = []
  for (const source of options.sources) {
    try {
      handles.push({ id: source.id, handle: source.start(ctx) })
    } catch (e) {
      console.error(`[île] la source ${source.id} n'a pas démarré :`, e)
    }
  }

  function runAction(notification: IslandNotification, chosen?: NotificationAction): void {
    if (disposed) return
    coordinator.endNotification(notification.id)
    const action: NotificationAction = chosen ?? notification.action
    const takers = handles.flatMap(({ handle }) => {
      const handler = handle.actions?.[action.type] as IslandActionHandler<typeof action.type> | undefined
      return handler ? [handler] : []
    })
    if (takers.length > 0) {
      for (const handler of takers) silently(() => handler(action as never, notification))
      return
    }
    switch (action.type) {
      case 'openMain':
        silently(() => options.defaultActions.openMain(action.route))
        break
      case 'openUrl':
        silently(() => options.defaultActions.openUrl(action.url))
        break
      default:
        // dismiss, et les actions qu'aucune source ne prend encore (showSessions…) : la fermeture suffit.
        break
    }
  }

  function gesture<K extends IslandGestureName>(name: K): IslandGestures[K] {
    const run = (...args: unknown[]) => {
      if (disposed) return
      for (const { handle } of handles) {
        const fn = handle.gestures?.[name] as ((...a: unknown[]) => void) | undefined
        if (fn) silently(() => fn(...args))
      }
    }
    return run as IslandGestures[K]
  }

  const gestures: IslandGestures = {
    onCallAccept: gesture('onCallAccept'),
    onCallIgnore: gesture('onCallIgnore'),
    onProjectChange: gesture('onProjectChange'),
    onStopRecording: gesture('onStopRecording'),
    onAskDecision: gesture('onAskDecision'),
    onAnswerSession: gesture('onAnswerSession'),
    onOpenSession: gesture('onOpenSession'),
    onChoiceDecision: gesture('onChoiceDecision'),
    onMusicCommand: gesture('onMusicCommand'),
    onMarkMoment: gesture('onMarkMoment'),
    onUndoMarker: gesture('onUndoMarker'),
    onReviewAction: gesture('onReviewAction'),
  }

  return {
    coordinator,
    view,
    bus,
    runAction,
    gestures,
    dispose() {
      if (disposed) return
      disposed = true
      for (const { id, handle } of handles) {
        try {
          handle.dispose?.()
        } catch (e) {
          console.warn(`[île] arrêt de la source ${id} :`, e)
        }
      }
      coordinator.dispose()
    },
  }
}
