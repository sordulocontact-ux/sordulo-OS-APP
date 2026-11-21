/**
 * Musique dans l'île : position de lecture, couleurs de la pochette posées en variables CSS, et égaliseur
 * animé façon iPhone (pas d'analyse du son : décision du ticket « Île : réagir à la musique écoutée »).
 * Pur (ni React ni DOM) : la boucle (loop.ts) écrit les valeurs dans le DOM.
 */
import type { CSSProperties } from 'react'
import { GARDEN } from '../garden/constants'
import type { IslandMusic, MusicPalette } from '../types'

// ---------------------------------------------------------------------------
// Position et progression
// ---------------------------------------------------------------------------

/** La barre de progression s'affiche : le lecteur donne la durée et la position. */
export function musicHasProgress(music: IslandMusic | null | undefined): boolean {
  return !!music && music.durationMs !== null && music.durationMs > 0 && music.positionMs !== null
}

/**
 * Position affichée (ms) à l'instant `now` (epoch ms) : en lecture, elle avance depuis `positionAt` ;
 * bornée à la durée quand elle est connue. null : le lecteur ne donne pas la position.
 */
export function musicPosition(music: IslandMusic, now: number): number | null {
  if (music.positionMs === null) return null
  const position = music.playing ? music.positionMs + Math.max(0, now - music.positionAt) : music.positionMs
  const max = music.durationMs !== null && music.durationMs > 0 ? music.durationMs : Infinity
  return Math.max(0, Math.min(max, position))
}

/** Avancement 0..1 de la barre de progression ; 0 sans durée ni position. */
export function musicRatio(music: IslandMusic, now: number): number {
  const position = musicPosition(music, now)
  if (position === null || music.durationMs === null || music.durationMs <= 0) return 0
  return Math.max(0, Math.min(1, position / music.durationMs))
}

// ---------------------------------------------------------------------------
// Couleurs de la pochette
// ---------------------------------------------------------------------------

/**
 * Variables CSS des couleurs de la pochette (données dynamiques, pas des valeurs de style) : le CSS module
 * les lit avec un repli sur les tokens --island-music*. Sans palette : aucune variable, les tokens s'appliquent.
 */
export function musicStyle(palette: MusicPalette | null | undefined): CSSProperties {
  if (!palette) return {}
  const style: Record<string, string> = { '--music-start': palette.start, '--music-end': palette.end }
  return style as CSSProperties
}

/** Position 0..1 d'une barre dans le dégradé horizontal de l'égaliseur (variable CSS --eq-t). */
export function eqBarStyle(index: number): CSSProperties {
  const style: Record<string, string> = { '--eq-t': (EQ.bars > 1 ? index / (EQ.bars - 1) : 0).toFixed(3) }
  return style as CSSProperties
}

// ---------------------------------------------------------------------------
// Égaliseur façon iPhone
// ---------------------------------------------------------------------------

/**
 * Égaliseur : 8 barres, des basses (à gauche) aux aigus (à droite). Les basses bougent plus amples et plus
 * lentement et prennent un battement régulier (tempo), les aigus changent plus vite avec moins d'amplitude.
 * Chaque barre vise une hauteur tirée au hasard, l'atteint vite (attaque) et redescend plus doucement
 * (relâche), comme un vumètre. Valeurs : échelle verticale de la barre (scaleY), 1 = pleine hauteur.
 */
export const EQ = {
  bars: 8,
  /** Hauteur à plat en pause (fraction de la barre de 14 px : 2,5 px environ). */
  flatScale: 0.18,
  /** Hauteur minimale en lecture. */
  minScale: 0.24,
  /** Amplitude des basses et des aigus (fraction de ce qui reste au-dessus de minScale). */
  bassEnergy: 0.95,
  trebleEnergy: 0.62,
  /** Durée entre deux nouvelles cibles (s) : basses lentes, aigus vifs, ± 30 % au hasard. */
  bassHold: 0.26,
  trebleHold: 0.08,
  holdJitter: 0.3,
  /** Vitesse d'approche de la cible (1/s) : montée (attaque) et descente (relâche). */
  bassAttack: 14,
  trebleAttack: 30,
  bassRelease: 5,
  trebleRelease: 11,
  /** Descente à plat à la pause, et remontée à la reprise. */
  flatRate: 6,
  /** Battement des basses (tempo d'un morceau courant) et sa force. */
  /** Même tempo que le hochement de tête des Claude (GARDEN.musicTempoBpm). */
  tempoBpm: GARDEN.musicTempoBpm,
  kick: 0.4,
  /** Décroissance du battement après chaque temps. */
  kickDecay: 7,
  /** Pas maximal d'une image (s) : au-delà (onglet en arrière-plan), on plafonne. */
  maxDt: 0.05,
  /** Motif immobile (réduction des animations), d'après eqBase du prototype (hauteurs / 14 px). */
  still: [12 / 14, 1, 10 / 14, 6 / 14, 1, 8 / 14, 6 / 14, 1],
} as const

export interface EqualizerState {
  /** Échelle affichée de chaque barre. */
  values: number[]
  /** Cible de chaque barre. */
  targets: number[]
  /** Prochain tirage de cible (s, temps de la boucle). */
  nextAt: number[]
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const band = (index: number) => (EQ.bars > 1 ? index / (EQ.bars - 1) : 0)

/** Égaliseur à plat (au montage, ou en pause). */
export function createEqualizer(): EqualizerState {
  return {
    values: Array.from({ length: EQ.bars }, () => EQ.flatScale),
    targets: Array.from({ length: EQ.bars }, () => EQ.flatScale),
    nextAt: Array.from({ length: EQ.bars }, () => 0),
  }
}

/** Battement des basses 0..1 au temps `t` (s) : un pic à chaque temps, qui décroît. */
export function eqKick(t: number): number {
  const beat = (t * EQ.tempoBpm) / 60
  return Math.exp(-(beat - Math.floor(beat)) * EQ.kickDecay)
}

/**
 * Avance l'égaliseur d'une image : `t` temps de la boucle (s), `dt` pas (s), `playing` faux = descente à plat.
 * `random` est injecté pour les tests. Modifie `state` et renvoie ses valeurs.
 */
export function stepEqualizer(
  state: EqualizerState,
  t: number,
  dt: number,
  playing: boolean,
  random: () => number = Math.random,
): readonly number[] {
  const step = Math.max(0, Math.min(EQ.maxDt, dt))
  const kick = playing ? eqKick(t) : 0
  for (let j = 0; j < EQ.bars; j++) {
    const b = band(j)
    const value = state.values[j] ?? EQ.flatScale
    let goal: number
    let rate: number
    if (playing) {
      if (t >= (state.nextAt[j] ?? 0)) {
        const energy = lerp(EQ.bassEnergy, EQ.trebleEnergy, b)
        state.targets[j] = EQ.minScale + (1 - EQ.minScale) * energy * (0.3 + 0.7 * random())
        const hold = lerp(EQ.bassHold, EQ.trebleHold, b)
        state.nextAt[j] = t + hold * (1 - EQ.holdJitter + 2 * EQ.holdJitter * random())
      }
      // Le battement pousse surtout les basses.
      goal = Math.min(1, (state.targets[j] ?? EQ.minScale) + EQ.kick * kick * Math.pow(1 - b, 1.5))
      rate = goal > value ? lerp(EQ.bassAttack, EQ.trebleAttack, b) : lerp(EQ.bassRelease, EQ.trebleRelease, b)
    } else {
      goal = EQ.flatScale
      rate = EQ.flatRate
      state.targets[j] = EQ.flatScale
      state.nextAt[j] = 0
    }
    const next = value + (goal - value) * (1 - Math.exp(-rate * step))
    state.values[j] = Math.max(EQ.flatScale, Math.min(1, next))
  }
  return state.values
}

/** Échelles immobiles (réduction des animations) : le motif du prototype en lecture, à plat en pause. */
export function stillEqualizer(playing: boolean): readonly number[] {
  return playing ? EQ.still : Array.from({ length: EQ.bars }, () => EQ.flatScale)
}
