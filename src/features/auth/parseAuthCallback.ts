export type AuthCallback =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }

/**
 * Lit le lien de retour de Supabase reçu par l'app bureau (`sordulo://auth#access_token=…` en flux implicite,
 * `?code=…` en PKCE, ou `#error=…`). Renvoie null si l'URL ne contient rien d'exploitable.
 */
export function parseAuthCallback(url: string): AuthCallback | null {
  const hashIndex = url.indexOf('#')
  const queryIndex = url.indexOf('?')
  const query = queryIndex >= 0 ? url.slice(queryIndex + 1, hashIndex > queryIndex ? hashIndex : undefined) : ''
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : ''
  const params = new URLSearchParams(query)
  new URLSearchParams(hash).forEach((value, key) => params.set(key, value))

  const error = params.get('error_description') ?? params.get('error')
  if (error) return { kind: 'error', message: error }
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken }
  const code = params.get('code')
  if (code) return { kind: 'code', code }
  return null
}
