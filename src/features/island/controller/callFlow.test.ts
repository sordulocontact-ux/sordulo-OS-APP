import { describe, expect, it } from 'vitest'
import {
  ANALYSIS_LABEL,
  DEFAULT_ANALYSIS_ERROR,
  LEVEL_BUFFER_SIZE,
  LevelBuffer,
  UPLOAD_LABEL,
  analysisDoneNotification,
  analysisErrorNotification,
  analysisProgress,
  errorMessage,
  estimateAnalysisMs,
  estimateUploadMs,
  extensionOf,
  inputPhase,
  micAppName,
  micService,
  pendingDetail,
  pickDefaultProject,
  recordingFileName,
  uploadProgress,
} from './callFlow'

const input = {
  id: 'i-1',
  project_id: 'p-1',
  kind: 'meeting' as const,
  title: 'Call Ibé',
  raw_text: null,
  created_at: '2026-11-20T10:00:00.000Z',
}

describe('tampon des niveaux sonores', () => {
  it('garde les 26 derniers niveaux, le plus récent en dernier, dans le même tableau', () => {
    const buffer = new LevelBuffer()
    const values = buffer.values
    for (let i = 0; i < 40; i++) buffer.push(i / 40)
    expect(buffer.values).toBe(values)
    expect(values).toHaveLength(LEVEL_BUFFER_SIZE)
    expect(LEVEL_BUFFER_SIZE).toBe(26)
    expect(values[values.length - 1]).toBeCloseTo(39 / 40)
    expect(values[0]).toBeCloseTo(14 / 40)
  })

  it('borne les niveaux entre 0 et 1 et se vide', () => {
    const buffer = new LevelBuffer(3)
    buffer.push(-1)
    buffer.push(2)
    buffer.push(Number.NaN)
    expect(buffer.values).toEqual([0, 1, 0])
    buffer.reset()
    expect(buffer.values).toEqual([])
  })
})

describe('statut de l’entrée → suite du parcours', () => {
  it('attend pendant le traitement, prévient à ready ou error', () => {
    expect(inputPhase('uploaded')).toBe('waiting')
    expect(inputPhase('transcribing')).toBe('waiting')
    expect(inputPhase('analyzing')).toBe('waiting')
    expect(inputPhase('ready')).toBe('ready')
    expect(inputPhase('error')).toBe('error')
  })

  it('« N tickets à valider » : Valider ici, Ouvrir mène à l’écran de validation', () => {
    const n = analysisDoneNotification({ input, proposedCount: 6, projectName: 'App Ibé' })
    expect(n).toMatchObject({
      kind: 'tickets',
      title: '6 tickets à valider',
      subtitle: 'Call Ibé, App Ibé',
      button: 'Valider ici',
      action: { type: 'reviewHere', inputId: 'i-1' },
      secondary: { label: 'Ouvrir', action: { type: 'openMain', route: '/projects/p-1/inputs/i-1/review' } },
    })
  })

  it('sans ticket proposé : « Aucun ticket proposé » ouvre la fiche de l’entrée', () => {
    const n = analysisDoneNotification({ input: { ...input, title: null }, proposedCount: 0, projectName: null })
    expect(n).toMatchObject({
      title: 'Aucun ticket proposé',
      button: 'Ouvrir',
      action: { type: 'openMain', route: '/projects/p-1/inputs/i-1' },
    })
    expect(n.subtitle).toMatch(/^Réunion du .+, le projet$/)
  })

  it('analyse en erreur : message du serveur, sinon message par défaut, Réessayer sur l’entrée', () => {
    expect(analysisErrorNotification('i-1', 'Transcription impossible')).toMatchObject({
      subtitle: 'Transcription impossible',
      action: { type: 'retryAnalysis', inputId: 'i-1' },
    })
    expect(analysisErrorNotification('i-1', '  ').subtitle).toBe(DEFAULT_ANALYSIS_ERROR)
  })
})

describe('progressions', () => {
  it('import de l’audio : anneau estimé d’après la taille', () => {
    const p = uploadProgress(1000, 2_500_000)
    expect(p).toMatchObject({ kind: 'progress', stage: 'upload', label: UPLOAD_LABEL, fraction: null, startedAt: 1000 })
    expect(p.kind === 'progress' && p.estimatedMs).toBe(estimateUploadMs(2_500_000))
    expect(estimateUploadMs(2_500_000)).toBe(12_500)
    expect(estimateUploadMs(null)).toBeGreaterThan(0)
    expect(estimateUploadMs(10_000_000)).toBeGreaterThan(estimateUploadMs(1_000_000))
  })

  it('analyse : un id par entrée, estimée d’après la durée de l’appel', () => {
    const p = analysisProgress('i-1', 0, 1800)
    expect(p).toMatchObject({ id: 'prog:analyse:i-1', stage: 'analyse', label: ANALYSIS_LABEL, inputId: 'i-1' })
    expect(estimateAnalysisMs(1800)).toBe(97_000)
    expect(estimateAnalysisMs(null)).toBe(60_000)
  })
})

describe('appel détecté', () => {
  it('nomme la première app d’appel', () => {
    expect(micAppName({ active: true, apps: [{ id: 'discord', displayName: 'Discord', service: 'discord' }] })).toBe('Discord')
    expect(micAppName({ active: false, apps: [] })).toBeNull()
    expect(micAppName(null)).toBeNull()
  })

  it('donne le service de l’app d’appel, null si inconnu', () => {
    const chrome = { id: 'chrome', displayName: 'chrome.exe', service: null }
    const meet = { id: 'edge', displayName: 'Google Meet', service: 'meet' as const }
    expect(micService({ active: true, apps: [meet] })).toBe('meet')
    expect(micService({ active: true, apps: [chrome] })).toBeNull()
    // L'app dont le service est reconnu passe devant, pour le nom comme pour le logo.
    expect(micService({ active: true, apps: [chrome, meet] })).toBe('meet')
    expect(micAppName({ active: true, apps: [chrome, meet] })).toBe('Google Meet')
    expect(micService({ active: false, apps: [] })).toBeNull()
    expect(micService(null)).toBeNull()
  })

  it('propose le dernier projet utilisé s’il est encore visible, sinon le premier', () => {
    const projects = [
      { id: 'a', name: 'App Ibé' },
      { id: 'b', name: 'Site Sordulo' },
    ]
    expect(pickDefaultProject(projects, 'b')).toBe('b')
    expect(pickDefaultProject(projects, 'zz')).toBe('a')
    expect(pickDefaultProject(projects, null)).toBe('a')
    expect(pickDefaultProject([], 'b')).toBeNull()
  })

  it('lit les erreurs Tauri (chaînes) et JS', () => {
    expect(errorMessage('Aucun micro', 'x')).toBe('Aucun micro')
    expect(errorMessage(new Error('Boom'), 'x')).toBe('Boom')
    expect(errorMessage(null, 'x')).toBe('x')
  })
})

describe('fichier envoyé', () => {
  it('nomme le fichier avec la date locale et l’extension du type', () => {
    expect(recordingFileName({ mimeType: 'audio/mpeg' }, new Date(2026, 10, 20, 14, 5))).toBe('appel-202611201405.mp3')
    expect(extensionOf('audio/webm;codecs=opus')).toBe('webm')
    expect(extensionOf('')).toBe('mp3')
  })

  it('détaille la file quand plusieurs appels attendent', () => {
    expect(pendingDetail(1)).toBeUndefined()
    expect(pendingDetail(3)).toBe('3 enregistrements gardés sur cet ordinateur')
  })
})
