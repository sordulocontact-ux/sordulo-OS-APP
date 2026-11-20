import { describe, expect, it, vi } from 'vitest'
import type { Input } from '../../../../shared/types'
import type { UploadMeetingParams, UploadResume } from '../../../inputs/uploadMeeting'
import type { ClaudeSession } from '../../types'
import type { IslandDropZone } from '../../view/types'
import { analysisProgressId } from '../callFlow'
import { PROJECTS, fakeEvent, flush, setupRuntime } from '../testUtils'
import { DROP_PROGRESS_ID, createDropSource, domDragEvents, type DropEvent, type DropSourceDeps } from './drop'

const AUDIO = new File(['audio'], 'Réunion Ibé.m4a', { type: 'audio/mp4' })
const PDF = new File(['pdf'], 'cahier.pdf', { type: 'application/pdf' })
const AUDIO_MIME = 'audio/mp4'
const PDF_MIME = 'application/pdf'
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
    shapeRects: vi.fn(() => shapes),
    zoneAt: vi.fn(() => zone),
    saveDroppedFile: vi.fn(async (_file: File, name: string) => `C:\\drops\\1-${name}`),
    uploadMeetingRecording: vi.fn(async (params: UploadMeetingParams) => {
      params.onCreated?.({ input: { id: 'i-1' } as Input, upload: { bucket: 'audio', path: 'x', token: 't' } })
      return { input: { id: 'i-1', project_id: params.projectId } as Input }
    }),
    createDocumentInput: vi.fn(async (_file: File, _projectId: string) => ({ id: 'i-doc' }) as Input),
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
    /** Positions en px CSS de la fenêtre. */
    send: (e: DropEvent) => event.emit(e),
    event,
  }
}

type T = ReturnType<typeof setup>
const ON_SHAPE = { x: 200, y: 25 }
const IN_MARGIN = { x: 80, y: 55 } // hors forme, à moins de 24 px
const FAR = { x: 50, y: 150 }

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

  it('enter : « Dépose ici », libellé provisoire et zones (audio sans session : Transcrire seulement)', async () => {
    const t = await started(setup({ lastProjectId: 'p-2' }))
    t.send({ type: 'enter', mimeType: AUDIO_MIME, position: IN_MARGIN })
    expect(t.snap().state).toBe('dragWake')
    expect(t.view().drop).toEqual({
      fileName: 'Fichier audio',
      projectName: 'Site Sordulo',
      zones: { transcribe: true, analyse: false, files: false, claude: false },
    })
    expect(t.view().hotZone).toBeNull()
  })

  it('projet : le premier sans dernier projet utilisé', async () => {
    const t = await started(setup())
    t.send({ type: 'enter', mimeType: AUDIO_MIME, position: FAR })
    expect(t.view().drop?.projectName).toBe('App Ibé')
  })

  it('zone Claude Code seulement avec une session active ; Fichiers jamais', async () => {
    const t = await started(setup())
    t.send({ type: 'enter', mimeType: PDF_MIME, position: FAR })
    expect(t.view().drop).toMatchObject({ fileName: 'Document', zones: { transcribe: false, analyse: true, files: false, claude: false } })
    t.send({ type: 'leave' })
    t.runtime.view.patch({ sessions: [WORKING] })
    t.send({ type: 'enter', mimeType: PDF_MIME, position: FAR })
    expect(t.view().drop?.zones).toEqual({ transcribe: false, analyse: true, files: false, claude: true })
  })

  it('over : sur la forme → zones et zone survolée ; trop loin → retour à « Dépose ici »', async () => {
    const t = await started(setup())
    t.send({ type: 'enter', mimeType: AUDIO_MIME, position: IN_MARGIN })
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
    t.send({ type: 'enter', mimeType: AUDIO_MIME, position: FAR })
    expect(t.snap().state).toBe('dragOver')
  })

  it('leave : retour à l’état précédent', async () => {
    const t = await started(setup())
    t.send({ type: 'enter', mimeType: AUDIO_MIME, position: ON_SHAPE })
    expect(t.snap().state).toBe('dragOver')
    t.send({ type: 'leave' })
    expect(t.snap().state).toBe('repos')
    expect(t.view().drop).toBeNull()
    expect(t.view().hotZone).toBeNull()
  })

  it('appel proposé : le glissement est ignoré', async () => {
    const t = await started(setup())
    t.coordinator.showOverlay('appel')
    t.send({ type: 'enter', mimeType: AUDIO_MIME, position: ON_SHAPE })
    expect(t.snap().state).toBe('appel')
    expect(t.view().drop).toBeNull()
    t.send({ type: 'drop', file: AUDIO, position: ON_SHAPE })
    expect(t.deps.uploadMeetingRecording).not.toHaveBeenCalled()
  })

  describe('dépôt sur Transcrire', () => {
    async function dropAudio(t: T) {
      t.send({ type: 'enter', mimeType: AUDIO_MIME, position: ON_SHAPE })
      t.setZone('transcribe')
      t.send({ type: 'drop', file: AUDIO, position: ON_SHAPE })
      await flush()
    }

    it('crée l’entrée réunion sur le dernier projet, « Import de l’audio », puis suit l’analyse', async () => {
      const t = await started(setup({ lastProjectId: 'p-2' }))
      t.send({ type: 'enter', mimeType: AUDIO_MIME, position: ON_SHAPE })
      t.setZone('transcribe')
      t.send({ type: 'drop', file: AUDIO, position: ON_SHAPE })
      expect(t.snap().state).not.toBe('dragOver')
      expect(t.coordinator.getActivity(DROP_PROGRESS_ID)).toMatchObject({ stage: 'upload', label: 'Import de l’audio' })
      await flush()
      const params = t.deps.uploadMeetingRecording.mock.calls[0]![0]
      expect(params).toMatchObject({
        projectId: 'p-2',
        title: 'Réunion Ibé',
        file: AUDIO,
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

    it('type MIME inconnu pendant le glissement : Transcrire n’est pas proposée', async () => {
      const t = await started(setup())
      const untyped = new File(['x'], 'appel.mp3', { type: '' })
      t.send({ type: 'enter', mimeType: '', position: ON_SHAPE })
      expect(t.view().drop).toMatchObject({ fileName: 'Fichier', zones: { transcribe: false } })
      t.setZone('transcribe')
      t.send({ type: 'drop', file: untyped, position: ON_SHAPE })
      await flush()
      expect(t.deps.uploadMeetingRecording).not.toHaveBeenCalled() // zone non proposée : annulé
    })

    it('sans connexion : « Connecte-toi dans Sordulo OS »', async () => {
      const t = await started(setup({ signedIn: false }))
      await dropAudio(t)
      expect(t.snap().notification).toMatchObject({ kind: 'loginRequired' })
      expect(t.deps.uploadMeetingRecording).not.toHaveBeenCalled()
    })

    it('sans projet visible : erreur claire', async () => {
      const t = await started(setup({ projects: [] }))
      await dropAudio(t)
      expect(t.snap().notification).toMatchObject({ kind: 'uploadError' })
      expect(t.deps.uploadMeetingRecording).not.toHaveBeenCalled()
    })
  })

  describe('dépôt sur Analyser', () => {
    async function dropDocument(t: T, file: File = PDF) {
      t.send({ type: 'enter', mimeType: file.type, position: ON_SHAPE })
      t.setZone('analyse')
      t.send({ type: 'drop', file, position: ON_SHAPE })
      await flush()
    }

    it('crée le retour écrit sur le dernier projet, « Lecture du document », puis suit l’analyse', async () => {
      const t = await started(setup({ lastProjectId: 'p-2' }))
      t.send({ type: 'enter', mimeType: PDF_MIME, position: ON_SHAPE })
      expect(t.view().drop?.zones).toMatchObject({ transcribe: false, analyse: true })
      t.setZone('analyse')
      t.send({ type: 'drop', file: PDF, position: ON_SHAPE })
      expect(t.coordinator.getActivity(DROP_PROGRESS_ID)).toMatchObject({ stage: 'upload', label: 'Lecture du document' })
      await flush()
      expect(t.deps.createDocumentInput).toHaveBeenCalledWith(PDF, 'p-2')
      expect(t.deps.uploadMeetingRecording).not.toHaveBeenCalled()
      expect(t.coordinator.getActivity(DROP_PROGRESS_ID)).toBeNull()
      expect(t.tracked).toHaveBeenCalledWith({ inputId: 'i-doc', durationSecs: null })
    })

    it('nom non pris en charge au dépôt : erreur claire, rien créé', async () => {
      const t = await started(setup())
      // Le type MIME annonçait un PDF (zone proposée), mais le vrai fichier n'est pas un document.
      t.send({ type: 'enter', mimeType: PDF_MIME, position: ON_SHAPE })
      t.setZone('analyse')
      t.send({ type: 'drop', file: new File(['x'], 'photo.png', { type: 'image/png' }), position: ON_SHAPE })
      await flush()
      expect(t.deps.createDocumentInput).not.toHaveBeenCalled()
      expect(t.snap().notification).toMatchObject({ kind: 'uploadError', subtitle: expect.stringContaining('format non pris en charge') })
    })

    it('échec d’extraction : notification d’erreur, Réessayer relance le même document', async () => {
      const t = await started(setup())
      t.deps.createDocumentInput.mockRejectedValueOnce(new Error('« cahier.pdf » : aucun texte trouvé (PDF scanné ?).'))
      await dropDocument(t)
      expect(t.coordinator.getActivity(DROP_PROGRESS_ID)).toBeNull()
      expect(t.snap().notification).toMatchObject({ kind: 'uploadError', subtitle: '« cahier.pdf » : aucun texte trouvé (PDF scanné ?).' })
      expect(t.tracked).not.toHaveBeenCalled()
      t.runtime.runAction(t.snap().notification!)
      await flush()
      expect(t.deps.createDocumentInput).toHaveBeenCalledTimes(2)
      expect(t.tracked).toHaveBeenCalledWith({ inputId: 'i-doc', durationSecs: null })
    })

    it('sans connexion : « Connecte-toi dans Sordulo OS »', async () => {
      const t = await started(setup({ signedIn: false }))
      await dropDocument(t)
      expect(t.snap().notification).toMatchObject({ kind: 'loginRequired' })
      expect(t.deps.createDocumentInput).not.toHaveBeenCalled()
    })

    it('un audio n’a pas la zone Analyser : dépôt annulé', async () => {
      const t = await started(setup())
      t.send({ type: 'enter', mimeType: AUDIO_MIME, position: ON_SHAPE })
      expect(t.view().drop?.zones.analyse).toBe(false)
      t.setZone('analyse')
      t.send({ type: 'drop', file: AUDIO, position: ON_SHAPE })
      await flush()
      expect(t.deps.createDocumentInput).not.toHaveBeenCalled()
    })
  })

  describe('dépôt sur Claude Code', () => {
    it('enregistre une copie, copie son chemin et prévient', async () => {
      const t = await started(setup())
      t.runtime.view.patch({ sessions: [WORKING] })
      t.send({ type: 'enter', mimeType: PDF_MIME, position: ON_SHAPE })
      t.setZone('claude')
      t.send({ type: 'drop', file: PDF, position: ON_SHAPE })
      await flush()
      expect(t.deps.saveDroppedFile).toHaveBeenCalledWith(PDF, 'cahier.pdf')
      expect(t.deps.copyText).toHaveBeenCalledWith('C:\\drops\\1-cahier.pdf')
      expect(t.snap().notification).toMatchObject({ kind: 'pathCopied', subtitle: 'cahier.pdf : colle-le dans Claude Code' })
    })

    it('enregistrement impossible : notification d’erreur, rien de copié', async () => {
      const t = await started(setup())
      t.runtime.view.patch({ sessions: [WORKING] })
      t.deps.saveDroppedFile.mockRejectedValueOnce('Ce fichier est trop volumineux (80 Mo). Maximum : 50 Mo.')
      t.send({ type: 'enter', mimeType: PDF_MIME, position: ON_SHAPE })
      t.setZone('claude')
      t.send({ type: 'drop', file: PDF, position: ON_SHAPE })
      await flush()
      expect(t.deps.copyText).not.toHaveBeenCalled()
      expect(t.snap().notification).toMatchObject({ kind: 'uploadError', subtitle: 'Ce fichier est trop volumineux (80 Mo). Maximum : 50 Mo.' })
    })

    it('copie impossible : notification d’erreur, pas de « Chemin copié »', async () => {
      const t = await started(setup())
      t.runtime.view.patch({ sessions: [WORKING] })
      t.deps.copyText.mockRejectedValueOnce(new Error('presse-papiers occupé'))
      t.send({ type: 'enter', mimeType: PDF_MIME, position: ON_SHAPE })
      t.setZone('claude')
      t.send({ type: 'drop', file: PDF, position: ON_SHAPE })
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
      t.send({ type: 'enter', mimeType: PDF_MIME, position: ON_SHAPE })
      t.setZone(zone)
      t.send({ type: 'drop', file: PDF, position: ON_SHAPE })
      await flush()
      expect(t.snap().state).toBe('repos')
      expect(t.view().drop).toBeNull()
      expect(t.deps.copyText).not.toHaveBeenCalled()
      expect(t.deps.saveDroppedFile).not.toHaveBeenCalled()
      expect(t.deps.uploadMeetingRecording).not.toHaveBeenCalled()
      expect(t.snap().notification).toBeNull()
    })

    it('déposé sur « Dépose ici » (hors de la forme)', async () => {
      const t = await started(setup())
      t.send({ type: 'enter', mimeType: AUDIO_MIME, position: IN_MARGIN })
      t.setZone('transcribe')
      t.send({ type: 'drop', file: AUDIO, position: IN_MARGIN })
      await flush()
      expect(t.deps.uploadMeetingRecording).not.toHaveBeenCalled()
      expect(t.snap().state).toBe('repos')
    })
  })
})

// ---------------------------------------------------------------------------
// Événements DOM → DropEvent
// ---------------------------------------------------------------------------

describe('domDragEvents', () => {
  /** Faux événement de glissement : seuls les champs lus par l'adaptateur. */
  function fakeDrag(options: { types?: string[]; mime?: string; files?: File[]; x?: number; y?: number } = {}) {
    const dataTransfer = {
      types: options.types ?? ['Files'],
      items: [{ type: options.mime ?? 'audio/mp4' }],
      files: options.files ?? [],
      dropEffect: 'none',
    }
    return { clientX: options.x ?? 10, clientY: options.y ?? 20, dataTransfer, preventDefault: vi.fn() }
  }

  function setupDom() {
    const target = new EventTarget()
    const events: DropEvent[] = []
    const stop = domDragEvents(target as unknown as Window, (e) => events.push(e))
    const fire = (type: string, drag: ReturnType<typeof fakeDrag>) => {
      const event = Object.assign(new Event(type, { cancelable: true }), drag)
      target.dispatchEvent(event)
      return drag
    }
    return { events, fire, stop }
  }

  it('dragenter / dragover / drop : positions en px CSS, copie autorisée, type MIME lu', () => {
    const d = setupDom()
    const enter = d.fire('dragenter', fakeDrag({ x: 12, y: 34 }))
    expect(enter.preventDefault).toHaveBeenCalled()
    const over = d.fire('dragover', fakeDrag({ x: 15, y: 36 }))
    expect(over.preventDefault).toHaveBeenCalled()
    expect(over.dataTransfer.dropEffect).toBe('copy')
    const drop = d.fire('drop', fakeDrag({ files: [AUDIO], x: 20, y: 40 }))
    expect(drop.preventDefault).toHaveBeenCalled()
    expect(d.events).toEqual([
      { type: 'enter', mimeType: 'audio/mp4', position: { x: 12, y: 34 } },
      { type: 'over', position: { x: 15, y: 36 } },
      { type: 'drop', file: AUDIO, position: { x: 20, y: 40 } },
    ])
  })

  it('dragleave : seule la dernière sortie (compteur de profondeur) émet « leave »', () => {
    const d = setupDom()
    d.fire('dragenter', fakeDrag()) // fenêtre
    d.fire('dragenter', fakeDrag()) // élément enfant
    d.fire('dragleave', fakeDrag()) // quitte l'enfant
    expect(d.events.map((e) => e.type)).toEqual(['enter'])
    d.fire('dragleave', fakeDrag()) // quitte la fenêtre
    expect(d.events.map((e) => e.type)).toEqual(['enter', 'leave'])
    d.fire('dragleave', fakeDrag()) // sans effet
    expect(d.events.map((e) => e.type)).toEqual(['enter', 'leave'])
  })

  it('un glissement sans fichier (texte, lien) est ignoré et reste autorisé par défaut', () => {
    const d = setupDom()
    const enter = d.fire('dragenter', fakeDrag({ types: ['text/plain'] }))
    d.fire('dragover', fakeDrag({ types: ['text/plain'] }))
    d.fire('drop', fakeDrag({ types: ['text/plain'] }))
    expect(d.events).toEqual([])
    expect(enter.preventDefault).not.toHaveBeenCalled()
  })

  it('dépôt sans fichier lisible : « leave » ; le compteur repart de zéro', () => {
    const d = setupDom()
    d.fire('dragenter', fakeDrag())
    d.fire('drop', fakeDrag({ files: [] }))
    expect(d.events.map((e) => e.type)).toEqual(['enter', 'leave'])
    d.fire('dragenter', fakeDrag())
    expect(d.events.map((e) => e.type)).toEqual(['enter', 'leave', 'enter'])
  })

  it('dragover sans dragenter : rattrape l’entrée', () => {
    const d = setupDom()
    d.fire('dragover', fakeDrag())
    expect(d.events.map((e) => e.type)).toEqual(['enter', 'over'])
  })

  it('le désabonnement retire les écouteurs', () => {
    const d = setupDom()
    d.stop()
    d.fire('dragenter', fakeDrag())
    expect(d.events).toEqual([])
  })
})
