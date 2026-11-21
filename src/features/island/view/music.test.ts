import { describe, expect, it } from 'vitest'
import type { IslandMusic } from '../types'
import {
  EQ,
  createEqualizer,
  eqBarStyle,
  eqKick,
  musicHasProgress,
  musicPosition,
  musicRatio,
  musicStyle,
  stepEqualizer,
  stillEqualizer,
} from './music'

const music = (over: Partial<IslandMusic> = {}): IslandMusic => ({
  title: 'Nuit blanche',
  artist: 'Lou',
  album: null,
  appName: 'Spotify',
  playing: true,
  positionMs: 30_000,
  durationMs: 200_000,
  positionAt: 1_000,
  artworkUrl: null,
  palette: null,
  ...over,
})

/** Hasard reproductible (suite congruentielle). */
function seeded(seed = 1): () => number {
  let x = seed
  return () => {
    x = (x * 1_103_515_245 + 12_345) % 2_147_483_648
    return x / 2_147_483_648
  }
}

describe('musicPosition', () => {
  it('avance en lecture, reste figée en pause, bornée à la durée', () => {
    expect(musicPosition(music(), 6_000)).toBe(35_000)
    expect(musicPosition(music({ playing: false }), 6_000)).toBe(30_000)
    expect(musicPosition(music(), 1_000_000)).toBe(200_000)
    expect(musicPosition(music({ positionMs: null }), 6_000)).toBeNull()
    expect(musicPosition(music({ durationMs: null }), 1_000_000)).toBe(30_000 + 999_000)
  })

  it('donne l’avancement de la barre', () => {
    expect(musicRatio(music(), 71_000)).toBeCloseTo(0.5)
    expect(musicRatio(music({ durationMs: null }), 71_000)).toBe(0)
  })

  it('montre la progression seulement avec la durée et la position', () => {
    expect(musicHasProgress(music())).toBe(true)
    expect(musicHasProgress(music({ durationMs: null }))).toBe(false)
    expect(musicHasProgress(music({ durationMs: 0 }))).toBe(false)
    expect(musicHasProgress(music({ positionMs: null }))).toBe(false)
    expect(musicHasProgress(null)).toBe(false)
  })
})

describe('musicStyle', () => {
  it('pose les couleurs de la pochette, rien sans palette', () => {
    expect(musicStyle({ start: 'rgb(1 2 3)', end: 'rgb(4 5 6)' })).toEqual({
      '--music-start': 'rgb(1 2 3)',
      '--music-end': 'rgb(4 5 6)',
    })
    expect(musicStyle(null)).toEqual({})
    expect(eqBarStyle(0)).toEqual({ '--eq-t': '0.000' })
    expect(eqBarStyle(EQ.bars - 1)).toEqual({ '--eq-t': '1.000' })
  })
})

describe('égaliseur', () => {
  function run(playing: boolean, seconds: number, eq = createEqualizer(), random = seeded()) {
    const frames: number[][] = []
    for (let i = 1; i <= seconds * 60; i++) frames.push([...stepEqualizer(eq, i / 60, 1 / 60, playing, random)])
    return { eq, frames }
  }

  it('reste entre la hauteur à plat et la pleine hauteur', () => {
    const { frames } = run(true, 5)
    for (const f of frames) for (const v of f) {
      expect(v).toBeGreaterThanOrEqual(EQ.flatScale)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('bouge en lecture, les basses plus amples que les aigus', () => {
    const { frames } = run(true, 8)
    const spread = (j: number) => {
      const values = frames.slice(60).map((f) => f[j] ?? 0)
      return Math.max(...values) - Math.min(...values)
    }
    expect(spread(0)).toBeGreaterThan(0.3)
    const mean = (j: number) => frames.slice(60).reduce((sum, f) => sum + (f[j] ?? 0), 0) / (frames.length - 60)
    expect(mean(0)).toBeGreaterThan(mean(EQ.bars - 1))
  })

  it('se met à plat en pause, en douceur', () => {
    const { eq } = run(true, 2)
    const before = [...eq.values]
    const first = [...stepEqualizer(eq, 2.02, 1 / 60, false)]
    // Pas de saut : la première image ne tombe pas d'un coup.
    first.forEach((v, j) => {
      if ((before[j] ?? 0) > EQ.flatScale + 0.1) expect(v).toBeGreaterThan(EQ.flatScale + 0.05)
    })
    const { frames } = run(false, 2, eq)
    for (const v of frames.at(-1) ?? []) expect(v).toBeCloseTo(EQ.flatScale, 2)
  })

  it('bat la mesure sur chaque temps', () => {
    expect(eqKick(0)).toBeCloseTo(1)
    expect(eqKick(60 / EQ.tempoBpm / 2)).toBeLessThan(0.1)
  })

  it('immobile sous réduction des animations : motif en lecture, à plat en pause', () => {
    expect(stillEqualizer(true)).toHaveLength(EQ.bars)
    expect(stillEqualizer(false).every((v) => v === EQ.flatScale)).toBe(true)
  })
})
