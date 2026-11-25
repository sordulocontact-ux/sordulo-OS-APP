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
 *
 * Moments marqués (repères) pendant l'enregistrement : bouton « Marquer » de l'île (onMarkMoment) ou raccourci
 * global (Ctrl+Alt+M sous Windows, Ctrl+Cmd+M sous macOS, géré par Rust sans passer par le front). Rust annonce
 * chaque changement (desktop://recording-markers) : compteur, petite étoile, « Annuler » pendant 5 s
 * (onUndoMarker retire le dernier). Le compteur se recale sur RecordingState.markerCount (page rechargée).
 *
 * Agenda (Google Agenda, événements lus par la source « agenda » dans calendarStore) : à l'ouverture de
 * « Transcrire cet appel ? », si un événement est en cours, son projet est présélectionné avec la raison
 * (« D'après l'agenda : <titre> », voir ../calendarMatch.ts) et son titre devient celui de l'entrée.
 * L'annuaire des clients est lu à ce moment (cache court) ; un échec garde le comportement sans agenda.
 */
import type { ClientDirectoryEntry } from '../../../../lib/clientDirectory'
import type {
  AudioLevel,
  CallService,
  DesktopStatus,
  MicState,
  PromptPayload,
  RecordingMarkers,
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
import { ongoingEvent, pickCalendarProject, type CalendarProjectPick } from '../calendarMatch'
import type { ReadableCalendarEvents } from '../calendarStore'
import type { TimerId } from '../../coordinator/clock'
import type { IslandSource } from '../source'
import { listen } from './listen'

export const MEET_ID = 'meet'
/** Affiché quand le micro est pris par une app qu'on ne sait pas nommer. */
const UNKNOWN_APP = 'une app d’appel'
/** « Annuler » reste proposé 5 s après un repère. */
export const MARKER_UNDO_MS = 5000
/** Annuaire des clients relu au plus toutes les 5 min (présélection d'après l'agenda). */
export const DIRECTORY_CACHE_MS = 5 * 60 * 1000

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
  /** Repères de l'enregistrement en cours (bouton « Marquer », « Annuler »). */
  addRecordingMarker: () => Promise<RecordingMarkers>
  removeLastRecordingMarker: () => Promise<RecordingMarkers>
  /** Changement des repères (raccourci global ou bouton), toutes fenêtres. */
  onRecordingMarkers: (handler: (markers: RecordingMarkers) => void) => Promise<() => void>
  /** Événements Google Agenda courants (source « agenda ») ; absent : pas de présélection d'après l'agenda. */
  calendarEvents?: ReadableCalendarEvents
  /** Clients, contacts et projets (participants de l'événement ↔ contacts). */
  loadClientDirectory?: () => Promise<ClientDirectoryEntry[]>
}

interface CallPrompt {
  /** mic : appel détecté ; manual : enregistrement lancé à la main. */
  origin: 'mic' | 'manual'
  appName: string | null
  /** Service reconnu de l'app détectée ; null : inconnu (ou lancé à la main). */
  service: CallService | null
  /** Projet choisi dans la liste ; null : projet par défaut. */
  selectedProjectId: string | null
  /** Présélection d'après l'événement en cours de l'agenda ; null : pas d'événement en cours. */
  agenda: CalendarProjectPick | null
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
      /** Dernier état des repères appliqué (l'événement et la réponse de la commande portent le même). */
      let lastMarkers: RecordingMarkers | null = null
      let undoTimer: TimerId | null = null
      /** Annuaire des clients en cache, par compte. */
      let directory: { userId: string | null; at: number; entries: readonly ClientDirectoryEntry[] } | null = null
      let directoryLoading = false

      ctx.view.patch({ audioLevels: levels.values, markers: null })

      function currentMeet() {
        const activity = coordinator.getActivity(MEET_ID)
        return activity?.kind === 'meet' ? activity : null
      }

      function selectedProject(): string | null {
        const projects = ctx.projects.get()
        const chosen = prompt?.selectedProjectId ?? null
        if (chosen && projects.some((p) => p.id === chosen)) return chosen
        const preselected = prompt?.agenda?.projectId ?? null
        if (preselected && projects.some((p) => p.id === preselected)) return preselected
        return pickDefaultProject(projects, deps.readLastProjectId())
      }

      // -- Agenda --------------------------------------------------------------

      function directoryEntries(): readonly ClientDirectoryEntry[] {
        const userId = ctx.session.get().userId
        return directory && directory.userId === userId ? directory.entries : []
      }

      /** Relit l'annuaire s'il est absent ou vieux ; la présélection est recalculée à son arrivée. */
      function loadDirectory(): void {
        const load = deps.loadClientDirectory
        if (!load || directoryLoading) return
        const userId = ctx.session.get().userId
        if (directory && directory.userId === userId && ctx.clock.now() - directory.at < DIRECTORY_CACHE_MS) return
        directoryLoading = true
        load()
          .then((entries) => {
            if (ctx.isDisposed()) return
            directory = { userId, at: ctx.clock.now(), entries }
            if (prompt) refreshAgenda()
          })
          .catch(warn("annuaire des clients pour l'agenda"))
          .finally(() => {
            directoryLoading = false
          })
      }

      /** Présélection d'après l'événement en cours (recalculée : projets, annuaire ou agenda arrivés après). */
      function agendaPick(): CalendarProjectPick | null {
        const events = deps.calendarEvents?.get() ?? []
        const now = ctx.clock.now()
        const event = ongoingEvent(events, now)
        if (!event) return null
        loadDirectory()
        return pickCalendarProject({
          event,
          directory: directoryEntries(),
          projects: ctx.projects.get(),
          lastProjectId: deps.readLastProjectId(),
          now,
        })
      }

      function refreshAgenda(): void {
        if (!prompt) return
        prompt = { ...prompt, agenda: agendaPick() }
        renderCall()
      }

      // -- Repères ---------------------------------------------------------------

      function clearUndoTimer(): void {
        if (undoTimer !== null) ctx.clock.clearTimeout(undoTimer)
        undoTimer = null
      }

      /** Pas d'enregistrement : plus de bouton « Marquer » ni de compteur. */
      function resetMarkers(): void {
        clearUndoTimer()
        lastMarkers = null
        ctx.view.patch({ markers: null })
      }

      /** Compteur recalé sur Rust (début de l'enregistrement, page rechargée) sans étoile ni « Annuler ». */
      function syncMarkerCount(count: number): void {
        const current = ctx.view.get().markers
        if (current && current.count === count) return
        clearUndoTimer()
        ctx.view.patch({ markers: { count, lastAddedAt: null, undoUntil: null } })
      }

      function sameMarkers(a: RecordingMarkers | null, b: RecordingMarkers): boolean {
        return a !== null && a.count === b.count && a.lastAtSecs === b.lastAtSecs && a.added === b.added
      }

      function applyMarkers(markers: RecordingMarkers): void {
        if (!recordingActive && !currentMeet()) return
        if (sameMarkers(lastMarkers, markers)) return
        lastMarkers = markers
        clearUndoTimer()
        const now = ctx.clock.now()
        const previous = ctx.view.get().markers
        if (markers.added) {
          const undoUntil = now + MARKER_UNDO_MS
          ctx.view.patch({ markers: { count: markers.count, lastAddedAt: now, undoUntil } })
          undoTimer = ctx.clock.setTimeout(() => {
            undoTimer = null
            const shown = ctx.view.get().markers
            if (shown && shown.undoUntil === undoUntil) ctx.view.patch({ markers: { ...shown, undoUntil: null } })
          }, MARKER_UNDO_MS)
        } else {
          const lastAddedAt = markers.count > 0 ? (previous?.lastAddedAt ?? null) : null
          ctx.view.patch({ markers: { count: markers.count, lastAddedAt, undoUntil: null } })
        }
      }

      function markMoment(): void {
        if (!recordingActive || stopping) return
        deps.addRecordingMarker().then(applyMarkers).catch(warn('repère'))
      }

      function undoMarker(): void {
        const shown = ctx.view.get().markers
        if (!shown || shown.undoUntil === null || ctx.clock.now() > shown.undoUntil) return
        clearUndoTimer()
        ctx.view.patch({ markers: { ...shown, undoUntil: null } })
        deps.removeLastRecordingMarker().then(applyMarkers).catch(warn('annulation du repère'))
      }

      function renderCall(): void {
        if (!prompt) {
          ctx.view.patch({ call: null })
          return
        }
        const selected = selectedProject()
        const agenda = prompt.agenda
        ctx.view.patch({
          call: {
            // Vide : la couche affiche « Enregistrer un appel » (lancé à la main), sans nom d'app.
            appName: prompt.origin === 'manual' ? '' : (prompt.appName ?? UNKNOWN_APP),
            service: prompt.origin === 'manual' ? null : prompt.service,
            projects: ctx.projects.get(),
            selectedProjectId: selected,
            // La raison suit le projet présélectionné : elle disparaît si on en choisit un autre.
            reason: agenda?.reason && agenda.projectId === selected ? agenda.reason : null,
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
        if (state.status === 'recording') syncMarkerCount(state.markerCount ?? 0)
        else if (state.status === 'idle') resetMarkers()
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
        prompt = {
          origin,
          appName: micAppName(mic),
          service: micService(mic),
          selectedProjectId: prompt?.selectedProjectId ?? null,
          agenda: agendaPick(),
        }
        renderCall()
        coordinator.showOverlay('appel')
      }

      async function accept(projectId: string | null): Promise<void> {
        if (!prompt || starting || stopping) return
        const chosen = projectId ?? selectedProject()
        if (!chosen) return
        const appName = prompt.appName ?? micAppName(lastMic) ?? FALLBACK_APP_NAME
        const service = prompt.origin === 'manual' ? null : (prompt.service ?? micService(lastMic))
        const title = prompt.agenda?.title ?? null
        starting = true
        closePrompt()
        levels.reset()
        clearUndoTimer()
        lastMarkers = null
        ctx.view.patch({ markers: { count: 0, lastAddedAt: null, undoUntil: null } })
        // L'île passe tout de suite en enregistrement ; le minuteur se recale sur l'heure de départ réelle.
        addMeet({ appName, service }, chosen, ctx.clock.now())
        try {
          const state = await deps.startRecording({ projectId: chosen, title })
          deps.writeLastProjectId(chosen)
          recordingActive = state.status !== 'idle'
          if (state.startedAt) coordinator.updateActivity(MEET_ID, { startedAt: state.startedAt })
        } catch (e) {
          writeCall(null)
          resetMarkers()
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
        resetMarkers()
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
        listen(ctx, deps.onRecordingMarkers, applyMarkers),
        deps.calendarEvents?.subscribe(refreshAgenda) ?? (() => {}),
        ctx.projects.subscribe(() => {
          if (prompt) refreshAgenda()
          else renderCall()
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
        dispose: () => {
          stops.forEach((stopListening) => stopListening())
          clearUndoTimer()
        },
        gestures: {
          onCallAccept: (projectId) => void accept(projectId),
          onCallIgnore: ignore,
          onProjectChange: (projectId) => {
            if (!prompt) return
            prompt = { ...prompt, selectedProjectId: projectId }
            renderCall()
          },
          onStopRecording: () => void stop(),
          onMarkMoment: markMoment,
          onUndoMarker: undoMarker,
        },
        actions: {
          stopRecording: () => stop(),
        },
      }
    },
  }
}
