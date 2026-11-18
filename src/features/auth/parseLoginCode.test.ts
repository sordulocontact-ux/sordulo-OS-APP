import { describe, expect, it } from 'vitest'
import { parseLoginCode } from './parseLoginCode'

describe('parseLoginCode', () => {
  it('accepte un code à 6 chiffres', () => {
    expect(parseLoginCode(' 123456 ')).toEqual({ kind: 'code', token: '123456' })
  })
  it('accepte un code à 8 chiffres', () => {
    expect(parseLoginCode('12345678')).toEqual({ kind: 'code', token: '12345678' })
  })
  it('lit le paramètre token d\'une URL', () => {
    expect(
      parseLoginCode('https://abc.supabase.co/auth/v1/verify?token=XXXX&type=magiclink&redirect_to=http://localhost'),
    ).toEqual({ kind: 'link', tokenHash: 'XXXX', type: 'magiclink' })
  })
  it('lit token_hash et le type signup', () => {
    expect(parseLoginCode('https://app.test/?token_hash=HASH&type=signup')).toEqual({
      kind: 'link',
      tokenHash: 'HASH',
      type: 'signup',
    })
  })
  it('utilise magiclink par défaut', () => {
    expect(parseLoginCode('https://x.co/verify?token=T')).toEqual({ kind: 'link', tokenHash: 'T', type: 'magiclink' })
  })
  it('refuse un texte invalide', () => {
    expect(parseLoginCode('')).toBeNull()
    expect(parseLoginCode('abc')).toBeNull()
    expect(parseLoginCode('12345')).toBeNull()
    expect(parseLoginCode('https://x.co/verify')).toBeNull()
  })
})
