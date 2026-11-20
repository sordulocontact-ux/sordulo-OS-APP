import { describe, expect, it } from 'vitest'
import { folderName, matchProject, normalizeName, UNKNOWN_PROJECT_NAME } from './projects'

const PROJECTS = [
  { id: 'p-1', name: 'App Ibé' },
  { id: 'p-2', name: 'Sordulo OS' },
]

describe('projet d’une session', () => {
  it('compare sans casse, accents, tirets ni espaces', () => {
    expect(normalizeName('Sordulo OS')).toBe(normalizeName('sordulo-OS'))
    expect(normalizeName('App Ibé')).toBe(normalizeName('app_ibe'))
  })

  it('projet Sordulo OS dont le nom correspond au dossier', () => {
    expect(matchProject('C:\\Users\\mael\\GitHub\\sordulo-OS', PROJECTS)).toEqual({ projectName: 'Sordulo OS', projectId: 'p-2' })
    expect(matchProject('/c/dev/app-ibe/', PROJECTS)).toEqual({ projectName: 'App Ibé', projectId: 'p-1' })
  })

  it('session lancée dans un sous-dossier du projet', () => {
    expect(matchProject('C:\\dev\\sordulo-os\\src-tauri', PROJECTS)).toEqual({ projectName: 'Sordulo OS', projectId: 'p-2' })
  })

  it('sinon le nom du dossier', () => {
    expect(matchProject('C:\\dev\\site-vitrine', PROJECTS)).toEqual({ projectName: 'site-vitrine', projectId: null })
    expect(matchProject(null, PROJECTS)).toEqual({ projectName: UNKNOWN_PROJECT_NAME, projectId: null })
    expect(folderName('C:\\dev\\x\\')).toBe('x')
  })
})
