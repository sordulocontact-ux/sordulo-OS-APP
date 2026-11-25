import { describe, expect, it } from 'vitest'
import type { GoogleAccountConnection } from '../../lib/google'
import { GOOGLE_UNAVAILABLE_STATE, GOOGLE_WEB_STATE, describeGoogle, type GoogleContext } from './google'

const ROW: GoogleAccountConnection = {
  service: 'calendar',
  refreshToken: 'rt',
  account: 'maël@example.com',
  cursorAt: null,
  createdAt: '2026-11-25T10:00:00Z',
  updatedAt: '2026-11-25T10:00:00Z',
}

const desktop: GoogleContext = {
  service: 'calendar',
  desktop: true,
  loading: false,
  loadFailed: false,
  connection: null,
  configured: true,
  connecting: false,
  otherConnecting: false,
  disconnecting: false,
}
const web: GoogleContext = { ...desktop, desktop: false, configured: null }

describe('describeGoogle', () => {
  it('lecture en cours, puis erreur de lecture : Réessayer', () => {
    expect(describeGoogle({ ...desktop, loading: true }).action).toMatchObject({ kind: null, loading: true, disabled: true })
    const v = describeGoogle({ ...desktop, loadFailed: true })
    expect(v.badge).toEqual({ tone: 'warning', label: 'Erreur' })
    expect(v.action.kind).toBe('retry')
  })

  it('web non connecté : « Dans l’app de bureau », bouton désactivé', () => {
    const v = describeGoogle(web)
    expect(v.state).toBe(GOOGLE_WEB_STATE)
    expect(v.action).toMatchObject({ kind: null, disabled: true })
    expect(v.connected).toBe(false)
  })

  it('web connecté : on peut déconnecter', () => {
    const v = describeGoogle({ ...web, connection: ROW })
    expect(v.connected).toBe(true)
    expect(v.action.kind).toBe('disconnect')
  })

  it('app sans identifiants : indisponible dans cette version', () => {
    const v = describeGoogle({ ...desktop, configured: false })
    expect(v.state).toBe(GOOGLE_UNAVAILABLE_STATE)
    expect(v.action).toMatchObject({ kind: null, disabled: true })
  })

  it('non connecté : Connecter, désactivé si l’autre service attend', () => {
    const v = describeGoogle(desktop)
    expect(v.badge).toEqual({ tone: 'neutral', label: 'Non connecté' })
    expect(v.action).toMatchObject({ kind: 'connect', label: 'Connecter', disabled: false })
    expect(describeGoogle({ ...desktop, otherConnecting: true }).action.disabled).toBe(true)
  })

  it('connexion en cours : Annuler', () => {
    const v = describeGoogle({ ...desktop, connecting: true })
    expect(v.state).toBe('Autorisez l’accès dans votre navigateur…')
    expect(v.action).toMatchObject({ kind: 'cancel', label: 'Annuler', disabled: false })
  })

  it('connecté : adresse et Déconnecter', () => {
    const v = describeGoogle({ ...desktop, connection: ROW })
    expect(v.badge).toEqual({ tone: 'success', label: 'Connecté' })
    expect(v.state).toBe('Connecté : maël@example.com')
    expect(v.action).toMatchObject({ kind: 'disconnect', label: 'Déconnecter' })
    expect(v.connected).toBe(true)
    expect(describeGoogle({ ...desktop, connection: ROW, disconnecting: true }).action).toMatchObject({
      disabled: true,
      loading: true,
    })
  })

  it('accès perdu : À reconnecter, Reconnecter', () => {
    const v = describeGoogle({ ...desktop, connection: { ...ROW, refreshToken: null } })
    expect(v.badge).toEqual({ tone: 'warning', label: 'À reconnecter' })
    expect(v.state).toContain('maël@example.com')
    expect(v.action).toMatchObject({ kind: 'reconnect', label: 'Reconnecter' })
    expect(v.connected).toBe(false)
  })
})
