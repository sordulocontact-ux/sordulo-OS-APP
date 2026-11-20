import { describe, expect, it, vi } from 'vitest'
import type { RecordingResult } from '../../../../shared/desktop-contract'
import type { Input } from '../../../../shared/types'
import type { UploadMeetingParams, UploadResume } from '../../../inputs/uploadMeeting'
import { UPLOAD_PROGRESS_ID } from '../callFlow'
import { flush, setupRuntime } from '../testUtils'
import { createUploadSource, type UploadSourceDeps } from './upload'

const RESULT: RecordingResult = {
  path: 'C:/rec/appel.mp3',
  durationSecs: 600,
  sizeBytes: 2_000_000,
  mimeType: 'audio/mpeg',
  projectId: 'p-1',
  title: null,
}

const CREATED = { input: { id: 'i-1' } as Input, upload: { bucket: 'audio', path: 'x', token: 't' } }

class FakeUploadError extends Error {
  constructor(
    message: string,
    readonly resume: UploadResume,
  ) {
    super(message)
  }
}

function setup(options: { pending?: RecordingResult[]; signedIn?: boolean } = {}) {
  let pending = [...(options.pending ?? [])]
  const deps = {
    readRecording: vi.fn(async () => new ArrayBuffer(8)),
    deleteRecording: vi.fn(async () => {}),
    uploadMeetingRecording: vi.fn(async (params: UploadMeetingParams) => {
      params.onCreated?.(CREATED)
      return { input: { id: 'i-1', project_id: params.projectId } as Input }
    }),
    readPendingRecordings: vi.fn(() => [...pending]),
    addPendingRecording: vi.fn((r: RecordingResult) => {
      pending = [...pending.filter((p) => p.path !== r.path), r]
    }),
    removePendingRecording: vi.fn((path: string) => {
      pending = pending.filter((p) => p.path !== path)
    }),
  } satisfies UploadSourceDeps
  const env = setupRuntime({ sources: [createUploadSource(deps)], signedIn: options.signedIn })
  const tracked = vi.fn()
  env.runtime.bus.on('trackInput', tracked)
  return { ...env, deps, tracked, pending: () => pending }
}

describe('source « envoi »', () => {
  it('arrêt → « Import de l’audio », envoi, fichier supprimé seulement après, puis suivi de l’analyse', async () => {
    const t = setup()
    t.runtime.bus.emit('recordingStopping')
    expect(t.snap().primary).toMatchObject({ id: UPLOAD_PROGRESS_ID, stage: 'upload', label: 'Import de l’audio' })
    t.runtime.bus.emit('recordingStopped', RESULT)
    expect(t.pending()).toHaveLength(1)
    await flush()
    const params = t.deps.uploadMeetingRecording.mock.calls[0]![0]
    expect(params).toMatchObject({ projectId: 'p-1', contentType: 'audio/mpeg', resume: { created: null, uploaded: false } })
    expect(params.fileName).toMatch(/^appel-\d{12}\.mp3$/)
    expect(t.deps.deleteRecording).toHaveBeenCalledWith(RESULT.path)
    expect(t.pending()).toHaveLength(0)
    expect(t.coordinator.getActivity(UPLOAD_PROGRESS_ID)).toBeNull()
    expect(t.tracked).toHaveBeenCalledWith({ inputId: 'i-1', durationSecs: 600 })
  })

  it('échec : « L’envoi de l’audio a échoué », fichier gardé ; Réessayer reprend sans doublon', async () => {
    const t = setup()
    const resume: UploadResume = { created: CREATED, uploaded: true }
    t.deps.uploadMeetingRecording.mockRejectedValueOnce(new FakeUploadError('Serveur injoignable.', resume))
    t.runtime.bus.emit('recordingStopping')
    t.runtime.bus.emit('recordingStopped', RESULT)
    await flush()
    expect(t.snap().notification).toMatchObject({ kind: 'uploadError', subtitle: 'Serveur injoignable.' })
    expect(t.coordinator.getActivity(UPLOAD_PROGRESS_ID)).toBeNull()
    expect(t.deps.deleteRecording).not.toHaveBeenCalled()
    expect(t.pending()).toHaveLength(1)

    t.runtime.runAction(t.snap().notification!)
    expect(t.snap().primary?.id).toBe(UPLOAD_PROGRESS_ID)
    await flush()
    expect(t.deps.uploadMeetingRecording).toHaveBeenCalledTimes(2)
    expect(t.deps.uploadMeetingRecording.mock.calls[1]![0].resume).toBe(resume)
    expect(t.pending()).toHaveLength(0)
    expect(t.tracked).toHaveBeenCalledTimes(1)
  })

  it('au démarrage, une fois connecté : « Un appel n’a pas été envoyé »', async () => {
    const t = setup({ pending: [RESULT, { ...RESULT, path: 'C:/rec/b.mp3' }], signedIn: false })
    expect(t.snap().notification).toBeNull()
    t.session.set({ status: 'signedIn', userId: 'u', memberId: 'm', organizationId: 'o' })
    expect(t.snap().notification).toMatchObject({
      kind: 'pendingUpload',
      subtitle: '2 enregistrements gardés sur cet ordinateur',
      action: { type: 'retryUpload' },
    })
    t.runtime.runAction(t.snap().notification!)
    await flush()
    expect(t.deps.uploadMeetingRecording).toHaveBeenCalledTimes(2)
    expect(t.tracked).toHaveBeenCalledTimes(2)
  })

  it('arrêt manqué : la progression disparaît', () => {
    const t = setup()
    t.runtime.bus.emit('recordingStopping')
    t.runtime.bus.emit('recordingStopFailed', { message: 'x' })
    expect(t.snap().primary).toBeNull()
  })
})
