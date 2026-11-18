import { describe, expect, it } from 'vitest'
import { parseAuthCallback } from './parseAuthCallback'

describe('parseAuthCallback', () => {
  it('lit les jetons du flux implicite (fragment)', () => {
    expect(
      parseAuthCallback('sordulo://auth#access_token=AT&expires_in=3600&refresh_token=RT&token_type=bearer&type=magiclink'),
    ).toEqual({ kind: 'tokens', accessToken: 'AT', refreshToken: 'RT' })
  })
  it('lit le code PKCE (query)', () => {
    expect(parseAuthCallback('sordulo://auth?code=C0DE')).toEqual({ kind: 'code', code: 'C0DE' })
  })
  it('remonte une erreur (lien expiré)', () => {
    expect(
      parseAuthCallback('sordulo://auth#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'),
    ).toEqual({ kind: 'error', message: 'Email link is invalid or has expired' })
  })
  it('ignore une URL sans rien', () => {
    expect(parseAuthCallback('sordulo://auth')).toBeNull()
    expect(parseAuthCallback('sordulo://auth#access_token=AT')).toBeNull()
  })
})
