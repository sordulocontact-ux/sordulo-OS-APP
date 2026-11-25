import { describe, expect, it } from 'vitest'
import {
  canDecide,
  deliverableStoragePath,
  latestVersion,
  openCount,
  pinNumbers,
  pointFromClick,
  previewKind,
  safeFileName,
  sortComments,
  validateDeliverableFile,
  type ViewerComment,
} from './deliverableLogic'

function comment(partial: Partial<ViewerComment> & { id: string }): ViewerComment {
  return { x: null, y: null, body: 'Texte', authorName: 'Claire', fromClient: true, resolved: false, createdAt: '2026-11-20T10:00:00Z', ...partial }
}

describe('épingles', () => {
  it('position du clic en fractions du rectangle affiché, bornée à 0..1', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 }
    expect(pointFromClick(rect, 300, 100)).toEqual({ x: 0.5, y: 0.25 })
    expect(pointFromClick(rect, 50, 400)).toEqual({ x: 0, y: 1 })
    expect(pointFromClick(rect, 100 + 400 / 3, 50)).toEqual({ x: 0.3333, y: 0 })
    expect(pointFromClick({ left: 0, top: 0, width: 0, height: 10 }, 5, 5)).toBeNull()
  })

  it('numérote les épingles par date de création, sans les commentaires généraux', () => {
    const numbers = pinNumbers([
      comment({ id: 'b', x: 0.2, y: 0.2, createdAt: '2026-11-20T12:00:00Z' }),
      comment({ id: 'general', createdAt: '2026-11-20T09:00:00Z' }),
      comment({ id: 'a', x: 0.1, y: 0.1, createdAt: '2026-11-20T11:00:00Z' }),
    ])
    expect([...numbers.entries()]).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('liste : non résolus d’abord, puis par date ; compte des ouverts', () => {
    const list = [
      comment({ id: 'r', resolved: true, createdAt: '2026-11-01T00:00:00Z' }),
      comment({ id: 'late', createdAt: '2026-11-03T00:00:00Z' }),
      comment({ id: 'early', createdAt: '2026-11-02T00:00:00Z' }),
    ]
    expect(sortComments(list).map((c) => c.id)).toEqual(['early', 'late', 'r'])
    expect(openCount(list)).toBe(2)
  })
})

describe('fichiers', () => {
  it('aperçu selon le type ou l’extension', () => {
    expect(previewKind('image/png')).toBe('image')
    expect(previewKind(null, 'maquette.JPG')).toBe('image')
    expect(previewKind('application/pdf')).toBe('pdf')
    expect(previewKind('', 'contrat.pdf')).toBe('pdf')
    expect(previewKind('application/zip', 'a.zip')).toBe('other')
  })

  it('refuse ce qui n’est ni image ni PDF, vide ou trop lourd', () => {
    expect(validateDeliverableFile({ name: 'a.png', type: 'image/png', size: 10 })).toBeNull()
    expect(validateDeliverableFile({ name: 'a.zip', type: 'application/zip', size: 10 })).toContain('image')
    expect(validateDeliverableFile({ name: 'a.png', type: 'image/png', size: 0 })).toContain('vide')
    expect(validateDeliverableFile({ name: 'a.pdf', type: 'application/pdf', size: 101 * 1024 * 1024 })).toContain('100 Mo')
  })

  it('chemin dans le dossier de l’organisation puis du projet, nom nettoyé', () => {
    expect(safeFileName('Maquette accueil été (V2).png')).toBe('Maquette-accueil-ete-V2-.png')
    expect(safeFileName('../../')).toBe('fichier')
    expect(deliverableStoragePath('org', 'proj', 'uuid', 'Logo final.svg')).toBe('org/proj/uuid-Logo-final.svg')
  })
})

describe('versions', () => {
  const versions = [
    { version: 1, status: 'changes_requested' as const },
    { version: 2, status: 'pending' as const },
  ]

  it('dernière version', () => {
    expect(latestVersion(versions)?.version).toBe(2)
    expect(latestVersion([])).toBeNull()
  })

  it('le client répond seulement sur la dernière version en attente', () => {
    expect(canDecide(versions[1]!, versions)).toBe(true)
    expect(canDecide({ version: 1, status: 'pending' }, versions)).toBe(false)
    expect(canDecide({ version: 2, status: 'approved' }, versions)).toBe(false)
  })
})
