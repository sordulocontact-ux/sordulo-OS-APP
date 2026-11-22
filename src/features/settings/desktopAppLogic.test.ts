import { describe, expect, it } from 'vitest'
import type { UpdateState, UpdateStatus } from '../../shared/desktop-contract'
import { desktopAppView } from './desktopAppLogic'

const status = (state: UpdateState, available: string | null = null, message: string | null = null): UpdateStatus => ({
  current: '0.2.3',
  state,
  available,
  message,
})

describe('desktopAppView', () => {
  it('à jour : version, « À jour. » et recherche possible', () => {
    const view = desktopAppView(status('up-to-date'), null)
    expect(view.version).toBe('Version 0.2.3')
    expect(view.status).toBe('À jour.')
    expect(view.tone).toBe('success')
    expect(view.action).toEqual({ kind: 'check', label: 'Rechercher une mise à jour', busy: false })
  })

  it('recherche et téléchargement : bouton occupé, version téléchargée affichée', () => {
    expect(desktopAppView(status('checking'), null).action?.busy).toBe(true)
    const downloading = desktopAppView(status('downloading', '0.2.4'), null)
    expect(downloading.status).toContain('0.2.4')
    expect(downloading.action?.busy).toBe(true)
  })

  it('prête : installer et redémarrer', () => {
    const view = desktopAppView(status('ready', '0.2.4'), null)
    expect(view.status).toContain('0.2.4')
    expect(view.action).toEqual({ kind: 'install', label: 'Installer et redémarrer', busy: false })
    expect(desktopAppView(status('installing', '0.2.4'), null).action).toEqual({
      kind: 'install',
      label: 'Installer et redémarrer',
      busy: true,
    })
  })

  it('échec : le message de Rust, et réessayer', () => {
    const view = desktopAppView(status('error', null, 'Serveur des mises à jour injoignable.'), null)
    expect(view.status).toBe('Serveur des mises à jour injoignable.')
    expect(view.tone).toBe('danger')
    expect(view.action?.label).toBe('Réessayer')
    // Erreur de la commande : prioritaire sur l'état
    expect(desktopAppView(status('up-to-date'), 'Un appel est en cours d’enregistrement.').status).toBe(
      'Un appel est en cours d’enregistrement.',
    )
  })

  it('dev : pas d’action, et pas d’erreur affichée', () => {
    const view = desktopAppView(status('disabled'), 'Les mises à jour ne concernent que la version installée.')
    expect(view.action).toBeNull()
    expect(view.tone).toBe('muted')
  })

  it('état pas encore connu : rien à afficher', () => {
    expect(desktopAppView(null, null)).toEqual({ version: '', status: '', tone: 'muted', action: null })
  })

  it('aucun tiret cadratin dans les textes', () => {
    const states: UpdateState[] = ['idle', 'checking', 'up-to-date', 'downloading', 'ready', 'installing', 'error', 'disabled']
    for (const state of states) expect(desktopAppView(status(state, '0.2.4'), null).status).not.toContain('—')
  })
})
