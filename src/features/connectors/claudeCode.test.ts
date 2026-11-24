import { describe, expect, it } from 'vitest'
import { describeClaudeCode } from './claudeCode'

const desktop = { desktop: true, busy: false }

describe('describeClaudeCode', () => {
  it('sur le web : badge neutre, bouton désactivé avec explication', () => {
    const v = describeClaudeCode(null, { desktop: false, busy: false })
    expect(v.badge).toEqual({ tone: 'neutral', label: 'App de bureau' })
    expect(v.action).toMatchObject({ kind: null, disabled: true, title: 'Se connecte depuis l’app de bureau' })
    expect(v.connected).toBe(false)
  })

  it('non connecté (ou état pas encore lu) : bouton Connecter', () => {
    for (const c of [null, { connected: false, lastEventAt: null }]) {
      const v = describeClaudeCode(c, desktop)
      expect(v.badge.label).toBe('Non connecté')
      expect(v.action).toMatchObject({ kind: 'connect', label: 'Connecter', disabled: false })
      expect(v.connected).toBe(false)
    }
  })

  it('connecté : badge de succès, bouton Déconnecter', () => {
    const v = describeClaudeCode({ connected: true, lastEventAt: 1 }, desktop)
    expect(v.badge).toEqual({ tone: 'success', label: 'Connecté' })
    expect(v.action).toMatchObject({ kind: 'disconnect', label: 'Déconnecter' })
    expect(v.connected).toBe(true)
  })

  it('appel en cours : bouton en chargement et désactivé', () => {
    const v = describeClaudeCode({ connected: false, lastEventAt: null }, { desktop: true, busy: true })
    expect(v.state).toBe('Connexion…')
    expect(v.action).toMatchObject({ kind: null, loading: true, disabled: true })
  })
})
