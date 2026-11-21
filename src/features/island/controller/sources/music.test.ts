import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MusicCommand, MusicState } from '../../../../shared/desktop-contract'
import type { MusicPalette } from '../../types'
import { fakeEvent, flush, setupRuntime } from '../testUtils'
import { createMusicSource, MUSIC_ACTIVITY_ID, MUSIC_PAUSE_LINGER_MS, type MusicSourceDeps } from './music'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).buffer
const PALETTE: MusicPalette = { start: 'rgb(255, 120, 40)', end: 'rgb(255, 200, 90)' }

function track(fields: Partial<MusicState> = {}): MusicState {
  return {
    appId: 'Spotify.exe',
    appName: 'Spotify',
    title: 'Nuit blanche',
    artist: 'Ibé',
    album: 'Premier',
    playing: true,
    positionMs: 30_000,
    durationMs: 200_000,
    positionAt: 1_000_000,
    artworkId: null,
    ...fields,
  }
}

/** Promesse résolue ou rejetée à la main (réponses lentes, périmées). */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(initial: MusicState | null = null) {
  const music = fakeEvent<MusicState | null>()
  const artworks = new Map<string, ReturnType<typeof deferred<ArrayBuffer>>>()
  let urls = 0
  const deps = {
    getMusic: vi.fn(async () => initial),
    onMusic: music.subscribe,
    getMusicArtwork: vi.fn(({ artworkId }: { artworkId: string }) => {
      const pending = deferred<ArrayBuffer>()
      artworks.set(artworkId, pending)
      return pending.promise
    }),
    musicCommand: vi.fn(async (_args: { command: MusicCommand }) => {}),
    paletteFromImageUrl: vi.fn(async (_url: string): Promise<MusicPalette | null> => PALETTE),
    createObjectURL: vi.fn((_blob: Blob) => `blob:${++urls}`),
    revokeObjectURL: vi.fn((_url: string) => {}),
  } satisfies MusicSourceDeps
  const env = setupRuntime({ sources: [createMusicSource(deps)] })
  const view = () => env.runtime.view.get().music
  const shown = () => env.coordinator.getActivity(MUSIC_ACTIVITY_ID) !== null
  /** Répond à la demande de pochette `id`. */
  const answer = async (id: string, bytes: ArrayBuffer) => {
    artworks.get(id)?.resolve(bytes)
    await flush()
  }
  const fail = async (id: string, error: unknown) => {
    artworks.get(id)?.reject(error)
    await flush()
  }
  return { ...env, music, deps, view, shown, answer, fail }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('source « musique »', () => {
  it('lecture initiale en cours : activité music et données au rendu', async () => {
    const t = setup(track())
    await flush()
    expect(t.snap().primary).toMatchObject({ id: MUSIC_ACTIVITY_ID, kind: 'music' })
    expect(t.snap().state).toBe('music')
    expect(t.view()).toEqual({
      title: 'Nuit blanche',
      artist: 'Ibé',
      album: 'Premier',
      appName: 'Spotify',
      playing: true,
      positionMs: 30_000,
      durationMs: 200_000,
      positionAt: 1_000_000,
      artworkUrl: null,
      palette: null,
    })
  })

  it('un événement arrivé avant la lecture initiale l’emporte sur elle', async () => {
    const t = setup(track({ title: 'Ancien' }))
    t.music.emit(track({ title: 'Récent' }))
    await flush()
    expect(t.view()?.title).toBe('Récent')
  })

  it('un nouvel événement en lecture met à jour sans recréer l’activité', async () => {
    const t = setup()
    await flush()
    t.music.emit(track())
    const order = t.snap().primary?.order
    t.music.emit(track({ title: 'Suivant', positionMs: 0 }))
    expect(t.view()).toMatchObject({ title: 'Suivant', positionMs: 0 })
    expect(t.snap().primary?.order).toBe(order)
  })

  it('pause : gardée 10 s en pause, puis l’île se range', async () => {
    const t = setup(track())
    await flush()
    t.music.emit(track({ playing: false }))
    expect(t.shown()).toBe(true)
    expect(t.view()?.playing).toBe(false)
    t.clock.advance(MUSIC_PAUSE_LINGER_MS - 1)
    expect(t.shown()).toBe(true)
    t.clock.advance(1)
    expect(t.shown()).toBe(false)
    expect(t.view()).toBeNull()
    expect(t.snap().primary).toBeNull()

    // Toujours en pause : rien n'est montré tant que le morceau ne rejoue pas.
    t.music.emit(track({ playing: false, positionMs: 31_000 }))
    expect(t.shown()).toBe(false)
    expect(t.view()).toBeNull()
    expect(t.clock.pendingTimers).toBe(0)
    t.music.emit(track())
    expect(t.shown()).toBe(true)
    expect(t.view()?.playing).toBe(true)
  })

  it('reprise dans le délai : le minuteur est annulé', async () => {
    const t = setup(track())
    await flush()
    t.music.emit(track({ playing: false }))
    t.clock.advance(MUSIC_PAUSE_LINGER_MS / 2)
    t.music.emit(track())
    expect(t.view()?.playing).toBe(true)
    t.clock.advance(MUSIC_PAUSE_LINGER_MS * 2)
    expect(t.shown()).toBe(true)
    expect(t.view()?.playing).toBe(true)
  })

  it('des pauses répétées ne relancent pas le minuteur', async () => {
    const t = setup(track())
    await flush()
    t.music.emit(track({ playing: false }))
    t.clock.advance(6_000)
    t.music.emit(track({ playing: false, positionMs: 30_500 }))
    t.clock.advance(MUSIC_PAUSE_LINGER_MS - 6_000)
    expect(t.shown()).toBe(false)
    expect(t.view()).toBeNull()
  })

  it('morceau déjà en pause au démarrage : pas montré tant qu’il ne joue pas', async () => {
    const t = setup(track({ playing: false }))
    await flush()
    expect(t.shown()).toBe(false)
    expect(t.view()).toBeNull()
    t.music.emit(track())
    expect(t.shown()).toBe(true)
  })

  it('null : activité retirée et plus de musique au rendu', async () => {
    const t = setup(track())
    await flush()
    t.music.emit(null)
    expect(t.shown()).toBe(false)
    expect(t.view()).toBeNull()
    // Pendant la pause aussi, sans minuteur qui traîne.
    t.music.emit(track())
    t.music.emit(track({ playing: false }))
    t.music.emit(null)
    expect(t.shown()).toBe(false)
    expect(t.clock.pendingTimers).toBe(0)
  })

  it('garde l’île devant une session Claude non épinglée, qui passe dans background (pas de bulle)', async () => {
    const t = setup(track())
    await flush()
    t.coordinator.addActivity({ id: 'agent', kind: 'agent', sessionId: 's-1' })
    expect(t.snap().primary?.id).toBe(MUSIC_ACTIVITY_ID)
    expect(t.snap().secondary).toBeNull()
    expect(t.snap().background.map((a) => a.id)).toEqual(['agent'])
  })

  it('pochette : URL blob: au bon type, couleurs, puis nouvelle pochette et révocation de l’ancienne', async () => {
    const t = setup(track({ artworkId: 'a-1' }))
    await flush()
    expect(t.deps.getMusicArtwork).toHaveBeenCalledWith({ artworkId: 'a-1' })
    await t.answer('a-1', PNG)
    const blob = t.deps.createObjectURL.mock.calls[0]?.[0]
    expect(blob?.type).toBe('image/png')
    expect(blob?.size).toBe(PNG.byteLength)
    expect(t.deps.paletteFromImageUrl).toHaveBeenCalledWith('blob:1')
    expect(t.view()).toMatchObject({ artworkUrl: 'blob:1', palette: PALETTE })

    // Même pochette : pas de nouvelle demande.
    t.music.emit(track({ artworkId: 'a-1', positionMs: 40_000 }))
    expect(t.deps.getMusicArtwork).toHaveBeenCalledTimes(1)

    t.music.emit(track({ title: 'Suivant', artworkId: 'a-2' }))
    expect(t.deps.revokeObjectURL).toHaveBeenCalledWith('blob:1')
    expect(t.view()).toMatchObject({ title: 'Suivant', artworkUrl: null, palette: null })
    await t.answer('a-2', JPEG)
    expect(t.deps.createObjectURL.mock.calls[1]?.[0].type).toBe('image/jpeg')
    expect(t.view()).toMatchObject({ artworkUrl: 'blob:2', palette: PALETTE })

    // Plus de pochette.
    t.music.emit(track({ title: 'Sans pochette', artworkId: null }))
    expect(t.deps.revokeObjectURL).toHaveBeenCalledWith('blob:2')
    expect(t.view()).toMatchObject({ artworkUrl: null, palette: null })
  })

  it('pochette gardée pendant la pause et réutilisée à la reprise', async () => {
    const t = setup(track({ artworkId: 'a-1' }))
    await flush()
    await t.answer('a-1', PNG)
    t.music.emit(track({ artworkId: 'a-1', playing: false }))
    t.clock.advance(MUSIC_PAUSE_LINGER_MS)
    expect(t.view()).toBeNull()
    t.music.emit(track({ artworkId: 'a-1' }))
    expect(t.view()).toMatchObject({ artworkUrl: 'blob:1', palette: PALETTE })
    expect(t.deps.getMusicArtwork).toHaveBeenCalledTimes(1)
  })

  it('réponse de pochette périmée (morceau changé entre-temps) : ignorée', async () => {
    const t = setup(track({ artworkId: 'a-1' }))
    await flush()
    t.music.emit(track({ artworkId: 'a-2' }))
    await t.answer('a-1', PNG)
    expect(t.deps.createObjectURL).not.toHaveBeenCalled()
    expect(t.view()?.artworkUrl).toBeNull()
    await t.answer('a-2', JPEG)
    expect(t.deps.createObjectURL).toHaveBeenCalledTimes(1)
    expect(t.view()?.artworkUrl).toBe('blob:1')
  })

  it('couleurs arrivées après un changement de pochette : ignorées', async () => {
    const t = setup(track({ artworkId: 'a-1' }))
    const colors = deferred<MusicPalette | null>()
    t.deps.paletteFromImageUrl.mockImplementationOnce(() => colors.promise)
    await flush()
    await t.answer('a-1', PNG)
    t.music.emit(track({ artworkId: 'a-2' }))
    colors.resolve(PALETTE)
    await flush()
    expect(t.view()).toMatchObject({ artworkUrl: null, palette: null })
  })

  it('arrêt : URL révoquée, réponse tardive ignorée', async () => {
    const t = setup(track({ artworkId: 'a-1' }))
    await flush()
    await t.answer('a-1', PNG)
    t.music.emit(track({ artworkId: 'a-2' }))
    t.runtime.dispose()
    expect(t.deps.revokeObjectURL).toHaveBeenCalledWith('blob:1')
    await t.answer('a-2', JPEG)
    expect(t.deps.createObjectURL).toHaveBeenCalledTimes(1)
    expect(t.music.listeners).toBe(0)
  })

  it('arrêt avec une pochette affichée : révoquée', async () => {
    const t = setup(track({ artworkId: 'a-1' }))
    await flush()
    await t.answer('a-1', PNG)
    t.runtime.dispose()
    expect(t.deps.revokeObjectURL).toHaveBeenCalledWith('blob:1')
  })

  it('erreur de pochette : pas de pochette, avertissement « [île] »', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = setup(track({ artworkId: 'a-1' }))
    await flush()
    await t.fail('a-1', new Error('artwork changed'))
    expect(t.view()).toMatchObject({ artworkUrl: null, palette: null, title: 'Nuit blanche' })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[île\]/), expect.any(Error))
  })

  it('pochette sans couleurs (grise) : palette null', async () => {
    const t = setup(track({ artworkId: 'a-1' }))
    t.deps.paletteFromImageUrl.mockResolvedValueOnce(null)
    await flush()
    await t.answer('a-1', PNG)
    expect(t.view()).toMatchObject({ artworkUrl: 'blob:1', palette: null })
  })

  it('lecture / pause : l’île change tout de suite (position figée, minuteur), l’événement Rust fait foi', async () => {
    const t = setup(track())
    await flush()
    t.clock.advance(5_000)
    t.runtime.gestures.onMusicCommand('playPause')
    expect(t.deps.musicCommand).toHaveBeenCalledWith({ command: 'playPause' })
    expect(t.view()).toMatchObject({ playing: false, positionMs: 35_000, positionAt: t.clock.now() })
    await flush()

    // Reprise locale : minuteur annulé, la position repart de maintenant.
    t.clock.advance(3_000)
    t.runtime.gestures.onMusicCommand('playPause')
    expect(t.view()).toMatchObject({ playing: true, positionMs: 35_000, positionAt: t.clock.now() })
    t.clock.advance(MUSIC_PAUSE_LINGER_MS)
    expect(t.shown()).toBe(true)

    // Nouvelle pause locale, puis confirmation par Rust : son état remplace le local, minuteur non relancé.
    t.runtime.gestures.onMusicCommand('playPause')
    t.clock.advance(4_000)
    t.music.emit(track({ playing: false, positionMs: 45_100, positionAt: t.clock.now() }))
    expect(t.view()).toMatchObject({ playing: false, positionMs: 45_100 })
    t.clock.advance(MUSIC_PAUSE_LINGER_MS - 4_000)
    expect(t.shown()).toBe(false)
  })

  it('lecture / pause en échec : retour à l’état d’avant', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = setup(track())
    await flush()
    t.deps.musicCommand.mockRejectedValueOnce(new Error('no player'))
    t.runtime.gestures.onMusicCommand('playPause')
    expect(t.view()?.playing).toBe(false)
    await flush()
    expect(t.view()).toMatchObject({ playing: true, positionMs: 30_000, positionAt: 1_000_000 })
    t.clock.advance(MUSIC_PAUSE_LINGER_MS * 2)
    expect(t.shown()).toBe(true)
    // Sans musique montrée : rien à inverser.
    t.music.emit(null)
    t.runtime.gestures.onMusicCommand('playPause')
    expect(t.view()).toBeNull()
    expect(t.shown()).toBe(false)
  })

  it('geste du lecteur : commande envoyée, erreur avertie', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = setup(track())
    await flush()
    t.runtime.gestures.onMusicCommand('next')
    expect(t.deps.musicCommand).toHaveBeenCalledWith({ command: 'next' })
    t.deps.musicCommand.mockRejectedValueOnce(new Error('no player'))
    t.runtime.gestures.onMusicCommand('playPause')
    await flush()
    expect(t.deps.musicCommand).toHaveBeenLastCalledWith({ command: 'playPause' })
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[île\]/), expect.any(Error))
  })
})
