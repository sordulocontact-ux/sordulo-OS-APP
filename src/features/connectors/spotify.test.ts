import { describe, expect, it } from 'vitest'
import type { SpotifyStatus } from '../../shared/desktop-contract'
import { describeSpotify, spotifyClientId, SPOTIFY_MISSING_CLIENT_ID } from './spotify'

const base: SpotifyStatus = { connected: false, account: null, premium: false, needsReconnect: false, connecting: false }
const desktop = { desktop: true, clientId: 'abc' }

describe('describeSpotify', () => {
  it('sur le web : badge neutre, bouton désactivé avec explication', () => {
    const v = describeSpotify(null, { desktop: false, clientId: 'abc' })
    expect(v.badge).toEqual({ tone: 'neutral', label: 'App de bureau' })
    expect(v.action.disabled).toBe(true)
    expect(v.action.title).toBe('Se connecte depuis l’app de bureau')
    expect(v.connected).toBe(false)
  })

  it('non connecté : bouton Connecter, désactivé sans client ID', () => {
    expect(describeSpotify(base, desktop).action).toMatchObject({ kind: 'connect', label: 'Connecter', disabled: false })
    const v = describeSpotify(base, { desktop: true, clientId: '  ' })
    expect(v.action.disabled).toBe(true)
    expect(v.notice).toBe(SPOTIFY_MISSING_CLIENT_ID)
  })

  it('connexion en cours : chargement', () => {
    const v = describeSpotify({ ...base, connecting: true }, desktop)
    expect(v.state).toBe('Connexion dans le navigateur…')
    expect(v.action).toMatchObject({ loading: true, disabled: true })
  })

  it('connecté : compte, Premium ou gratuit, Déconnecter', () => {
    const v = describeSpotify({ ...base, connected: true, account: 'Maël', premium: true }, desktop)
    expect(v.badge.tone).toBe('success')
    expect(v.state).toBe('Connecté : Maël')
    expect(v.hint).toBe('Premium : commandes depuis l’île')
    expect(v.action.kind).toBe('disconnect')
    expect(v.connected).toBe(true)
    expect(describeSpotify({ ...base, connected: true, account: 'Maël' }, desktop).hint).toBe('Compte gratuit : affichage seulement')
  })

  it('à reconnecter : avertissement, pas compté comme connecté', () => {
    const v = describeSpotify({ ...base, connected: true, needsReconnect: true, account: 'Maël' }, desktop)
    expect(v.badge).toEqual({ tone: 'warning', label: 'À reconnecter' })
    expect(v.action).toMatchObject({ kind: 'reconnect', label: 'Reconnecter' })
    expect(v.connected).toBe(false)
  })

  it('nettoie le client ID', () => {
    expect(spotifyClientId(' x ')).toBe('x')
    expect(spotifyClientId(undefined)).toBe('')
  })
})
