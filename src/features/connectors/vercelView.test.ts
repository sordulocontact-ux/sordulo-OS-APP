import { describe, expect, it } from 'vitest'
import { describeVercel } from './vercelView'

const base = { loading: false, loadFailed: false, connected: false, account: null, disconnecting: false }

describe('vue du connecteur Vercel', () => {
  it('non connecté : propose de connecter', () => {
    const v = describeVercel(base)
    expect(v.connected).toBe(false)
    expect(v.action).toMatchObject({ kind: 'connect', label: 'Connecter', disabled: false, loading: false })
  })
  it('chargement : bouton en attente', () => {
    expect(describeVercel({ ...base, loading: true }).action).toMatchObject({ loading: true, disabled: true })
  })
  it('erreur de lecture : réessayer, jamais compté connecté', () => {
    const v = describeVercel({ ...base, loadFailed: true })
    expect(v.action.kind).toBe('retry')
    expect(v.connected).toBe(false)
  })
  it('connecté : nom du compte et déconnexion', () => {
    const v = describeVercel({ ...base, connected: true, account: 'sordulo' })
    expect(v.state).toBe('Connecté : sordulo')
    expect(v.connected).toBe(true)
    expect(v.action).toMatchObject({ kind: 'disconnect', label: 'Déconnecter' })
    expect(describeVercel({ ...base, connected: true, account: null }).state).toBe('Connecté')
    expect(describeVercel({ ...base, connected: true, disconnecting: true }).action.loading).toBe(true)
  })
})
