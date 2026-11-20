/**
 * Source « analyse » : suit le traitement d'une entrée (transcription puis analyse) sur ses vrais statuts.
 *
 * - bus trackInput → progression « Analyse de l'appel », puis lecture de l'entrée toutes les 2 s tant qu'elle
 *   est en uploaded / transcribing / analyzing (l'API de traitement répond tout de suite, 202, et la table
 *   des entrées n'est pas dans Realtime).
 * - ready → « N tickets à valider » (Valider → écran de validation), ou « Aucun ticket proposé » (Ouvrir →
 *   fiche de l'entrée).
 * - error → « L'analyse a échoué », Réessayer relance le traitement comme la fiche d'une entrée
 *   (POST /api/inputs/process ; 409 = déjà en cours, donc lancé).
 * - Les entrées suivies sont gardées sur l'ordinateur : le suivi reprend au redémarrage, une fois connecté.
 */
import type { Input } from '../../../../shared/types'
import type { TimerId } from '../../coordinator/clock'
import type { TrackedInput } from '../../../desktop/storage'
import {
  POLL_MS,
  POLL_RETRY_MS,
  analysisDoneNotification,
  analysisErrorNotification,
  analysisProgress,
  analysisProgressId,
  errorMessage,
  inputPhase,
  type AnalysedInput,
} from '../callFlow'
import type { IslandSource } from '../source'

export type PolledInput = AnalysedInput & Pick<Input, 'status' | 'error_message'>

export interface AnalysisSourceDeps {
  /** null : l'entrée n'existe plus (ou n'est plus visible). */
  fetchInput: (inputId: string) => Promise<PolledInput | null>
  /** Tickets encore proposés pour cette entrée, et nom du projet. */
  fetchOutcome: (input: PolledInput) => Promise<{ proposedCount: number; projectName: string | null }>
  /** Relance le traitement ; un traitement déjà en cours compte comme un succès. */
  restartProcessing: (inputId: string) => Promise<void>
  readTrackedInputs: () => TrackedInput[]
  addTrackedInput: (tracked: TrackedInput) => void
  removeTrackedInput: (inputId: string) => void
}

export function createAnalysisSource(deps: AnalysisSourceDeps): IslandSource {
  return {
    id: 'analyse',
    start(ctx) {
      const { coordinator, clock } = ctx
      const timers = new Map<string, TimerId>()
      const tracked = new Set<string>()

      function schedule(inputId: string, ms: number): void {
        const previous = timers.get(inputId)
        if (previous !== undefined) clock.clearTimeout(previous)
        timers.set(
          inputId,
          clock.setTimeout(() => {
            timers.delete(inputId)
            void poll(inputId)
          }, ms),
        )
      }

      function track(inputId: string, durationSecs: number | null, firstPollMs = POLL_MS): void {
        deps.addTrackedInput({ inputId, durationSecs })
        if (!coordinator.getActivity(analysisProgressId(inputId))) {
          coordinator.addActivity(analysisProgress(inputId, clock.now(), durationSecs))
        }
        if (tracked.has(inputId)) return
        tracked.add(inputId)
        schedule(inputId, firstPollMs)
      }

      function untrack(inputId: string): void {
        tracked.delete(inputId)
        const timer = timers.get(inputId)
        if (timer !== undefined) clock.clearTimeout(timer)
        timers.delete(inputId)
        deps.removeTrackedInput(inputId)
        coordinator.removeActivity(analysisProgressId(inputId))
      }

      const alive = (inputId: string) => !ctx.isDisposed() && tracked.has(inputId)

      async function poll(inputId: string): Promise<void> {
        if (!alive(inputId)) return
        let input: PolledInput | null
        try {
          input = await deps.fetchInput(inputId)
        } catch (e) {
          console.warn('[île] lecture de l’entrée :', e)
          if (alive(inputId)) schedule(inputId, POLL_RETRY_MS)
          return
        }
        if (!alive(inputId)) return
        if (!input) {
          untrack(inputId)
          return
        }
        const phase = inputPhase(input.status)
        if (phase === 'waiting') {
          schedule(inputId, POLL_MS)
          return
        }
        if (phase === 'error') {
          untrack(inputId)
          coordinator.notify(analysisErrorNotification(inputId, input.error_message))
          return
        }
        let outcome: { proposedCount: number; projectName: string | null }
        try {
          outcome = await deps.fetchOutcome(input)
        } catch (e) {
          console.warn('[île] lecture des tickets proposés :', e)
          if (alive(inputId)) schedule(inputId, POLL_RETRY_MS)
          return
        }
        if (!alive(inputId)) return
        untrack(inputId)
        coordinator.notify(analysisDoneNotification({ input, ...outcome }))
      }

      async function retry(inputId: string): Promise<void> {
        const id = analysisProgressId(inputId)
        if (!coordinator.getActivity(id)) coordinator.addActivity(analysisProgress(inputId, clock.now(), null))
        try {
          await deps.restartProcessing(inputId)
        } catch (e) {
          if (ctx.isDisposed()) return
          if (!tracked.has(inputId)) coordinator.removeActivity(id)
          coordinator.notify(analysisErrorNotification(inputId, errorMessage(e, 'Impossible de relancer le traitement.')))
          return
        }
        if (!ctx.isDisposed()) track(inputId, null)
      }

      const stops = [
        ctx.bus.on('trackInput', ({ inputId, durationSecs }) => track(inputId, durationSecs)),
        // Reprise au démarrage : seulement une fois connecté (sinon l'entrée paraît introuvable).
        ctx.whenSignedIn(() => {
          for (const t of deps.readTrackedInputs()) track(t.inputId, t.durationSecs, 0)
        }),
      ]

      return {
        dispose: () => {
          stops.forEach((stop) => stop())
          timers.forEach((timer) => clock.clearTimeout(timer))
          timers.clear()
          tracked.clear()
        },
        actions: {
          retryAnalysis: (action) => retry(action.inputId),
        },
      }
    },
  }
}
