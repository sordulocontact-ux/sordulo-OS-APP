import { describe, expect, it, vi } from 'vitest'
import type {
  AudioLevel,
  MicState,
  PromptPayload,
  PromptReason,
  RecordingResult,
  RecordingState,
} from '../../../../shared/desktop-contract'
import { fakeEvent, flush, setupRuntime } from '../testUtils'
import { MEET_ID, createCallSource, type CallSourceDeps } from './call'

const IDLE: RecordingState = { status: 'idle', projectId: null, title: null, startedAt: null, elapsedSecs: 0 }
const DISCORD: MicState = { active: true, apps: [{ id: 'discord', displayName: 'Discord' }] }
const RESULT: RecordingResult = {
  path: 'C:/rec/appel.mp3',
  durationSecs: 600,
  sizeBytes: 2_000_000,
  mimeType: 'audio/mpeg',
  projectId: 'p-2',
  title: null,
}

function recording(projectId: string, startedAt: number): RecordingState {
  return { status: 'recording', projectId, title: null, startedAt, elapsedSecs: 0 }
}

function setup(options: { signedIn?: boolean; status?: RecordingState; lastProject?: string | null } = {}) {
  const prompt = fakeEvent<PromptPayload>()
  const recordingState = fakeEvent<RecordingState>()
  const mic = fakeEvent<MicState>()
  const level = fakeEvent<AudioLevel>()
  const deps = {
    getStatus: vi.fn(async () => ({ mic: DISCORD, recording: options.status ?? IDLE })),
    startRecording: vi.fn(async (args: { projectId: string }) => recording(args.projectId, 1_000_500)),
    stopRecording: vi.fn(async () => RESULT),
    dismissPrompt: vi.fn(async () => {}),
    onPrompt: prompt.subscribe,
    onRecordingState: recordingState.subscribe,
    onMicState: mic.subscribe,
    onAudioLevel: level.subscribe,
    readLastProjectId: vi.fn(() => options.lastProject ?? null),
    writeLastProjectId: vi.fn(),
  } satisfies CallSourceDeps
  const env = setupRuntime({ sources: [createCallSource(deps)], signedIn: options.signedIn })
  const send = (reason: PromptReason, state: RecordingState = IDLE, micState: MicState = DISCORD) =>
    prompt.emit({ reason, mic: micState, recording: state })
  const call = () => env.runtime.view.get().call
  return { ...env, deps, prompt, recordingState, mic, level, send, call }
}

describe('source « appel »', () => {
  it('mic-active : « Appel détecté dans Discord », dernier projet utilisé par défaut', async () => {
    const t = setup({ lastProject: 'p-2' })
    await flush()
    t.send('mic-active')
    await flush()
    expect(t.snap().state).toBe('appel')
    expect(t.call()).toMatchObject({ appName: 'Discord', selectedProjectId: 'p-2' })
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
    expect(t.coordinator.getActivity(MEET_ID)).toMatchObject({ appName: 'Discord', projectName: 'App Ibé', startedAt: 999_000 })
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
