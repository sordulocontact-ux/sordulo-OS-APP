/**
 * Musique dans l'île : position de lecture, couleurs de la pochette posées en variables CSS, et égaliseur
 * façon iPhone. Sur Windows, quand l'analyse du vrai son arrive (MusicLevels, ticket « Île : vraies basses /
 * aigus et vrai rythme »), les barres suivent les vraies bandes et le battement les vrais temps ; sinon
 * (macOS, Spotify sur un autre appareil, analyse absente) l'égaliseur est simulé.
 * Pur (ni React ni DOM) : la boucle (loop.ts) écrit les valeurs dans le DOM.
 */
import type { CSSProperties } from 'react'
import { GARDEN } from '../garden/constants'
import type { IslandMusic, MusicLevels, MusicPalette } from '../types'

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
export function musicPosition(
  music: Pick<IslandMusic, 'playing' | 'positionMs' | 'durationMs' | 'positionAt'>,
  now: number,
): number | null {
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
/** Nombre de couleurs de la pochette réparties sur les barres de l'égaliseur (--music-c0 à --music-c3). */
export const EQ_COLORS = 4

export function musicStyle(palette: MusicPalette | null | undefined): CSSProperties {
  if (!palette) return {}
  const style: Record<string, string> = { '--music-start': palette.start, '--music-end': palette.end }
  // Couleurs de l'égaliseur : celles de la pochette, sinon start puis end répartis sur les groupes de barres.
  const colors = palette.colors?.length ? palette.colors : [palette.start, palette.end]
  for (let k = 0; k < EQ_COLORS; k++) {
    style[`--music-c${k}`] = colors[Math.floor((k * colors.length) / EQ_COLORS)] ?? palette.start
  }
  return style as CSSProperties
}

/** Dessin de l'égaliseur (unités SVG = px CSS) : barres de 2, espacées de 1, hautes de 14 (23 × 14 pour 8). */
export const EQ_BAR = { width: 2, gap: 1, height: 14 } as const

/**
 * Hauteur et haut d'une barre pour une échelle 0..1, centrée verticalement. Bouts entièrement arrondis
 * (rx = demi-largeur) : on change la hauteur au lieu d'un scaleY, qui écraserait l'arrondi. Jamais plus
 * courte que sa largeur, pour rester une pastille ronde à plat.
 */
export function eqBarGeometry(scale: number): { y: number; height: number } {
  const height = Math.max(EQ_BAR.width, Math.min(1, Math.max(0, scale)) * EQ_BAR.height)
  return { y: (EQ_BAR.height - height) / 2, height }
}

/**
 * Éclaircissement 0..1 d'une barre de l'égaliseur (variable CSS --eq-t) d'après sa hauteur : à plat, la couleur
 * de son groupe telle quelle ; pleine hauteur, éclaircie au maximum (--island-music-eq-lighten). Chaque barre est
 * d'une couleur unie, c'est la vague qui fait le dégradé (choix F de Sacha, 25/11).
 */
export function eqBarTone(scale: number): number {
  const t = (Math.min(1, Math.max(0, scale)) - EQ.flatScale) / (1 - EQ.flatScale)
  return Math.round(Math.min(1, Math.max(0, t)) * 1000) / 1000
}

/**
 * Style d'une barre : sa couleur (--eq-c), celle de la pochette qui revient à son groupe (des basses à gauche aux
 * aigus à droite, EQ_COLORS groupes), repli sur les tokens de la pochette par défaut ; et sa teinte de départ
 * (à plat). La boucle écrit ensuite --eq-t avec sa hauteur : plus la barre monte, plus elle s'éclaircit.
 */
export function eqBarStyle(index: number): CSSProperties {
  const group = Math.min(EQ_COLORS - 1, Math.floor((index * EQ_COLORS) / EQ.bars))
  const fallback = group < EQ_COLORS / 2 ? 'var(--island-music-cover-start)' : 'var(--island-music-cover-end)'
  const style: Record<string, string> = {
    '--eq-c': `var(--music-c${group}, ${fallback})`,
    '--eq-t': eqBarTone(EQ.flatScale).toFixed(3),
  }
  return style as CSSProperties
}

// ---------------------------------------------------------------------------
// Égaliseur façon iPhone
// ---------------------------------------------------------------------------

/**
 * Égaliseur : 8 barres, des basses (à gauche) aux aigus (à droite). Les basses bougent plus amples et plus
 * lentement et prennent un battement régulier (tempo), les aigus changent plus vite avec moins d'amplitude.
 * Chaque barre vise une hauteur tirée au hasard, l'atteint vite (attaque) et redescend plus doucement
 * (relâche), comme un vumètre. Valeurs : hauteur relative de la barre (voir eqBarGeometry), 1 = pleine hauteur.
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
  /**
   * Vrai son : lissage visuel léger (1/s), pour 60 images par seconde entre deux analyses (environ 30 par
   * seconde) : montée vive, descente un peu plus douce.
   */
  realAttack: 45,
  realRelease: 20,
  /** Vrai son : coup de pouce des basses sur chaque vrai temps (fraction de leur niveau). */
  realKick: 0.25,
  /** Sous ce niveau, toutes les bandes : silence (barres à plat, pas de hochement). */
  silence: 0.02,
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

/** Battement 0..1 à la phase `phase` d'un temps (0 = sur le temps) : un pic, qui décroît. */
export function eqKickAt(phase: number): number {
  return Math.exp(-(phase - Math.floor(phase)) * EQ.kickDecay)
}

/** Battement des basses 0..1 au temps `t` (s), tempo fixe (simulation) : un pic à chaque temps, qui décroît. */
export function eqKick(t: number): number {
  return eqKickAt((t * EQ.tempoBpm) / 60)
}

// ---------------------------------------------------------------------------
// Vrai son (analyse envoyée par Rust, Windows)
// ---------------------------------------------------------------------------

/**
 * Phase 0..1 du temps d'après le tempo du morceau (`tempoBpm`, Deezer) et sa position à `nowMs` : un temps
 * tous les 60 / BPM s depuis le début du morceau (le décalage du premier temps n'est pas connu : la vitesse
 * est juste, le coup peut tomber un peu à côté). null : en pause, tempo ou position inconnus.
 */
export function musicTempoPhase(
  music: Pick<IslandMusic, 'playing' | 'positionMs' | 'durationMs' | 'positionAt'> & { tempoBpm?: number | null },
  nowMs: number,
): number | null {
  const bpm = music.tempoBpm
  if (!music.playing || bpm == null || !(bpm > 0)) return null
  const position = musicPosition(music, nowMs)
  if (position === null) return null
  const beats = position / (60_000 / bpm)
  return beats - Math.floor(beats)
}

/** Silence : toutes les bandes à peu près nulles (même si le lecteur dit « en lecture »). */
export function musicIsSilent(levels: MusicLevels): boolean {
  return levels.bands.every((v) => !(v > EQ.silence))
}

/**
 * Phase 0..1 du vrai temps à l'instant `nowMs` (epoch ms) : 0 sur un temps détecté, puis avance au tempo
 * détecté (prolongée au-delà du dernier temps). null : pas de tempo stable (le tempo fixe s'applique).
 * Sans dernier temps connu, le tempo est juste mais la phase arbitraire.
 */
export function musicBeatPhase(levels: MusicLevels, nowMs: number): number | null {
  const period = levels.beatPeriodMs
  if (period === null || !(period > 0)) return null
  const p = (nowMs - (levels.lastBeatAt ?? 0)) / period
  return ((p % 1) + 1) % 1
}

/**
 * Avance l'égaliseur d'une image : `t` temps de la boucle (s), `dt` pas (s), `playing` faux = descente à plat.
 * `random` est injecté pour les tests. `beatPhase` : phase des temps d'après le tempo du morceau (Deezer) ;
 * null : tempo fixe. Modifie `state` et renvoie ses valeurs.
 */
export function stepEqualizer(
  state: EqualizerState,
  t: number,
  dt: number,
  playing: boolean,
  random: () => number = Math.random,
  beatPhase: number | null = null,
): readonly number[] {
  const step = Math.max(0, Math.min(EQ.maxDt, dt))
  const kick = playing ? (beatPhase === null ? eqKick(t) : eqKickAt(beatPhase)) : 0
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

/**
 * Avance l'égaliseur d'une image sur le vrai son : chaque barre suit sa bande (0..1, basses à gauche), de
 * flatScale (silence, bande sous EQ.silence) à 1, avec un lissage léger ; sur chaque temps (`beatPhase` : vrai
 * temps, sinon tempo du morceau, null sans l'un ni l'autre), les basses prennent un petit coup de pouce proportionnel à leur niveau (le silence reste à plat).
 * Modifie `state` et renvoie ses valeurs ; au retour à la simulation, de nouvelles cibles sont tirées tout de suite.
 */
export function stepEqualizerReal(
  state: EqualizerState,
  dt: number,
  bands: readonly number[],
  beatPhase: number | null,
): readonly number[] {
  const step = Math.max(0, Math.min(EQ.maxDt, dt))
  const kick = beatPhase === null ? 0 : eqKickAt(beatPhase)
  for (let j = 0; j < EQ.bars; j++) {
    const b = band(j)
    const raw = bands[j] ?? 0
    // Sous le seuil du silence : à plat ; au-dessus, la plage restante est étirée (pas de marche).
    const clamped = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0
    const level = Math.max(0, (clamped - EQ.silence) / (1 - EQ.silence))
    const boosted = Math.min(1, level * (1 + EQ.realKick * kick * Math.pow(1 - b, 1.5)))
    const goal = EQ.flatScale + (1 - EQ.flatScale) * boosted
    const value = state.values[j] ?? EQ.flatScale
    const rate = goal > value ? EQ.realAttack : EQ.realRelease
    const next = value + (goal - value) * (1 - Math.exp(-rate * step))
    state.values[j] = Math.max(EQ.flatScale, Math.min(1, next))
    state.targets[j] = goal
    state.nextAt[j] = 0
  }
  return state.values
}

/** Échelles immobiles (réduction des animations) : le motif du prototype en lecture, à plat en pause. */
export function stillEqualizer(playing: boolean): readonly number[] {
  return playing ? EQ.still : Array.from({ length: EQ.bars }, () => EQ.flatScale)
}
