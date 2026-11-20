import { describe, expect, it, vi } from 'vitest'
import type { Input } from '../../../../shared/types'
import type { UploadMeetingParams, UploadResume } from '../../../inputs/uploadMeeting'
import type { ClaudeSession } from '../../types'
import type { IslandDropZone } from '../../view/types'
import { analysisProgressId } from '../callFlow'
import { PROJECTS, fakeEvent, flush, setupRuntime } from '../testUtils'
import { DROP_PROGRESS_ID, createDropSource, type DropEvent, type DropSourceDeps } from './drop'

const AUDIO = 'C:\\Users\\moi\\Documents\\Réunion Ibé.m4a'
const PDF = 'C:\\Users\\moi\\Documents\\cahier.pdf'
const SHAPE = { left: 100, top: 0, right: 300, bottom: 50 }

const WORKING = {
  id: 's-1',
  projectName: 'App Ibé',
  projectId: null,
  cwd: 'C:/x',
  branch: null,
  task: null,
  step: null,
  status: 'working',
  startedAt: 0,
  conflict: false,
  error: false,
  subagents: 0,
} satisfies ClaudeSession

class FakeUploadError extends Error {
  constructor(
    message: string,
    readonly resume: UploadResume,
  ) {
    super(message)
  }
}

function setup(options: { lastProjectId?: string | null; signedIn?: boolean; projects?: typeof PROJECTS } = {}) {
  const event = fakeEvent<DropEvent>()
  let zone: IslandDropZone | null = null
  let shapes = [SHAPE]
  const deps = {
    onDragDrop: event.subscribe,
    devicePixelRatio: () => 2,
    shapeRects: vi.fn(() => shapes),
    zoneAt: vi.fn(() => zone),
    readDroppedAudio: vi.fn(async () => new ArrayBuffer(8)),
    uploadMeetingRecording: vi.fn(async (params: UploadMeetingParams) => {
      params.onCreated?.({ input: { id: 'i-1' } as Input, upload: { bucket: 'audio', path: 'x', token: 't' } })
      return { input: { id: 'i-1', project_id: params.projectId } as Input }
    }),
    copyText: vi.fn(async () => {}),
    readLastProjectId: vi.fn(() => options.lastProjectId ?? null),
  } satisfies DropSourceDeps
  const env = setupRuntime({ sources: [createDropSource(deps)], signedIn: options.signedIn, projects: options.projects })
  const tracked = vi.fn()
  env.runtime.bus.on('trackInput', tracked)
  return {
    ...env,
    deps,
    tracked,
    view: () => env.runtime.view.get(),
    setZone: (z: IslandDropZone | null) => {
      zone = z
    },
    setShapes: (rects: typeof shapes) => {
      shapes = rects
    },
    /** Position en px physiques (écran à 200 %) : (x, y) CSS = (px / 2). */
    send: (e: DropEvent) => event.emit(e),
    event,
  }
}

type T = ReturnType<typeof setup>
const ON_SHAPE = { x: 400, y: 50 }
const IN_MARGIN = { x: 160, y: 110 } // CSS (80, 55) : hors forme, à moins de 24 px
const FAR = { x: 100, y: 300 }

async function started(t: T) {
  await flush()
  return t
}

describe('source « dépôt »', () => {
  it('s’abonne aux événements et se désabonne à l’arrêt', async () => {
    const t = await started(setup())
    expect(t.event.listeners).toBe(1)
    t.runtime.dispose()
    expect(t.event.listeners).toBe(0)
  })

  it('enter : « Dépose ici », fichier et zones (audio sans session : Transcrire seulement)', async () => {
    const t = await started(setup({ lastProjectId: 'p-2' }))
    t.send({ type: 'enter', paths: [AUDIO], position: IN_MARGIN })
    expect(t.snap().state).toBe('dragWake')
    expect(t.view().drop).toEqual({
      fileName: 'Réunion Ibé.m4a',
      projectName: 'Site Sordulo',
      zones: { transcribe: true, files: false, claude: false },
    })
    expect(t.view().hotZone).toBeNull()
  })

  it('projet : le premier sans dernier projet utilisé', async () => {
    const t = await started(setup())
    t.send({ type: 'enter', paths: [AUDIO], position: FAR })
    expect(t.view().drop?.projectName).toBe('App Ibé')
  })

  it('zone Claude Code seulement avec une session active ; Fichiers jamais', async () => {
    const t = await started(setup())
    t.send({ type: 'enter', paths: [PDF], position: FAR })
    expect(t.view().drop?.zones).toEqual({ transcribe: false, files: false, claude: false })
    t.send({ type: 'leave' })
    t.runtime.view.patch({ sessions: [WORKING] })
    t.send({ type: 'enter', paths: [PDF], position: FAR })
    expect(t.view().drop?.zones).toEqual({ transcribe: false, files: false, claude: true })
  })

  it('over : sur la forme → zones et zone survolée ; trop loin → retour à « Dépose ici »', async () => {
    const t = await started(setup())
    t.send({ type: 'enter', paths: [AUDIO], position: IN_MARGIN })
    expect(t.snap().state).toBe('dragWake')
    t.setZone('transcribe')
    t.send({ type: 'over', position: ON_SHAPE })
    expect(t.snap().state).toBe('dragOver')
    expect(t.view().hotZone).toBe('transcribe')
    // Les 24 px autour de la forme gardent les zones.
    t.setZone(null)
    t.send({ type: 'over', position: IN_MARGIN })
    expect(t.snap().state).toBe('dragOver')
    expect(t.view().hotZone).toBeNull()
    t.send({ type: 'over', position: FAR })
    expect(t.snap().state).toBe('dragWake')
  })

  it('formes introuvables : on passe aux zones plutôt que de rester sur « Dépose ici »', async () => {
    const t = await started(setup())
    t.setShapes([])
    t.send({ type: 'enter', paths: [AUDIO], position: FAR })
    expect(t.snap().state).toBe('dragOver')
  })

  it('leave : retour à l’état précédent', async () => {
    const t = await started(setup())
    t.send({ type: 'enter', paths: [AUDIO], position: ON_SHAPE })
    expect(t.snap().state).toBe('dragOver')
    t.send({ type: 'leave' })
    expect(t.snap().state).toBe('repos')
    expect(t.view().drop).toBeNull()
    expect(t.view().hotZone).toBeNull()
  })

  it('appel proposé : le glissement est ignoré', async () => {
    const t = await started(setup())
    t.coordinator.showOverlay('appel')
    t.send({ type: 'enter', paths: [AUDIO], position: ON_SHAPE })
    expect(t.snap().state).toBe('appel')
    expect(t.view().drop).toBeNull()
    t.send({ type: 'drop', paths: [AUDIO], position: ON_SHAPE })
    expect(t.deps.readDroppedAudio).not.toHaveBeenCalled()
  })

  describe('dépôt sur Transcrire', () => {
    async function dropAudio(t: T) {
      t.send({ type: 'enter', paths: [AUDIO], position: ON_SHAPE })
      t.setZone('transcribe')
      t.send({ type: 'drop', paths: [AUDIO], position: ON_SHAPE })
      await flush()
    }

    it('crée l’entrée réunion sur le dernier projet, « Import de l’audio », puis suit l’analyse', async () => {
      const t = await started(setup({ lastProjectId: 'p-2' }))
      t.send({ type: 'enter', paths: [AUDIO], position: ON_SHAPE })
      t.setZone('transcribe')
      t.send({ type: 'drop', paths: [AUDIO], position: ON_SHAPE })
      expect(t.snap().state).not.toBe('dragOver')
      expect(t.coordinator.getActivity(DROP_PROGRESS_ID)).toMatchObject({ stage: 'upload', label: 'Import de l’audio' })
      await flush()
      expect(t.deps.readDroppedAudio).toHaveBeenCalledWith(AUDIO)
      const params = t.deps.uploadMeetingRecording.mock.calls[0]![0]
      expect(params).toMatchObject({
        projectId: 'p-2',
        title: 'Réunion Ibé',
        fileName: 'Réunion Ibé.m4a',
        contentType: 'audio/mp4',
        resume: { created: null, uploaded: false },
      })
      expect(t.coordinator.getActivity(DROP_PROGRESS_ID)).toBeNull()
      expect(t.tracked).toHaveBeenCalledWith({ inputId: 'i-1', durationSecs: null })
      expect(t.coordinator.getActivity(analysisProgressId('i-1'))).toBeNull() // la source « analyse » n’est pas branchée ici
    })

    it('échec : « L’envoi de l’audio a échoué » ; Réessayer reprend sans doublon', async () => {
      const t = await started(setup())
      t.deps.uploadMeetingRecording.mockImplementationOnce(async (params) => {
        const created = { input: { id: 'i-9' } as Input, upload: { bucket: 'audio', path: 'x', token: 't' } }
        params.onCreated?.(created)
        throw new FakeUploadError('Envoi impossible', { created, uploaded: false })
      })
      await dropAudio(t)
      expect(t.coordinator.getActivity(DROP_PROGRESS_ID)).toBeNull()
      expect(t.snap().notification).toMatchObject({ kind: 'uploadError', subtitle: 'Envoi impossible', action: { type: 'retryUpload' } })
      expect(t.tracked).not.toHaveBeenCalled()
      t.runtime.runAction(t.snap().notification!)
      await flush()
      expect(t.deps.uploadMeetingRecording).toHaveBeenCalledTimes(2)
      const retry = t.deps.uploadMeetingRecording.mock.calls[1]![0]
      expect(retry.resume?.created?.input.id).toBe('i-9')
      expect(t.tracked).toHaveBeenCalledWith({ inputId: 'i-1', durationSecs: null })
    })

    it('lecture impossible : notification d’erreur', async () => {
      const t = await started(setup())
      t.deps.readDroppedAudio.mockRejectedValueOnce('Ce fichier est introuvable.')
      await dropAudio(t)
      expect(t.snap().notification).toMatchObject({ kind: 'uploadError', subtitle: 'Ce fichier est introuvable.' })
      expect(t.deps.uploadMeetingRecording).not.toHaveBeenCalled()
    })

    it('sans connexion : « Connecte-toi dans Sordulo OS »', async () => {
      const t = await started(setup({ signedIn: false }))
      await dropAudio(t)
      expect(t.snap().notification).toMatchObject({ kind: 'loginRequired' })
      expect(t.deps.readDroppedAudio).not.toHaveBeenCalled()
    })

    it('sans projet visible : erreur claire', async () => {
      const t = await started(setup({ projects: [] }))
      await dropAudio(t)
      expect(t.snap().notification).toMatchObject({ kind: 'uploadError' })
      expect(t.deps.readDroppedAudio).not.toHaveBeenCalled()
    })
  })

  describe('dépôt sur Claude Code', () => {
    it('copie le chemin et prévient', async () => {
      const t = await started(setup())
      t.runtime.view.patch({ sessions: [WORKING] })
      t.send({ type: 'enter', paths: [PDF], position: ON_SHAPE })
      t.setZone('claude')
      t.send({ type: 'drop', paths: [PDF], position: ON_SHAPE })
      await flush()
      expect(t.deps.copyText).toHaveBeenCalledWith(PDF)
      expect(t.snap().notification).toMatchObject({ kind: 'pathCopied', subtitle: 'cahier.pdf : colle-le dans Claude Code' })
    })

    it('copie impossible : notification d’erreur, pas de « Chemin copié »', async () => {
      const t = await started(setup())
      t.runtime.view.patch({ sessions: [WORKING] })
      t.deps.copyText.mockRejectedValueOnce(new Error('presse-papiers occupé'))
      t.send({ type: 'enter', paths: [PDF], position: ON_SHAPE })
      t.setZone('claude')
      t.send({ type: 'drop', paths: [PDF], position: ON_SHAPE })
      await flush()
      expect(t.snap().notification).toMatchObject({ kind: 'uploadError' })
    })
  })

  describe('dépôt annulé', () => {
    it.each([
      ['hors de toute zone', null],
      ['sur Fichiers (masquée)', 'files'],
      ['sur Transcrire avec un non audio', 'transcribe'],
      ['sur Claude Code sans session', 'claude'],
    ] as const)('%s', async (_label, zone) => {
      const t = await started(setup())
      t.send({ type: 'enter', paths: [PDF], position: ON_SHAPE })
      t.setZone(zone)
      t.send({ type: 'drop', paths: [PDF], position: ON_SHAPE })
      await flush()
      expect(t.snap().state).toBe('repos')
      expect(t.view().drop).toBeNull()
      expect(t.deps.copyText).not.toHaveBeenCalled()
      expect(t.deps.readDroppedAudio).not.toHaveBeenCalled()
      expect(t.snap().notification).toBeNull()
    })

    it('déposé sur « Dépose ici » (hors de la forme)', async () => {
      const t = await started(setup())
      t.send({ type: 'enter', paths: [AUDIO], position: IN_MARGIN })
      t.setZone('transcribe')
      t.send({ type: 'drop', paths: [AUDIO], position: IN_MARGIN })
      await flush()
      expect(t.deps.readDroppedAudio).not.toHaveBeenCalled()
      expect(t.snap().state).toBe('repos')
    })
  })
})
