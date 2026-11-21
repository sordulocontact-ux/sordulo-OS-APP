import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from '../../shared/desktop-contract'
import { errorMessage, isTooOld, viewForStatus } from './updateLogic'

const status = (state: UpdateStatus['state'], extra: Partial<UpdateStatus> = {}): UpdateStatus => ({
  current: '0.1.0',
  state,
  available: null,
  message: null,
  ...extra,
})

describe('isTooOld', () => {
  it('bloque une version strictement plus vieille', () => {
    expect(isTooOld('0.1.0', '0.2.0')).toBe(true)
    expect(isTooOld('0.9.9', '1.0.0')).toBe(true)
  })
  it('laisse passer une version égale ou plus récente', () => {
    expect(isTooOld('0.2.0', '0.2.0')).toBe(false)
    expect(isTooOld('1.0.0', '0.2.0')).toBe(false)
  })
  it('ne bloque jamais sur une donnée absente ou illisible', () => {
    expect(isTooOld(null, '0.2.0')).toBe(false)
    expect(isTooOld('0.1.0', undefined)).toBe(false)
    expect(isTooOld('', '0.2.0')).toBe(false)
    expect(isTooOld('abc', '0.2.0')).toBe(false)
  })
})

describe('viewForStatus', () => {
  it('attend tant que Rust n’a rien dit', () => {
    expect(viewForStatus(null, null).kind).toBe('working')
  })
  it('suit le téléchargement et l’installation', () => {
    const dl = viewForStatus(status('downloading', { available: '0.2.0' }), null)
    expect(dl).toEqual({
      kind: 'working',
      label: 'Téléchargement de la version 0.2.0…',
    })
    expect(viewForStatus(status('installing'), null).kind).toBe('working')
    expect(viewForStatus(status('ready'), null).kind).toBe('working')
  })
  it('affiche les erreurs de Rust et de la commande', () => {
    expect(viewForStatus(status('error', { message: 'Enregistrement en cours.' }), null)).toEqual({
      kind: 'error',
      message: 'Enregistrement en cours.',
    })
    expect(viewForStatus(status('downloading'), 'Réseau coupé.')).toEqual({
      kind: 'error',
      message: 'Réseau coupé.',
    })
  })
  it('signale l’absence de mise à jour et le mode désactivé comme des erreurs récupérables', () => {
    expect(viewForStatus(status('up-to-date'), null).kind).toBe('error')
    expect(viewForStatus(status('disabled'), null).kind).toBe('error')
  })
})

describe('errorMessage', () => {
  it('lit une chaîne, une Error, ou retombe sur un message par défaut', () => {
    expect(errorMessage('Appel en cours.')).toBe('Appel en cours.')
    expect(errorMessage(new Error('boom'))).toBe('boom')
    expect(errorMessage(null)).toMatch(/échoué/)
  })
})
