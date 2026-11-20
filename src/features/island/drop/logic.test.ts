import { describe, expect, it } from 'vitest'
import type { ClaudeSession, ClaudeSessionStatus } from '../types'
import {
  AUDIO_EXTENSIONS,
  actionableZone,
  audioMimeOf,
  dragLabel,
  dropInfoForDrag,
  extensionOf,
  fileNameOf,
  hasActiveClaudeSession,
  isDocumentFile,
  isDocumentMime,
  audioMimeOfFile,
  isAudioMime,
  inAnyRect,
  inRect,
  isAudioPath,
  titleOf,
  zonesFor,
} from './logic'

function session(status: ClaudeSessionStatus): ClaudeSession {
  return {
    id: `s-${status}`,
    projectName: 'App Ibé',
    projectId: null,
    cwd: 'C:/x',
    branch: null,
    task: null,
    step: null,
    status,
    startedAt: 0,
    conflict: false,
    error: false,
    subagents: 0,
  }
}

describe('fichier glissé', () => {
  it('nom et extension, chemins Windows ou Unix', () => {
    expect(fileNameOf('C:\\Users\\moi\\Documents\\appel.M4A')).toBe('appel.M4A')
    expect(fileNameOf('/home/moi/appel.mp3')).toBe('appel.mp3')
    expect(extensionOf('C:\\a\\appel.M4A')).toBe('m4a')
    expect(extensionOf('C:\\a\\.mp3')).toBe('')
    expect(extensionOf('C:\\a\\sans-extension')).toBe('')
  })

  it('reconnaît les audios par extension', () => {
    for (const ext of ['m4a', 'mp3', 'wav', 'ogg', 'webm', 'aac', 'flac', 'mp4']) {
      expect(isAudioPath(`C:\\a\\fichier.${ext.toUpperCase()}`)).toBe(true)
    }
    expect(AUDIO_EXTENSIONS).toHaveLength(8)
    expect(isAudioPath('C:\\a\\notes.txt')).toBe(false)
    expect(isAudioPath('C:\\a\\appel.mp3.exe')).toBe(false)
  })

  it('types MIME acceptés par l’API', () => {
    expect(audioMimeOf('a.mp3')).toBe('audio/mpeg')
    expect(audioMimeOf('a.m4a')).toBe('audio/mp4')
    expect(audioMimeOf('a.mp4')).toBe('video/mp4')
    expect(audioMimeOf('a.pdf')).toBeNull()
  })

  it('titre sans extension', () => {
    expect(titleOf('C:\\a\\Réunion Ibé.m4a')).toBe('Réunion Ibé')
    expect(titleOf('C:\\a\\v1.2.final.wav')).toBe('v1.2.final')
  })
})

describe('zones', () => {
  it('session active : tout sauf terminée ou inactive', () => {
    expect(hasActiveClaudeSession([])).toBe(false)
    expect(hasActiveClaudeSession([session('done'), session('idle')])).toBe(false)
    expect(hasActiveClaudeSession([session('done'), session('working')])).toBe(true)
    expect(hasActiveClaudeSession([session('waiting')])).toBe(true)
    expect(hasActiveClaudeSession([session('sleep')])).toBe(true)
  })

  it('Transcrire pour l’audio seulement, Claude Code avec une session, Fichiers jamais', () => {
    expect(zonesFor(true, [])).toEqual({ transcribe: true, analyse: false, files: false, claude: false })
    expect(zonesFor(false, [session('working')])).toEqual({ transcribe: false, analyse: false, files: false, claude: true })
    expect(zonesFor(false, [])).toEqual({ transcribe: false, analyse: false, files: false, claude: false })
    expect(zonesFor(false, [], true)).toEqual({ transcribe: false, analyse: true, files: false, claude: false })
  })

  it('infos du rendu pendant le glissement (nom provisoire)', () => {
    expect(dropInfoForDrag({ subject: { mimeType: 'audio/mpeg' }, sessions: [], projectName: 'App Ibé' })).toEqual({
      fileName: 'Fichier audio',
      projectName: 'App Ibé',
      zones: { transcribe: true, analyse: false, files: false, claude: false },
    })
  })

  it('libellé provisoire selon le type MIME', () => {
    expect(dragLabel('audio/x-m4a')).toBe('Fichier audio')
    expect(dragLabel('video/mp4')).toBe('Fichier audio')
    expect(dragLabel('image/png')).toBe('Image')
    expect(dragLabel('application/pdf')).toBe('Document')
    expect(dragLabel('')).toBe('Fichier')
    expect(isAudioMime('AUDIO/WAV')).toBe(true)
    expect(isAudioMime('video/quicktime')).toBe(false)
  })

  it('type du fichier déposé : extension d’abord, sinon type MIME', () => {
    expect(audioMimeOfFile({ name: 'a.m4a', type: '' })).toBe('audio/mp4')
    expect(audioMimeOfFile({ name: 'a.bin', type: 'audio/x-weird' })).toBe('audio/x-weird')
    expect(audioMimeOfFile({ name: 'a.pdf', type: 'application/pdf' })).toBeNull()
  })

  it('documents reconnus par le type MIME (Analyser), jamais l’audio', () => {
    expect(isDocumentMime('application/pdf')).toBe(true)
    expect(isDocumentMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true)
    expect(isDocumentMime('text/plain')).toBe(true)
    expect(isDocumentMime('audio/mpeg')).toBe(false)
    expect(isDocumentMime('image/png')).toBe(false)
    expect(isDocumentMime('')).toBe(false)
    expect(isDocumentFile({ name: 'Retours.docx', type: '' })).toBe(true)
    expect(isDocumentFile({ name: 'photo.png', type: 'image/png' })).toBe(false)
    expect(dropInfoForDrag({ subject: { mimeType: 'application/pdf' }, sessions: [], projectName: 'App Ibé' }).zones).toEqual({
      transcribe: false,
      analyse: true,
      files: false,
      claude: false,
    })
  })

  it('une zone non proposée annule le dépôt', () => {
    const info = dropInfoForDrag({ subject: { mimeType: 'application/pdf' }, sessions: [session('working')], projectName: null })
    expect(actionableZone('claude', info)).toBe('claude')
    expect(actionableZone('transcribe', info)).toBeNull()
    expect(actionableZone('analyse', info)).toBe('analyse')
    expect(actionableZone('files', info)).toBeNull()
    expect(actionableZone(null, info)).toBeNull()
    expect(actionableZone('claude', null)).toBeNull()
  })
})

describe('géométrie', () => {
  const rect = { left: 100, top: 0, right: 200, bottom: 40 }

  it('marge autour de la forme', () => {
    expect(inRect(rect, 0, 150, 20)).toBe(true)
    expect(inRect(rect, 0, 99, 20)).toBe(false)
    expect(inRect(rect, 24, 80, 60)).toBe(true)
    expect(inRect(rect, 24, 75, 20)).toBe(false)
    expect(inRect(rect, 24, 150, 65)).toBe(false)
    expect(inAnyRect([], 24, 150, 20)).toBe(false)
    expect(inAnyRect([rect, { left: 300, top: 0, right: 340, bottom: 30 }], 0, 320, 10)).toBe(true)
  })
})
