import { describe, expect, it } from 'vitest'
import type { IslandMusic, MusicLevels } from '../types'
import {
  EQ,
  EQ_BAR,
  eqBarGeometry,
  createEqualizer,
  eqBarStyle,
  eqKick,
  eqKickAt,
  musicBeatPhase,
  musicHasProgress,
  musicIsSilent,
  musicPosition,
  musicRatio,
  musicStyle,
  stepEqualizer,
  stepEqualizerReal,
  stillEqualizer,
} from './music'

const music = (over: Partial<IslandMusic> = {}): IslandMusic => ({
  canControl: true,
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

describe('barres de l’égaliseur', () => {
  it('centrées, bouts arrondis : jamais plus courtes que leur largeur, jamais plus hautes que l’égaliseur', () => {
    expect(eqBarGeometry(1)).toEqual({ y: 0, height: EQ_BAR.height })
    expect(eqBarGeometry(0.5)).toEqual({ y: EQ_BAR.height / 4, height: EQ_BAR.height / 2 })
    expect(eqBarGeometry(0)).toEqual({ y: (EQ_BAR.height - EQ_BAR.width) / 2, height: EQ_BAR.width })
    expect(eqBarGeometry(2).height).toBe(EQ_BAR.height)
    expect(eqBarGeometry(EQ.flatScale).height).toBeGreaterThanOrEqual(EQ_BAR.width)
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

describe('égaliseur sur le vrai son', () => {
  const levels = (bands: number[], fields: Partial<MusicLevels> = {}): MusicLevels => ({
    bands,
    beatPeriodMs: null,
    lastBeatAt: null,
    at: 0,
    ...fields,
  })
  /** `seconds` à 60 images par seconde sur les mêmes bandes. */
  function runReal(bands: readonly number[], seconds: number, eq = createEqualizer(), phase: number | null = null) {
    let values: readonly number[] = eq.values
    for (let i = 0; i < seconds * 60; i++) values = stepEqualizerReal(eq, 1 / 60, bands, phase)
    return { eq, values: [...values] }
  }

  it('chaque barre suit sa bande : la gauche suit les basses, la droite les aigus', () => {
    const bass = [1, 0.8, 0.5, 0.2, 0, 0, 0, 0]
    const { values } = runReal(bass, 0.5)
    expect(values[0]).toBeCloseTo(1, 2)
    expect(values[3]).toBeCloseTo(EQ.flatScale + (1 - EQ.flatScale) * ((0.2 - EQ.silence) / (1 - EQ.silence)), 2)
    expect(values[EQ.bars - 1]).toBeCloseTo(EQ.flatScale, 2)
    const treble = runReal([0, 0, 0, 0, 0, 0, 0.4, 1], 0.5).values
    expect(treble[0]).toBeCloseTo(EQ.flatScale, 2)
    expect(treble[EQ.bars - 1]).toBeCloseTo(1, 2)
    expect(treble[6]).toBeLessThan(treble[7] ?? 0)
  })

  it('silence (bandes ≈ 0) : à plat, même si le lecteur dit « en lecture »', () => {
    const { eq } = runReal([1, 1, 1, 1, 1, 1, 1, 1], 0.5)
    const { values } = runReal([0, 0.005, 0, 0, 0.01, 0, 0, 0], 1, eq)
    for (const v of values) expect(v).toBeCloseTo(EQ.flatScale, 2)
    expect(musicIsSilent(levels([0, 0.005, 0, 0, 0.01, 0, 0, 0]))).toBe(true)
    expect(musicIsSilent(levels([0, 0, 0, 0.3, 0, 0, 0, 0]))).toBe(false)
  })

  it('lissage léger : suit vite sans sauter d’un coup, reste entre plat et pleine hauteur', () => {
    const eq = createEqualizer()
    const first = stepEqualizerReal(eq, 1 / 60, [1, 1, 1, 1, 1, 1, 1, 1], null)[0] ?? 0
    expect(first).toBeGreaterThan(EQ.flatScale)
    expect(first).toBeLessThan(1)
    // En moins de 0,1 s, presque en haut (deux ou trois analyses à 30 par seconde).
    expect(runReal([1, 1, 1, 1, 1, 1, 1, 1], 0.1).values[0]).toBeGreaterThan(0.95)
    // Valeurs hors bornes ou absentes : bornées.
    for (const v of runReal([2, -1, Number.NaN], 0.5).values) {
      expect(v).toBeGreaterThanOrEqual(EQ.flatScale)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('battement sur les vrais temps : les basses montent un peu sur le temps, le silence reste à plat', () => {
    const mid = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    const onBeat = runReal(mid, 0.5, createEqualizer(), 0).values
    const offBeat = runReal(mid, 0.5, createEqualizer(), 0.5).values
    expect(onBeat[0]).toBeGreaterThan(offBeat[0] ?? 1)
    expect(onBeat[EQ.bars - 1]).toBeCloseTo(offBeat[EQ.bars - 1] ?? 0, 3)
    const silent = runReal([0, 0, 0, 0, 0, 0, 0, 0], 0.5, createEqualizer(), 0).values
    for (const v of silent) expect(v).toBeCloseTo(EQ.flatScale, 3)
    expect(eqKickAt(0)).toBeCloseTo(1)
    expect(eqKickAt(1.5)).toBeCloseTo(eqKickAt(0.5))
  })

  it('phase des vrais temps : 0 sur un temps détecté, prolongée au tempo ; null sans tempo', () => {
    const l = levels([0.5], { beatPeriodMs: 500, lastBeatAt: 10_000 })
    expect(musicBeatPhase(l, 10_000)).toBeCloseTo(0)
    expect(musicBeatPhase(l, 10_250)).toBeCloseTo(0.5)
    expect(musicBeatPhase(l, 11_125)).toBeCloseTo(0.25)
    expect(musicBeatPhase(levels([0.5]), 10_000)).toBeNull()
    expect(musicBeatPhase(levels([0.5], { beatPeriodMs: 0 }), 10_000)).toBeNull()
    // Tempo sans dernier temps : phase dans 0..1.
    const free = musicBeatPhase(levels([0.5], { beatPeriodMs: 480 }), 12_345)
    expect(free).not.toBeNull()
    expect(free ?? -1).toBeGreaterThanOrEqual(0)
    expect(free ?? 2).toBeLessThan(1)
  })

  it('retour à la simulation sans analyse : de nouvelles cibles tout de suite, sans saut', () => {
    const { eq, values } = runReal([0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6], 0.5)
    const next = [...stepEqualizer(eq, 10, 1 / 60, true, seeded(4))]
    expect(eq.nextAt.every((t) => t > 10)).toBe(true)
    next.forEach((v, j) => expect(Math.abs(v - (values[j] ?? 0))).toBeLessThan(0.2))
    // Puis la simulation bouge comme avant.
    const frames: number[] = []
    for (let i = 1; i <= 120; i++) frames.push(stepEqualizer(eq, 10 + i / 60, 1 / 60, true, seeded(5 + i))[0] ?? 0)
    expect(Math.max(...frames) - Math.min(...frames)).toBeGreaterThan(0.1)
  })
})
