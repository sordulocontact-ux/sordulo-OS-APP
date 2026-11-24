import { describe, expect, it } from 'vitest'
import type { SpotifyAccountConnection } from '../../lib/spotify'
import { SPOTIFY_WEB_NOTICE, describeSpotify, type SpotifyContext } from './spotify'

const ROW: SpotifyAccountConnection = {
  clientId: '0123456789abcdef0123456789abcdef',
  refreshToken: 'rt',
  account: 'Maël',
  premium: true,
  updatedAt: '2026-11-24T10:00:00Z',
}

const desktop: SpotifyContext = {
  desktop: true,
  loading: false,
  loadFailed: false,
  connection: null,
  connecting: false,
  disconnecting: false,
}
const web: SpotifyContext = { ...desktop, desktop: false }

describe('describeSpotify', () => {
  it('lecture en cours puis erreur de lecture : Réessayer', () => {
    expect(describeSpotify({ ...desktop, loading: true }).action).toMatchObject({ kind: null, loading: true, disabled: true })
    const v = describeSpotify({ ...desktop, loadFailed: true })
    expect(v.badge).toEqual({ tone: 'warning', label: 'Erreur' })
    expect(v.action.kind).toBe('retry')
  })

  it('pas de ligne : Connecter (ouvre la fenêtre du Client ID), sur le web aussi', () => {
    const v = describeSpotify(desktop)
    expect(v.badge).toEqual({ tone: 'neutral', label: 'Non connecté' })
    expect(v.action).toMatchObject({ kind: 'connect', label: 'Connecter', disabled: false })
    expect(v.notice).toBeUndefined()
    const w = describeSpotify(web)
    expect(w.action).toMatchObject({ kind: 'connect', disabled: false })
    expect(w.notice).toBe(SPOTIFY_WEB_NOTICE)
  })

  it('Client ID seul : à connecter (bureau) ou à modifier (web)', () => {
    const row = { ...ROW, refreshToken: null, account: null }
    expect(describeSpotify({ ...desktop, connection: row })).toMatchObject({
      state: 'Client ID enregistré : connectez le compte Spotify.',
      action: { kind: 'connect', label: 'Connecter' },
      connected: false,
    })
    expect(describeSpotify({ ...web, connection: row }).action.label).toBe('Modifier le Client ID')
  })

  it('autorisation dans le navigateur : chargement (bureau seulement)', () => {
    const v = describeSpotify({ ...desktop, connecting: true, connection: ROW })
    expect(v.state).toBe('Connexion dans le navigateur…')
    expect(v.action).toMatchObject({ kind: null, loading: true, disabled: true })
    expect(describeSpotify({ ...web, connecting: true, connection: ROW }).connected).toBe(true)
  })

  it('connecté : compte, Premium ou gratuit, Déconnecter (web compris)', () => {
    const v = describeSpotify({ ...desktop, connection: ROW })
    expect(v.badge.tone).toBe('success')
    expect(v.state).toBe('Connecté : Maël')
    expect(v.hint).toBe('Premium : commandes depuis l’île')
    expect(v.action.kind).toBe('disconnect')
    expect(v.connected).toBe(true)
    expect(describeSpotify({ ...desktop, connection: { ...ROW, premium: false } }).hint).toBe('Compte gratuit : affichage seulement')
    expect(describeSpotify({ ...web, connection: ROW }).action.kind).toBe('disconnect')
    expect(describeSpotify({ ...desktop, connection: ROW, disconnecting: true }).action).toMatchObject({ loading: true, disabled: true })
  })

  it('accès perdu (compte gardé, plus de jeton) : À reconnecter, pas compté comme connecté', () => {
    const v = describeSpotify({ ...desktop, connection: { ...ROW, refreshToken: null } })
    expect(v.badge).toEqual({ tone: 'warning', label: 'À reconnecter' })
    expect(v.state).toBe('L’accès au compte Spotify Maël a été perdu : reconnectez-le.')
    expect(v.action).toMatchObject({ kind: 'reconnect', label: 'Reconnecter' })
    expect(v.connected).toBe(false)
  })

  it('aucun texte ne contient le jeton', () => {
    const secret = { ...ROW, refreshToken: 'SECRET-TOKEN' }
    for (const ctx of [desktop, web]) expect(JSON.stringify(describeSpotify({ ...ctx, connection: secret }))).not.toContain('SECRET')
  })
})
