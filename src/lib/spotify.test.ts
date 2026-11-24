import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const upsert = vi.fn()
const update = vi.fn()
vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      upsert: (...args: unknown[]) => upsert(...args),
      update: (...args: unknown[]) => update(...args),
    }),
  },
}))

const {
  cleanSpotifyClientId,
  desktopConnectionOf,
  isValidSpotifyClientId,
  normalizeSpotifyConnection,
  replaceSpotifyRefreshToken,
  saveSpotifyAuthorization,
  saveSpotifyClientId,
  spotifyConnectionState,
  withoutSecrets,
} = await import('./spotify')

const CLIENT = '0123456789abcdef0123456789abcdef'
const RAW = { client_id: CLIENT, refresh_token: 'rt-1', account: 'Maël', premium: true, updated_at: '2026-11-24T10:00:00Z' }

describe('Client ID', () => {
  it('même règle que la base : alphanumérique, 64 au plus', () => {
    expect(isValidSpotifyClientId(CLIENT)).toBe(true)
    expect(isValidSpotifyClientId('a'.repeat(64))).toBe(true)
    for (const bad of ['', 'a'.repeat(65), 'abc def', 'abc&scope=x', 'é']) expect(isValidSpotifyClientId(bad)).toBe(false)
  })
  it('espaces retirés autour', () => {
    expect(cleanSpotifyClientId(`  ${CLIENT}\n`)).toBe(CLIENT)
  })
})

describe('normalizeSpotifyConnection', () => {
  it('normalise la ligne', () => {
    expect(normalizeSpotifyConnection(RAW)).toEqual({
      clientId: CLIENT,
      refreshToken: 'rt-1',
      account: 'Maël',
      premium: true,
      updatedAt: '2026-11-24T10:00:00Z',
    })
  })
  it('jeton et compte absents : null ; Premium seulement si vrai', () => {
    expect(normalizeSpotifyConnection({ client_id: CLIENT, refresh_token: null, premium: 'oui' })).toMatchObject({
      refreshToken: null,
      account: null,
      premium: false,
      updatedAt: '',
    })
  })
  it('ligne absente ou Client ID invalide : null', () => {
    for (const bad of [null, undefined, 'x', [], {}, { ...RAW, client_id: 'a b' }, { ...RAW, client_id: '' }]) {
      expect(normalizeSpotifyConnection(bad)).toBeNull()
    }
  })
})

describe('état et connexion envoyée à l’app de bureau', () => {
  const row = normalizeSpotifyConnection(RAW)!
  it('état d’après la ligne', () => {
    expect(spotifyConnectionState(null)).toBe('none')
    expect(spotifyConnectionState(row)).toBe('connected')
    expect(spotifyConnectionState({ ...row, refreshToken: null, account: null })).toBe('clientId')
    expect(spotifyConnectionState({ ...row, refreshToken: null })).toBe('lost')
  })
  it('seulement avec un jeton', () => {
    expect(desktopConnectionOf(row)).toEqual({ clientId: CLIENT, refreshToken: 'rt-1', account: 'Maël', premium: true })
    expect(desktopConnectionOf({ ...row, refreshToken: null })).toBeNull()
    expect(desktopConnectionOf(null)).toBeNull()
  })
})

describe('withoutSecrets', () => {
  it('masque chaque jeton, ignore les vides', () => {
    expect(withoutSecrets('a rt-1 b rt-1 c rt-2', ['rt-1', null, '', 'rt-2'])).toBe('a <masqué> b <masqué> c <masqué>')
  })
})

describe('appels à Supabase (simulés)', () => {
  beforeEach(() => {
    rpc.mockReset()
    upsert.mockReset()
    update.mockReset()
  })

  it('remplacement du jeton : fonction SQL, jetons dans le corps, vrai si la ligne a changé', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    await expect(replaceSpotifyRefreshToken('ancien', 'nouveau')).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('spotify_replace_refresh_token', { previous: 'ancien', next: 'nouveau' })
    rpc.mockResolvedValue({ data: false, error: null })
    await expect(replaceSpotifyRefreshToken('ancien', null)).resolves.toBe(false)
  })

  it('erreur : jamais le jeton dans le message', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'refus pour ancien-SECRET → nouveau-SECRET' } })
    const error = await replaceSpotifyRefreshToken('ancien-SECRET', 'nouveau-SECRET').then(
      () => null,
      (e: unknown) => e as Error,
    )
    expect(error?.message).toContain('Jeton Spotify non enregistré')
    expect(error?.message).not.toContain('SECRET')
  })

  it('Client ID : vérifié et nettoyé avant l’envoi, upsert sur le compte', async () => {
    upsert.mockResolvedValue({ error: null })
    await saveSpotifyClientId(`  ${CLIENT} `)
    expect(upsert).toHaveBeenCalledWith({ user_id: 'u-1', client_id: CLIENT }, { onConflict: 'user_id' })
    await expect(saveSpotifyClientId('pas valide')).rejects.toThrow('Client ID Spotify invalide.')
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it('autorisation enregistrée : renvoie la ligne, erreur sans le jeton', async () => {
    const single = vi.fn().mockResolvedValue({ data: RAW, error: null })
    upsert.mockReturnValue({ select: () => ({ single }) })
    const auth = { refreshToken: 'rt-1', account: 'Maël', premium: true }
    await expect(saveSpotifyAuthorization(CLIENT, auth)).resolves.toMatchObject({ refreshToken: 'rt-1', account: 'Maël' })
    expect(upsert.mock.calls[0]?.[0]).toEqual({
      user_id: 'u-1',
      client_id: CLIENT,
      refresh_token: 'rt-1',
      account: 'Maël',
      premium: true,
    })
    single.mockResolvedValue({ data: null, error: { message: 'échec rt-1' } })
    await expect(saveSpotifyAuthorization(CLIENT, auth)).rejects.toThrow('Connexion Spotify non enregistrée : échec <masqué>')
  })
})
