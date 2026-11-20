/**
 * Source « appel » : appel détecté (overlay `appel`), enregistrement (activité `meet`, onde, minuteur) et
 * arrêt. L'envoi de l'audio est fait par la source « envoi » (sources/upload.ts), prévenue par le bus.
 *
 * Événements Tauri (desktop://prompt) :
 * - mic-active : « Appel détecté dans <app> », choix du projet, Ignorer (dismissPrompt) ou Transcrire.
 *   Sans connexion : notification « Connecte-toi dans Sordulo OS ».
 * - manual-start (menu du soleil, bouton du header) : même overlay, « Enregistrer un appel » (appName vide).
 *   Pendant un enregistrement : rappel « Enregistrement en cours » avec Arrêter.
 * - mic-inactive pendant l'enregistrement : « L'appel semble terminé », bouton Arrêter.
 * - manual-stop : arrêt direct.
 */
import type {
  AudioLevel,
  CallService,
  DesktopStatus,
  MicState,
  PromptPayload,
  RecordingResult,
  RecordingState,
} from '../../../../shared/desktop-contract'
import { createNotification } from '../../catalog'
import type { IslandNotification } from '../../types'
import { readRecordingCall, writeRecordingCall, type RecordingCall } from '../../../desktop/storage'
import {
  FALLBACK_APP_NAME,
  LevelBuffer,
  errorMessage,
  micAppName,
  micService,
  pickDefaultProject,
  projectNameOf,
} from '../callFlow'
import type { IslandSource } from '../source'
import { listen } from './listen'

export const MEET_ID = 'meet'
/** Affiché quand le micro est pris par une app qu'on ne sait pas nommer. */
const UNKNOWN_APP = 'une app d’appel'

export interface CallSourceDeps {
  getStatus: () => Promise<DesktopStatus>
  startRecording: (args: { projectId: string; title?: string | null }) => Promise<RecordingState>
  stopRecording: () => Promise<RecordingResult>
  dismissPrompt: () => Promise<void>
  onPrompt: (handler: (payload: PromptPayload) => void) => Promise<() => void>
  onRecordingState: (handler: (state: RecordingState) => void) => Promise<() => void>
  onMicState: (handler: (state: MicState) => void) => Promise<() => void>
  onAudioLevel: (handler: (level: AudioLevel) => void) => Promise<() => void>
  readLastProjectId: () => string | null
  writeLastProjectId: (projectId: string) => void
  /** App de l'enregistrement en cours, gardée pour que le logo survive à un redémarrage de la page. */
  readRecordingCall?: () => RecordingCall | null
  writeRecordingCall?: (call: RecordingCall | null) => void
}

interface CallPrompt {
  /** mic : appel détecté ; manual : enregistrement lancé à la main. */
  origin: 'mic' | 'manual'
  appName: string | null
  /** Service reconnu de l'app détectée ; null : inconnu (ou lancé à la main). */
  service: CallService | null
  /** Projet choisi dans la liste ; null : projet par défaut. */
  selectedProjectId: string | null
}

function warn(label: string) {
  return (e: unknown) => console.warn(`[île] ${label} :`, e)
}

export function createCallSource(deps: CallSourceDeps): IslandSource {
  return {
    id: 'appel',
    start(ctx) {
      const { coordinator } = ctx
      const levels = new LevelBuffer()
      const readCall = deps.readRecordingCall ?? readRecordingCall
      const writeCall = deps.writeRecordingCall ?? writeRecordingCall
      let prompt: CallPrompt | null = null
      let starting = false
      let stopping = false
      /** Dernier état connu côté Rust : un enregistrement tourne (ou s'arrête). */
      let recordingActive = false
      let lastMic: MicState | null = null
      let callEndedId: string | null = null

      ctx.view.patch({ audioLevels: levels.values })

      function currentMeet() {
        const activity = coordinator.getActivity(MEET_ID)
        return activity?.kind === 'meet' ? activity : null
      }

      function selectedProject(): string | null {
        const projects = ctx.projects.get()
        const chosen = prompt?.selectedProjectId ?? null
        if (chosen && projects.some((p) => p.id === chosen)) return chosen
        return pickDefaultProject(projects, deps.readLastProjectId())
      }

      function renderCall(): void {
        if (!prompt) {
          ctx.view.patch({ call: null })
          return
        }
        ctx.view.patch({
          call: {
            // Vide : la couche affiche « Enregistrer un appel » (lancé à la main), sans nom d'app.
            appName: prompt.origin === 'manual' ? '' : (prompt.appName ?? UNKNOWN_APP),
            service: prompt.origin === 'manual' ? null : prompt.service,
            projects: ctx.projects.get(),
            selectedProjectId: selectedProject(),
          },
        })
      }

      function closePrompt(): void {
        prompt = null
        coordinator.hideOverlay('appel')
        renderCall()
      }

      function addMeet(call: RecordingCall, projectId: string | null, startedAt: number): void {
        writeCall(call)
        coordinator.addActivity({
          id: MEET_ID,
          kind: 'meet',
          appName: call.appName,
          service: call.service,
          projectId,
          projectName: projectNameOf(ctx.projects.get(), projectId),
          startedAt,
        })
      }

      function notifyOnce(notification: IslandNotification): void {
        clearCallEnded()
        callEndedId = notification.id
        coordinator.notify(notification)
      }

      function clearCallEnded(): void {
        if (callEndedId === null) return
        coordinator.endNotification(callEndedId)
        callEndedId = null
      }

      /** Aligne l'île sur l'état de l'enregistrement côté Rust (démarré ou arrêté ailleurs, page rechargée). */
      function syncRecording(state: RecordingState): void {
        recordingActive = state.status !== 'idle'
        if (starting || stopping) return
        const meet = currentMeet()
        if (state.status === 'recording' && !meet) {
          const startedAt = state.startedAt ?? ctx.clock.now() - state.elapsedSecs * 1000
          // Page rechargée : l'app vient de l'état du micro s'il tourne encore, sinon de ce qui a été gardé.
          const known = micAppName(lastMic)
          const call: RecordingCall = known
            ? { appName: known, service: micService(lastMic) }
            : (readCall() ?? { appName: FALLBACK_APP_NAME, service: null })
          addMeet(call, state.projectId, startedAt)
          if (prompt) closePrompt()
        } else if (state.status === 'idle' && meet) {
          clearCallEnded()
          coordinator.endMeet()
          levels.reset()
          writeCall(null)
        }
      }

      async function openPrompt(origin: CallPrompt['origin'], mic: MicState): Promise<void> {
        if (recordingActive || starting || stopping) return
        const signedIn = await ctx.waitForSignedIn()
        if (ctx.isDisposed() || recordingActive || starting || stopping) return
        if (!signedIn) {
          coordinator.notify(createNotification('loginRequired', { appName: origin === 'mic' ? micAppName(mic) : null }))
          return
        }
        prompt = { origin, appName: micAppName(mic), service: micService(mic), selectedProjectId: prompt?.selectedProjectId ?? null }
        renderCall()
        coordinator.showOverlay('appel')
      }

      async function accept(projectId: string | null): Promise<void> {
        if (!prompt || starting || stopping) return
        const chosen = projectId ?? selectedProject()
        if (!chosen) return
        const appName = prompt.appName ?? micAppName(lastMic) ?? FALLBACK_APP_NAME
        const service = prompt.origin === 'manual' ? null : (prompt.service ?? micService(lastMic))
        starting = true
        closePrompt()
        levels.reset()
        // L'île passe tout de suite en enregistrement ; le minuteur se recale sur l'heure de départ réelle.
        addMeet({ appName, service }, chosen, ctx.clock.now())
        try {
          const state = await deps.startRecording({ projectId: chosen, title: null })
          deps.writeLastProjectId(chosen)
          recordingActive = state.status !== 'idle'
          if (state.startedAt) coordinator.updateActivity(MEET_ID, { startedAt: state.startedAt })
        } catch (e) {
          writeCall(null)
          coordinator.removeActivity(MEET_ID)
          coordinator.notify(
            createNotification('recordError', {
              phase: 'start',
              message: errorMessage(e, "Impossible de démarrer l'enregistrement."),
            }),
          )
        } finally {
          starting = false
        }
      }

      function ignore(): void {
        if (!prompt) return
        const origin = prompt.origin
        closePrompt()
        // La proposition reste écartée tant que le micro reste actif (côté Rust).
        if (origin === 'mic') deps.dismissPrompt().catch(warn('Ignorer'))
      }

      async function stop(): Promise<void> {
        if (stopping || starting) return
        if (!recordingActive && !currentMeet()) return
        stopping = true
        clearCallEnded()
        coordinator.endMeet()
        ctx.bus.emit('recordingStopping')
        try {
          const result = await deps.stopRecording()
          recordingActive = false
          writeCall(null)
          ctx.bus.emit('recordingStopped', result)
        } catch (e) {
          const message = errorMessage(e, "Impossible d'arrêter l'enregistrement.")
          ctx.bus.emit('recordingStopFailed', { message })
          coordinator.notify(createNotification('recordError', { phase: 'stop', message }))
          // L'enregistrement continue peut-être : on relit son état.
          stopping = false
          try {
            const status = await deps.getStatus()
            if (!ctx.isDisposed()) syncRecording(status.recording)
          } catch (statusError) {
            warn('état après un arrêt manqué')(statusError)
          }
        } finally {
          stopping = false
          levels.reset()
        }
      }

      function onPrompt(payload: PromptPayload): void {
        lastMic = payload.mic
        syncRecording(payload.recording)
        switch (payload.reason) {
          case 'mic-active':
            void openPrompt('mic', payload.mic)
            break
          case 'manual-start':
            if (recordingActive) {
              const meet = currentMeet()
              if (!stopping) {
                notifyOnce(
                  createNotification('recording', { appName: meet?.appName ?? null, projectName: meet?.projectName ?? null }),
                )
              }
            } else {
              void openPrompt('manual', payload.mic)
            }
            break
          case 'mic-inactive':
            if (recordingActive && !stopping) {
              const meet = currentMeet()
              notifyOnce(
                createNotification('callEnded', { appName: meet?.appName ?? null, projectName: meet?.projectName ?? null }),
              )
            }
            break
          case 'manual-stop':
            void stop()
            break
        }
      }

      function onMic(mic: MicState): void {
        lastMic = mic
        if (prompt?.origin !== 'mic') return
        if (!mic.active) {
          // L'appel s'est terminé avant le choix : la proposition n'a plus lieu d'être.
          closePrompt()
          return
        }
        const name = micAppName(mic)
        const service = micService(mic)
        if (name && (name !== prompt.appName || service !== prompt.service)) {
          prompt = { ...prompt, appName: name, service }
          renderCall()
        }
      }

      const stops = [
        listen(ctx, deps.onPrompt, onPrompt),
        listen(ctx, deps.onRecordingState, syncRecording),
        listen(ctx, deps.onMicState, onMic),
        listen(ctx, deps.onAudioLevel, (level) => levels.push(level.level)),
        ctx.projects.subscribe(() => {
          renderCall()
          const meet = currentMeet()
          if (meet && meet.projectName === null && meet.projectId) {
            const projectName = projectNameOf(ctx.projects.get(), meet.projectId)
            if (projectName) coordinator.updateActivity(MEET_ID, { projectName })
          }
        }),
      ]

      // Un enregistrement peut déjà tourner (fenêtre rechargée) : l'île le reprend.
      deps
        .getStatus()
        .then((status) => {
          if (ctx.isDisposed()) return
          lastMic ??= status.mic
          syncRecording(status.recording)
        })
        .catch(warn('état au démarrage'))

      return {
        dispose: () => stops.forEach((stopListening) => stopListening()),
        gestures: {
          onCallAccept: (projectId) => void accept(projectId),
          onCallIgnore: ignore,
          onProjectChange: (projectId) => {
            if (!prompt) return
            prompt = { ...prompt, selectedProjectId: projectId }
            renderCall()
          },
          onStopRecording: () => void stop(),
        },
        actions: {
          stopRecording: () => stop(),
        },
      }
    },
  }
}
