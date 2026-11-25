import { describe, expect, it, vi } from 'vitest'
import type { ClientDirectoryEntry } from '../../../../lib/clientDirectory'
import type { CalendarEvent } from '../../../../lib/googleCalendar'
import type {
  AudioLevel,
  MicState,
  PromptPayload,
  PromptReason,
  RecordingMarkers,
  RecordingResult,
  RecordingState,
} from '../../../../shared/desktop-contract'
import type { RecordingCall } from '../../../desktop/storage'
import { createCalendarStore } from '../calendarStore'
import { fakeEvent, flush, setupRuntime } from '../testUtils'
import { MARKER_UNDO_MS, MEET_ID, createCallSource, type CallSourceDeps } from './call'

const IDLE: RecordingState = { status: 'idle', projectId: null, title: null, startedAt: null, elapsedSecs: 0, markerCount: 0 }
const DISCORD: MicState = { active: true, apps: [{ id: 'discord', displayName: 'Discord', service: 'discord' }] }
const CHROME: MicState = { active: true, apps: [{ id: 'chrome', displayName: 'chrome.exe', service: null }] }
const RESULT: RecordingResult = {
  path: 'C:/rec/appel.mp3',
  durationSecs: 600,
  sizeBytes: 2_000_000,
  mimeType: 'audio/mpeg',
  projectId: 'p-2',
  title: null,
  markers: [],
}

function recording(projectId: string, startedAt: number, markerCount = 0): RecordingState {
  return { status: 'recording', projectId, title: null, startedAt, elapsedSecs: 0, markerCount }
}

/** Heure de départ de l'horloge simulée (testUtils). */
const T0 = 1_000_000

function calendarEvent(fields: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    title: 'Point Ibé',
    start: T0 + 60_000,
    end: T0 + 31 * 60_000,
    allDay: false,
    status: 'confirmed',
    myResponse: 'accepted',
    attendees: ['lea@ibe.fr'],
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    appName: 'Google Meet',
    ...fields,
  }
}

const DIRECTORY: ClientDirectoryEntry[] = [
  {
    clientId: 'c-ibe',
    clientName: 'Ibé',
    emails: ['lea@ibe.fr'],
    projects: [{ id: 'p-1', name: 'App Ibé', status: 'in_progress', createdAt: '2026-10-01' }],
  },
]

function setup(
  options: {
    signedIn?: boolean
    status?: RecordingState
    lastProject?: string | null
    mic?: MicState
    storedCall?: RecordingCall | null
    events?: CalendarEvent[]
    directory?: ClientDirectoryEntry[] | Error
  } = {},
) {
  const prompt = fakeEvent<PromptPayload>()
  const recordingState = fakeEvent<RecordingState>()
  const mic = fakeEvent<MicState>()
  const level = fakeEvent<AudioLevel>()
  const markersEvent = fakeEvent<RecordingMarkers>()
  const calendarEvents = createCalendarStore()
  if (options.events) calendarEvents.set(options.events)
  let markerCount = 0
  const deps = {
    getStatus: vi.fn(async () => ({ mic: options.mic ?? DISCORD, recording: options.status ?? IDLE })),
    startRecording: vi.fn(async (args: { projectId: string }) => recording(args.projectId, 1_000_500)),
    stopRecording: vi.fn(async () => RESULT),
    dismissPrompt: vi.fn(async () => {}),
    onPrompt: prompt.subscribe,
    onRecordingState: recordingState.subscribe,
    onMicState: mic.subscribe,
    onAudioLevel: level.subscribe,
    readLastProjectId: vi.fn(() => options.lastProject ?? null),
    writeLastProjectId: vi.fn(),
    readRecordingCall: vi.fn(() => options.storedCall ?? null),
    writeRecordingCall: vi.fn(),
    addRecordingMarker: vi.fn(async (): Promise<RecordingMarkers> => {
      markerCount += 1
      return { count: markerCount, lastAtSecs: markerCount * 10, added: true }
    }),
    removeLastRecordingMarker: vi.fn(async (): Promise<RecordingMarkers> => {
      markerCount = Math.max(0, markerCount - 1)
      return { count: markerCount, lastAtSecs: markerCount > 0 ? markerCount * 10 : null, added: false }
    }),
    onRecordingMarkers: markersEvent.subscribe,
    calendarEvents,
    loadClientDirectory: vi.fn(async () => {
      const directory = options.directory ?? DIRECTORY
      if (directory instanceof Error) throw directory
      return directory
    }),
  } satisfies CallSourceDeps
  const env = setupRuntime({ sources: [createCallSource(deps)], signedIn: options.signedIn })
  const send = (reason: PromptReason, state: RecordingState = IDLE, micState: MicState = DISCORD) =>
    prompt.emit({ reason, mic: micState, recording: state })
  const call = () => env.runtime.view.get().call
  const markers = () => env.runtime.view.get().markers
  return { ...env, deps, prompt, recordingState, mic, level, markersEvent, calendarEvents, send, call, markers }
}

describe('source « appel »', () => {
  it('mic-active : « Appel détecté dans Discord », dernier projet utilisé par défaut', async () => {
    const t = setup({ lastProject: 'p-2' })
    await flush()
    t.send('mic-active')
    await flush()
    expect(t.snap().state).toBe('appel')
    expect(t.call()).toMatchObject({ appName: 'Discord', service: 'discord', selectedProjectId: 'p-2' })
    expect(t.call()?.projects).toHaveLength(2)
  })

  it('Transcrire : démarre l’enregistrement, retient le projet, passe en meet avec l’heure de départ réelle', async () => {
    const t = setup()
    await flush()
    t.send('mic-active')
    await flush()
    t.runtime.gestures.onProjectChange('p-2')
    expect(t.call()?.selectedProjectId).toBe('p-2')
    t.runtime.gestures.onCallAccept('p-2')
    expect(t.snap().state).toBe('meet')
    await flush()
    expect(t.deps.startRecording).toHaveBeenCalledWith({ projectId: 'p-2', title: null })
    expect(t.deps.writeLastProjectId).toHaveBeenCalledWith('p-2')
    expect(t.call()).toBeNull()
    expect(t.coordinator.getActivity(MEET_ID)).toMatchObject({
      appName: 'Discord',
      service: 'discord',
      projectId: 'p-2',
      projectName: 'Site Sordulo',
      startedAt: 1_000_500,
    })
  })

  it('Ignorer : écarte la proposition côté Rust et retire l’overlay', async () => {
    const t = setup()
    await flush()
    t.send('mic-active')
    await flush()
    t.runtime.gestures.onCallIgnore()
    expect(t.snap().state).toBe('repos')
    expect(t.deps.dismissPrompt).toHaveBeenCalledTimes(1)
  })

  it('manual-start : même overlay sans nom d’app ; Annuler ne touche pas à Rust', async () => {
    const t = setup()
    await flush()
    t.send('manual-start', IDLE, { active: false, apps: [] })
    await flush()
    expect(t.snap().state).toBe('appel')
    expect(t.call()?.appName).toBe('')
    expect(t.call()?.service).toBeNull()
    t.runtime.gestures.onCallIgnore()
    expect(t.deps.dismissPrompt).not.toHaveBeenCalled()
  })

  it('sans connexion : notification « Connecte-toi » au lieu de l’overlay', async () => {
    const t = setup({ signedIn: false })
    await flush()
    t.send('mic-active')
    await flush()
    t.clock.advance(2500)
    await flush()
    expect(t.snap().state).toBe('notif')
    expect(t.snap().notification).toMatchObject({ kind: 'loginRequired', subtitle: "Pour transcrire l'appel Discord" })
  })

  it('le micro se libère avant le choix : la proposition disparaît', async () => {
    const t = setup()
    await flush()
    t.send('mic-active')
    await flush()
    t.mic.emit({ active: false, apps: [] })
    expect(t.snap().state).toBe('repos')
  })

  it('reprend un enregistrement en cours au démarrage', async () => {
    const t = setup({ status: recording('p-1', 999_000) })
    await flush()
    expect(t.snap().state).toBe('meet')
    expect(t.coordinator.getActivity(MEET_ID)).toMatchObject({
      appName: 'Discord',
      service: 'discord',
      projectName: 'App Ibé',
      startedAt: 999_000,
    })
  })

  it('app non reconnue : service inconnu, icône et couleur génériques', async () => {
    const t = setup({ mic: CHROME })
    await flush()
    t.send('mic-active', IDLE, CHROME)
    await flush()
    expect(t.call()).toMatchObject({ appName: 'chrome.exe', service: null })
    t.runtime.gestures.onCallAccept('p-1')
    await flush()
    expect(t.coordinator.getActivity(MEET_ID)).toMatchObject({ appName: 'chrome.exe', service: null })
  })

  it('enregistrement manuel : service inconnu même si une app d’appel tient le micro', async () => {
    const t = setup()
    await flush()
    t.send('manual-start', IDLE, DISCORD)
    await flush()
    expect(t.call()).toMatchObject({ appName: '', service: null })
    t.runtime.gestures.onCallAccept('p-1')
    await flush()
    expect(t.coordinator.getActivity(MEET_ID)).toMatchObject({ service: null })
  })

  it('garde l’app de l’appel pour retrouver son logo après un redémarrage de la page', async () => {
    const t = setup({
      status: recording('p-1', 999_000),
      mic: { active: false, apps: [] },
      storedCall: { appName: 'Zoom', service: 'zoom' },
    })
    await flush()
    expect(t.coordinator.getActivity(MEET_ID)).toMatchObject({ appName: 'Zoom', service: 'zoom' })
    const saved = setup()
    await flush()
    saved.send('mic-active')
    await flush()
    saved.runtime.gestures.onCallAccept('p-1')
    await flush()
    expect(saved.deps.writeRecordingCall).toHaveBeenCalledWith({ appName: 'Discord', service: 'discord' })
    saved.runtime.gestures.onStopRecording()
    await flush()
    expect(saved.deps.writeRecordingCall).toHaveBeenLastCalledWith(null)
  })

  it('onde : garde les derniers niveaux reçus dans le tableau donné au rendu', async () => {
    const t = setup({ status: recording('p-1', 999_000) })
    await flush()
    const levels = t.runtime.view.get().audioLevels
    for (let i = 0; i < 30; i++) t.level.emit({ level: 0.5, at: i })
    expect(levels).toHaveLength(26)
    expect(t.runtime.view.get().audioLevels).toBe(levels)
  })

  it('mic-inactive pendant l’enregistrement : « L’appel semble terminé » avec Arrêter', async () => {
    const t = setup({ status: recording('p-1', 999_000) })
    await flush()
    t.send('mic-inactive', recording('p-1', 999_000), { active: false, apps: [] })
    expect(t.snap().notification).toMatchObject({ kind: 'callEnded', action: { type: 'stopRecording' } })
    expect(t.snap().withCall).toBe(true)
  })

  it('manual-start pendant l’enregistrement : « Enregistrement en cours » avec Arrêter, même en concentration', async () => {
    const t = setup({ status: recording('p-1', 999_000) })
    await flush()
    t.coordinator.setFocusMode(true)
    t.send('manual-start', recording('p-1', 999_000))
    expect(t.snap().state).toBe('notif')
    expect(t.snap().notification).toMatchObject({ kind: 'recording', action: { type: 'stopRecording' } })
  })

  it('Arrêter : fin de l’appel, puis le bus annonce l’arrêt et le fichier', async () => {
    const t = setup({ status: recording('p-1', 999_000) })
    await flush()
    const stopping = vi.fn()
    const stopped = vi.fn()
    t.runtime.bus.on('recordingStopping', stopping)
    t.runtime.bus.on('recordingStopped', stopped)
    t.send('mic-inactive', recording('p-1', 999_000), { active: false, apps: [] })
    const n = t.snap().notification!
    t.runtime.runAction(n)
    expect(t.coordinator.getActivity(MEET_ID)).toBeNull()
    expect(stopping).toHaveBeenCalledTimes(1)
    await flush()
    expect(t.deps.stopRecording).toHaveBeenCalledTimes(1)
    expect(stopped).toHaveBeenCalledWith(RESULT)
  })

  it('manual-stop : arrêt direct ; un arrêt manqué remet l’appel et prévient', async () => {
    const t = setup({ status: recording('p-1', 999_000) })
    await flush()
    t.deps.stopRecording.mockRejectedValueOnce('Aucun enregistrement')
    const failed = vi.fn()
    t.runtime.bus.on('recordingStopFailed', failed)
    t.send('manual-stop', recording('p-1', 999_000))
    await flush()
    expect(failed).toHaveBeenCalledWith({ message: 'Aucun enregistrement' })
    expect(t.coordinator.getActivity(MEET_ID)).not.toBeNull()
    expect(t.snap().notification).toMatchObject({ kind: 'recordError', title: "L'enregistrement ne s'est pas arrêté" })
  })

  it('un démarrage manqué retire l’appel et prévient', async () => {
    const t = setup()
    await flush()
    t.deps.startRecording.mockRejectedValueOnce('Aucun micro')
    t.send('mic-active')
    await flush()
    t.runtime.gestures.onCallAccept('p-1')
    await flush()
    expect(t.coordinator.getActivity(MEET_ID)).toBeNull()
    expect(t.snap().notification).toMatchObject({
      kind: 'recordError',
      title: "L'enregistrement n'a pas démarré",
      subtitle: 'Aucun micro',
    })
  })

  it('l’enregistrement s’arrête ailleurs : l’appel quitte l’île', async () => {
    const t = setup({ status: recording('p-1', 999_000) })
    await flush()
    t.recordingState.emit(IDLE)
    expect(t.snap().state).toBe('repos')
  })
})

describe('source « appel » : moments marqués', () => {
  async function recordingSetup() {
    const t = setup()
    await flush()
    t.send('mic-active')
    await flush()
    t.runtime.gestures.onCallAccept('p-1')
    await flush()
    return t
  }

  it('hors enregistrement : pas de repères ; Transcrire : compteur à 0', async () => {
    const t = setup()
    await flush()
    expect(t.markers()).toBeNull()
    t.send('mic-active')
    await flush()
    t.runtime.gestures.onMarkMoment()
    expect(t.deps.addRecordingMarker).not.toHaveBeenCalled()
    t.runtime.gestures.onCallAccept('p-1')
    expect(t.markers()).toEqual({ count: 0, lastAddedAt: null, undoUntil: null })
  })

  it('Marquer : repère posé par Rust, étoile et « Annuler » pendant 5 s', async () => {
    const t = await recordingSetup()
    t.runtime.gestures.onMarkMoment()
    await flush()
    expect(t.deps.addRecordingMarker).toHaveBeenCalledTimes(1)
    expect(t.markers()).toEqual({ count: 1, lastAddedAt: T0, undoUntil: T0 + MARKER_UNDO_MS })
    t.clock.advance(MARKER_UNDO_MS)
    expect(t.markers()).toEqual({ count: 1, lastAddedAt: T0, undoUntil: null })
  })

  it('l’événement de Rust après la réponse de la commande ne rejoue pas l’étoile', async () => {
    const t = await recordingSetup()
    t.runtime.gestures.onMarkMoment()
    await flush()
    const first = t.markers()
    t.clock.advance(1000)
    t.markersEvent.emit({ count: 1, lastAtSecs: 10, added: true })
    expect(t.markers()).toBe(first)
  })

  it('raccourci global : l’événement seul ajoute le repère', async () => {
    const t = await recordingSetup()
    t.clock.advance(2000)
    t.markersEvent.emit({ count: 1, lastAtSecs: 42, added: true })
    expect(t.markers()).toEqual({ count: 1, lastAddedAt: T0 + 2000, undoUntil: T0 + 2000 + MARKER_UNDO_MS })
    expect(t.deps.addRecordingMarker).not.toHaveBeenCalled()
  })

  it('Annuler : retire le dernier repère, seulement pendant les 5 s', async () => {
    const t = await recordingSetup()
    t.runtime.gestures.onMarkMoment()
    await flush()
    t.runtime.gestures.onMarkMoment()
    await flush()
    t.runtime.gestures.onUndoMarker()
    await flush()
    expect(t.deps.removeLastRecordingMarker).toHaveBeenCalledTimes(1)
    expect(t.markers()).toEqual({ count: 1, lastAddedAt: T0, undoUntil: null })
    t.runtime.gestures.onUndoMarker()
    await flush()
    expect(t.deps.removeLastRecordingMarker).toHaveBeenCalledTimes(1)

    t.runtime.gestures.onMarkMoment()
    await flush()
    t.clock.advance(MARKER_UNDO_MS + 1)
    t.runtime.gestures.onUndoMarker()
    await flush()
    expect(t.deps.removeLastRecordingMarker).toHaveBeenCalledTimes(1)
  })

  it('page rechargée pendant l’appel : compteur repris de Rust ; arrêt : plus de repères', async () => {
    const t = setup({ status: recording('p-1', 999_000, 3) })
    await flush()
    expect(t.markers()).toEqual({ count: 3, lastAddedAt: null, undoUntil: null })
    t.recordingState.emit(recording('p-1', 999_000, 4))
    expect(t.markers()?.count).toBe(4)
    t.runtime.gestures.onStopRecording()
    expect(t.markers()).toBeNull()
  })

  it('l’enregistrement s’arrête ailleurs : plus de repères ; un événement tardif est ignoré', async () => {
    const t = setup({ status: recording('p-1', 999_000, 1) })
    await flush()
    t.recordingState.emit(IDLE)
    expect(t.markers()).toBeNull()
    t.markersEvent.emit({ count: 2, lastAtSecs: 20, added: true })
    expect(t.markers()).toBeNull()
  })

  it('démarrage manqué : plus de repères', async () => {
    const t = setup()
    await flush()
    t.deps.startRecording.mockRejectedValueOnce('Aucun micro')
    t.send('mic-active')
    await flush()
    t.runtime.gestures.onCallAccept('p-1')
    await flush()
    expect(t.markers()).toBeNull()
  })
})

describe('source « appel » : agenda', () => {
  it('événement en cours : projet du client présélectionné avec la raison, titre de l’entrée', async () => {
    const t = setup({ lastProject: 'p-2', events: [calendarEvent()] })
    await flush()
    t.send('mic-active')
    await flush()
    expect(t.deps.loadClientDirectory).toHaveBeenCalledTimes(1)
    expect(t.call()).toMatchObject({ selectedProjectId: 'p-1', reason: "D'après l'agenda : Point Ibé" })
    t.runtime.gestures.onCallAccept(t.call()!.selectedProjectId)
    await flush()
    expect(t.deps.startRecording).toHaveBeenCalledWith({ projectId: 'p-1', title: 'Point Ibé' })
  })

  it('un autre projet choisi : la raison disparaît, le titre de l’événement reste', async () => {
    const t = setup({ events: [calendarEvent()] })
    await flush()
    t.send('mic-active')
    await flush()
    t.runtime.gestures.onProjectChange('p-2')
    expect(t.call()).toMatchObject({ selectedProjectId: 'p-2', reason: null })
    t.runtime.gestures.onCallAccept('p-2')
    await flush()
    expect(t.deps.startRecording).toHaveBeenCalledWith({ projectId: 'p-2', title: 'Point Ibé' })
  })

  it('annuaire illisible : présélection par le titre, sinon dernier projet ; jamais bloquant', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = setup({ lastProject: 'p-2', directory: new Error('réseau'), events: [calendarEvent({ title: 'Démo App Ibé' })] })
    await flush()
    t.send('mic-active')
    await flush()
    expect(t.snap().state).toBe('appel')
    expect(t.call()).toMatchObject({ selectedProjectId: 'p-1', reason: "D'après l'agenda : Démo App Ibé" })
    warn.mockRestore()
  })

  it('événement lointain, refusé ou sur la journée : comportement habituel', async () => {
    const t = setup({
      lastProject: 'p-2',
      events: [
        calendarEvent({ id: 'loin', start: T0 + 3_600_000, end: T0 + 7_200_000 }),
        calendarEvent({ id: 'refus', myResponse: 'declined' }),
        calendarEvent({ id: 'jour', allDay: true, start: T0 - 60_000 }),
      ],
    })
    await flush()
    t.send('manual-start', IDLE, { active: false, apps: [] })
    await flush()
    expect(t.call()).toMatchObject({ selectedProjectId: 'p-2', reason: null })
    expect(t.deps.loadClientDirectory).not.toHaveBeenCalled()
    t.runtime.gestures.onCallAccept('p-2')
    await flush()
    expect(t.deps.startRecording).toHaveBeenCalledWith({ projectId: 'p-2', title: null })
  })

  it('agenda lu pendant que la proposition est ouverte : présélection mise à jour', async () => {
    const t = setup({ lastProject: 'p-2' })
    await flush()
    t.send('mic-active')
    await flush()
    expect(t.call()).toMatchObject({ selectedProjectId: 'p-2', reason: null })
    t.calendarEvents.set([calendarEvent()])
    await flush()
    expect(t.call()).toMatchObject({ selectedProjectId: 'p-1', reason: "D'après l'agenda : Point Ibé" })
  })

  it('annuaire gardé en cache entre deux propositions', async () => {
    const t = setup({ events: [calendarEvent()] })
    await flush()
    t.send('mic-active')
    await flush()
    t.runtime.gestures.onCallIgnore()
    t.send('mic-active')
    await flush()
    expect(t.deps.loadClientDirectory).toHaveBeenCalledTimes(1)
  })
})
