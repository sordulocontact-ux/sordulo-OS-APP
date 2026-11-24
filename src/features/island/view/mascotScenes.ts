/**
 * Scènes du Claude de l'île (demande de Maël : « on voit qu'il fouille dans les dossiers, qu'il réfléchit »).
 * Logique pure : choix de la scène et images clés, tirées au hasard. ClaudeMascot les joue (API Web Animations).
 *
 * Trois familles :
 * - **Activité** (session au travail, selon l'outil en cours, `ClaudeActivity`) : lit une feuille, fouille dans
 *   un dossier, écrit au crayon, tape une commande (attend en tapant du pied si elle dure), cherche à la loupe,
 *   réfléchit (bulle de pensée), lance un sous-agent (un mini Claude part en courant).
 * - **Variation** glissée de temps en temps entre deux scènes d'activité : s'étire, bâille (session longue), se
 *   gratte la tête, se retourne, trébuche, s'essuie le front (commande longue), ou un des gestes de mascot.ts.
 * - **Moment** : réveil en sursaut (début du travail), danse avec ✓ et étincelles (fin), recul avec « ? »
 *   (erreur, refus), et en boucle pendant une demande d'autorisation : il te regarde, tape du pied, fait signe.
 *
 * Unités : le Claude est dessiné sur une grille de 16 × 16 cases (6,25 % de l'icône). Les positions des scènes
 * sont en cases, converties ici en % de la pièce animée (une translation CSS en % suit la taille de l'élément).
 * Les pièces et leur place au repos : ClaudeMascot.tsx et ClaudeMascot.module.css.
 */
import type { ClaudeActivity, ClaudeSessionStatus } from '../types'
import { IDLE_WEIGHTS, WORKING_WEIGHTS, between, gestureAnimation, pickGesture, type MascotGesture, type Range } from './mascot'

/** Pièces animées. `lids` : les deux paupières (animées en hauteur, pas en transformation). */
export type MascotPart =
  | 'figure'
  | 'upper'
  | 'face'
  | 'lids'
  | 'mouth'
  | 'armL'
  | 'armR'
  | 'leg4'
  | 'paper'
  | 'lens'
  | 'think1'
  | 'think2'
  | 'think3'
  | 'bubbleDone'
  | 'bubbleErr'
  | 'sweat'
  | 'spark0'
  | 'spark1'
  | 'spark2'
  | 'spark3'
  | 'spark4'
  | 'spark5'
  | 'mini'

/** Accessoire affiché pendant la scène (attribut `data-prop` de ClaudeMascot). */
export type MascotProp = 'paper' | 'folder' | 'pencil' | 'keyboard' | 'lens' | 'thought'

export interface MascotTrack {
  part: MascotPart
  keyframes: Keyframe[]
  duration: number
  delay?: number
  easing?: string
}

export interface MascotScene {
  name: string
  family: 'activity' | 'variation' | 'moment' | 'idle'
  prop: MascotProp | null
  tracks: MascotTrack[]
  /** Fin de la dernière piste (ms). */
  duration: number
}

export type MascotMoment = 'start' | 'done' | 'error'

/** Accessoire de chaque activité (aussi montré seul, immobile, sous prefers-reduced-motion). */
export const ACTIVITY_PROP: Readonly<Record<ClaudeActivity, MascotProp | null>> = {
  read: 'paper',
  search: 'folder',
  write: 'pencil',
  command: 'keyboard',
  web: 'lens',
  think: 'thought',
  subagent: null,
}

export const SCENES = {
  /** Chance qu'une scène d'activité laisse la place à une variation (jamais deux variations de suite). */
  variationChance: 0.22,
  /** Commande en cours depuis plus longtemps : il attend en tapant du pied, s'essuie le front. */
  longCommandMs: 7000,
  /** Session au travail depuis plus longtemps : il bâille, s'essuie le front. */
  yawnAfterMs: 3 * 60_000,
  wipeAfterMs: 5 * 60_000,
  /** Pause entre deux scènes au travail ; au repos, délai de mascot.ts (MASCOT.next.idle). */
  gap: [150, 500] as Range,
  durations: {
    read: [2400, 3000] as Range,
    search: [2600, 3200] as Range,
    write: [2200, 2800] as Range,
    type: [2000, 2600] as Range,
    tapFoot: [1800, 2300] as Range,
    web: [2400, 3000] as Range,
    think: [2200, 2900] as Range,
    subagent: 2000,
    watch: [1800, 2400] as Range,
    stretch: 1400,
    yawn: 1800,
    scratch: 1300,
    turnBack: 1600,
    trip: 1000,
    wipe: 1500,
    start: 1100,
    done: 2400,
    error: 2000,
    waiting: [2000, 2600] as Range,
  },
} as const

/** Poids des variations ; `gesture` : un des gestes de mascot.ts (saut, penché, pas de côté, regard…). */
export const VARIATION_WEIGHTS = {
  gesture: 3,
  stretch: 2,
  scratch: 2,
  turnBack: 1.2,
  trip: 0.8,
  yawn: 1.5,
  wipe: 2,
} as const

export type MascotVariation = keyof typeof VARIATION_WEIGHTS

// ---------------------------------------------------------------------------
// Images clés
// ---------------------------------------------------------------------------

/** Taille des pièces en cases (largeur, hauteur) : les translations en cases deviennent des % de la pièce. */
const PART_CELLS: Partial<Record<MascotPart, readonly [number, number]>> = {
  armL: [2, 2],
  armR: [2, 2],
  leg4: [1, 3],
  mouth: [2, 1],
  paper: [8, 6],
  lens: [9, 9],
  think1: [1, 1],
  think2: [1, 1],
  think3: [2, 2],
  bubbleDone: [7, 8],
  bubbleErr: [7, 8],
  sweat: [1, 2],
  spark0: [1, 1],
  spark1: [1, 1],
  spark2: [1, 1],
  spark3: [1, 1],
  spark4: [1, 1],
  spark5: [1, 1],
}

const SPARKS: readonly MascotPart[] = ['spark0', 'spark1', 'spark2', 'spark3', 'spark4', 'spark5']

/** Pose d'une pièce : déplacement en cases, rotation (degrés), échelle, opacité, moment (0 à 1). */
interface Pose {
  at?: number
  x?: number
  y?: number
  r?: number
  sx?: number
  sy?: number
  o?: number
}

const num = (n: number) => String(Math.round(n * 100) / 100)

function transformOf(part: MascotPart, p: Pose): string {
  const [w, h] = PART_CELLS[part] ?? [16, 16]
  const x = ((p.x ?? 0) / w) * 100
  const y = ((p.y ?? 0) / h) * 100
  return `translate(${num(x)}%, ${num(y)}%) rotate(${num(p.r ?? 0)}deg) scale(${num(p.sx ?? 1)}, ${num(p.sy ?? 1)})`
}

/** Même forme de transformation à chaque image (translate, rotate, scale) : interpolation propre. */
export const REST_TRANSFORM = 'translate(0%, 0%) rotate(0deg) scale(1, 1)'

function track(part: MascotPart, duration: number, poses: Pose[], options: Partial<MascotTrack> = {}): MascotTrack {
  const keyframes = poses.map((p): Keyframe => {
    const frame: Keyframe = { transform: transformOf(part, p) }
    if (p.o !== undefined) frame.opacity = p.o
    if (p.at !== undefined) frame.offset = p.at
    return frame
  })
  return { part, duration, keyframes, easing: 'ease-in-out', ...options }
}

/** Paupières : 0 ouvertes, 1 fermées (hauteur de l'œil, deux cases). */
function lids(duration: number, frames: ReadonlyArray<readonly [number, number]>): MascotTrack {
  return {
    part: 'lids',
    duration,
    easing: 'linear',
    keyframes: frames.map(([at, closed]) => ({ offset: at, height: `${num(closed * 12.5)}%` })),
  }
}

/** Pièce tenue d'un moment à l'autre (de `from` à `to`), avec une entrée et une sortie de `ease`. */
function hold(part: MascotPart, duration: number, pose: Pose, from = 0.08, to = 0.9, ease = 0.08): MascotTrack {
  return track(part, duration, [
    { at: 0 },
    { ...pose, at: from },
    { ...pose, at: to },
    { at: Math.min(1, to + ease) },
    { at: 1 },
  ])
}

/** Bulle (✓ ou ?) qui apparaît d'un coup, reste, puis s'efface. */
function popBubble(part: 'bubbleDone' | 'bubbleErr', duration: number, from: number, to: number): MascotTrack {
  return track(
    part,
    duration,
    [
      { at: 0, o: 0, sx: 0.4, sy: 0.4 },
      { at: from, o: 0, sx: 0.4, sy: 0.4 },
      { at: from + 0.06, o: 1, sx: 1.15, sy: 1.15 },
      { at: from + 0.12, o: 1 },
      { at: to, o: 1 },
      { at: 1, o: 0, y: -1 },
    ],
    { easing: 'ease-out' },
  )
}

/** Gerbe d'étincelles : partent du point (x, y) (en cases depuis leur place, le centre de la tête). */
function burst(rand: () => number, delay: number, x = 0, y = 0, count = SPARKS.length, radius: Range = [4, 8]) {
  return SPARKS.slice(0, count).map((part, i) => {
    const angle = (i / count) * Math.PI * 2 + rand() * 0.8
    const distance = between(radius, rand)
    return track(
      part,
      between([550, 800], rand),
      [
        { at: 0, x, y, o: 1, sx: 1.2, sy: 1.2 },
        { at: 1, x: x + Math.cos(angle) * distance, y: y + Math.sin(angle) * distance, o: 0, sx: 0.6, sy: 0.6 },
      ],
      { delay, easing: 'ease-out' },
    )
  })
}

function sceneOf(
  name: string,
  family: MascotScene['family'],
  prop: MascotProp | null,
  tracks: MascotTrack[],
): MascotScene {
  const duration = tracks.reduce((max, t) => Math.max(max, (t.delay ?? 0) + t.duration), 0)
  return { name, family, prop, tracks, duration }
}

// ---------------------------------------------------------------------------
// Activités
// ---------------------------------------------------------------------------

/** Lit une feuille tenue à deux mains : les yeux suivent les lignes, il tourne la page. */
function readScene(rand: () => number): MascotScene {
  const d = between(SCENES.durations.read, rand)
  const flip = between([0.62, 0.72], rand)
  const lines = 3
  const eyes: Pose[] = [{ at: 0 }]
  for (let i = 0; i < lines; i++) {
    const start = 0.06 + (i * 0.84) / lines
    const end = start + 0.84 / lines - 0.05
    eyes.push({ at: start, x: -1, y: 1 }, { at: end, x: 1, y: 1 })
  }
  eyes.push({ at: 1 })
  return sceneOf('read', 'activity', 'paper', [
    hold('armL', d, { x: 3, y: 2 }),
    track('armR', d, [
      { at: 0 },
      { at: 0.08, x: -3, y: 2 },
      { at: flip - 0.06, x: -3, y: 2 },
      { at: flip, x: -5, y: 0 },
      { at: flip + 0.06, x: -3, y: 2 },
      { at: 0.9, x: -3, y: 2 },
      { at: 0.98 },
      { at: 1 },
    ]),
    track('paper', d, [{ at: 0 }, { at: flip - 0.02 }, { at: flip + 0.03, sx: 0.1 }, { at: flip + 0.08 }, { at: 1 }]),
    track('face', d, eyes, { easing: 'linear' }),
  ])
}

/** Plonge dans un dossier, fouille, ressort et regarde autour de lui. */
function searchScene(rand: () => number): MascotScene {
  const d = between(SCENES.durations.search, rand)
  const figure: Pose[] = [{ at: 0 }, { at: 0.08, y: -1.5, sx: 0.95, sy: 1.06 }, { at: 0.18, y: 6 }]
  const shakes = 5
  for (let i = 0; i < shakes; i++) {
    const side = i % 2 === 0 ? -1 : 1
    figure.push({ at: 0.22 + i * 0.08, x: side * between([0.4, 0.9], rand), y: 6, r: side * between([3, 8], rand) })
  }
  figure.push({ at: 0.66, y: 6 }, { at: 0.76, y: -1, sx: 0.95, sy: 1.06 }, { at: 0.84, sx: 1.05, sy: 0.95 }, { at: 0.9 }, { at: 1 })
  const side = rand() < 0.5 ? -1 : 1
  return sceneOf('search', 'activity', 'folder', [
    track('figure', d, figure),
    track('face', d, [{ at: 0 }, { at: 0.86 }, { at: 0.9, x: side }, { at: 0.95, x: -side }, { at: 1 }]),
  ])
}

/** Écrit au crayon sur un carnet : la main gribouille, la tête hoche, des étincelles sortent du crayon. */
function writeScene(rand: () => number): MascotScene {
  const d = between(SCENES.durations.write, rand)
  const arm: Pose[] = [{ at: 0 }, { at: 0.1, x: -5, y: 3 }]
  const head: Pose[] = [{ at: 0 }]
  const strokes = 6
  for (let i = 0; i < strokes; i++) {
    const at = 0.16 + (i * 0.68) / strokes
    arm.push({ at, x: i % 2 === 0 ? -6.5 : -4.5, y: i % 2 === 0 ? 3 : 3.5 })
    head.push({ at, y: i % 2 === 0 ? 0.5 : 0 })
  }
  arm.push({ at: 0.88, x: -5, y: 3 }, { at: 0.98 }, { at: 1 })
  head.push({ at: 0.9 }, { at: 1 })
  // Pointe du crayon : quatre cases sous le centre de la tête, place des étincelles.
  const sparks = [0.3, 0.55, 0.78].map((at, i) =>
    track(
      SPARKS[i] ?? 'spark0',
      500,
      [
        { at: 0, x: 0, y: 4, o: 1 },
        { at: 1, x: between([-2.5, 0.5], rand), y: between([1, 2.5], rand), o: 0, sx: 0.5, sy: 0.5 },
      ],
      { delay: at * d, easing: 'ease-out' },
    ),
  )
  return sceneOf('write', 'activity', 'pencil', [
    track('armR', d, arm, { easing: 'linear' }),
    track('upper', d, head),
    hold('face', d, { x: -1, y: 1 }),
    ...sparks,
  ])
}

/** Tape au clavier des deux pattes avant, en regardant l'invite de commande. */
function typeScene(rand: () => number): MascotScene {
  const d = between(SCENES.durations.type, rand)
  const left: Pose[] = [{ at: 0 }, { at: 0.08, x: 4, y: 4 }]
  const right: Pose[] = [{ at: 0 }, { at: 0.08, x: -4, y: 4 }]
  const taps = 8
  for (let i = 0; i < taps; i++) {
    const at = 0.14 + (i * 0.72) / taps
    const down = rand() < 0.85 ? 0.6 : 0
    if (i % 2 === 0) left.push({ at, x: 4, y: 4 + down }, { at: at + 0.04, x: 4, y: 4 })
    else right.push({ at, x: -4, y: 4 + down }, { at: at + 0.04, x: -4, y: 4 })
  }
  left.push({ at: 0.9, x: 4, y: 4 }, { at: 0.98 }, { at: 1 })
  right.push({ at: 0.9, x: -4, y: 4 }, { at: 0.98 }, { at: 1 })
  return sceneOf('type', 'activity', 'keyboard', [
    track('armL', d, left, { easing: 'linear' }),
    track('armR', d, right, { easing: 'linear' }),
    hold('face', d, { x: 1, y: -1 }, 0.1, 0.88),
  ])
}

/** Commande qui dure : il attend en tapant du pied, les yeux sur l'invite, en se balançant. */
function tapFootScene(rand: () => number): MascotScene {
  const d = between(SCENES.durations.tapFoot, rand)
  const foot: Pose[] = [{ at: 0 }]
  const taps = 4
  for (let i = 0; i < taps; i++) {
    const at = 0.1 + i * 0.18
    foot.push({ at, y: 0 }, { at: at + 0.06, y: -1 }, { at: at + 0.12, y: 0 })
  }
  foot.push({ at: 1 })
  return sceneOf('tapFoot', 'activity', 'keyboard', [
    track('leg4', d, foot, { easing: 'linear' }),
    hold('face', d, { x: 1, y: -1 }),
    track('figure', d, [{ at: 0 }, { at: 0.3, r: -3 }, { at: 0.7, r: 3 }, { at: 1 }]),
  ])
}

/** Cherche à la loupe : la loupe passe d'un œil à l'autre, il se penche. */
function webScene(rand: () => number): MascotScene {
  const d = between(SCENES.durations.web, rand)
  return sceneOf('web', 'activity', 'lens', [
    track('lens', d, [
      { at: 0 },
      { at: 0.2, x: -2, y: -1 },
      { at: 0.42, x: -7, y: 0 },
      { at: 0.58, x: -6, y: 1 },
      { at: 0.8, x: -2, y: 0.5 },
      { at: 1 },
    ]),
    track('figure', d, [{ at: 0 }, { at: 0.45, r: -4, x: -0.5 }, { at: 0.75, r: 3 }, { at: 1 }]),
  ])
}

/** Réfléchit : regarde en l'air, la patte contre la tempe, une bulle de pensée monte au-dessus de sa tête. */
function thinkScene(rand: () => number): MascotScene {
  const d = between(SCENES.durations.think, rand)
  const dot = (part: MascotPart, from: number, rise: number): MascotTrack =>
    track(
      part,
      d,
      [
        { at: 0, o: 0, sx: 0.3, sy: 0.3 },
        { at: from, o: 0, sx: 0.3, sy: 0.3 },
        { at: from + 0.08, o: 1 },
        { at: 0.82, o: 1, y: -rise },
        { at: 1, o: 0, y: -rise - 1 },
      ],
      { easing: 'ease-out' },
    )
  const tap: Pose[] = [{ at: 0 }, { at: 0.12, y: -3 }]
  for (let i = 0; i < 3; i++) tap.push({ at: 0.3 + i * 0.15, y: -3.5 }, { at: 0.37 + i * 0.15, y: -3 })
  tap.push({ at: 0.88, y: -3 }, { at: 1 })
  return sceneOf('think', 'activity', 'thought', [
    hold('face', d, { x: -1, y: -1 }, 0.1, 0.85),
    track('figure', d, [{ at: 0 }, { at: 0.35, r: -3 }, { at: 0.7, r: 3 }, { at: 1 }]),
    track('armR', d, tap),
    dot('think1', 0.12, 0),
    dot('think2', 0.26, 0.5),
    dot('think3', 0.4, 1),
  ])
}

/** Lance un sous-agent : un mini Claude sort de derrière lui et part en courant ; il lui fait signe. */
function subagentScene(): MascotScene {
  const d = SCENES.durations.subagent
  // Course courte, effacée avant 14 cases : sur Mac, l'encoche commence une dizaine de cases à droite de
  // l'icône, et rien ne doit passer dessous.
  const run: Pose[] = [{ at: 0, o: 0 }, { at: 0.05, o: 1 }]
  const hops = 6
  for (let i = 0; i <= hops; i++) {
    const at = 0.1 + (i * 0.75) / hops
    const o = at < 0.6 ? 1 : Math.max(0, 1 - (at - 0.6) / 0.25)
    run.push({ at, x: 2 + i * 2, y: i % 2 === 0 ? 0 : -2, o })
  }
  run.push({ at: 1, x: 15, o: 0 })
  return sceneOf('subagent', 'activity', null, [
    track('mini', d, run, { easing: 'linear' }),
    hold('face', d, { x: 1 }, 0.1, 0.9),
    track('armR', d, [{ at: 0 }, { at: 0.35 }, { at: 0.45, x: 1, y: -4 }, { at: 0.55, x: 2, y: -4 }, { at: 0.65, x: 1, y: -4 }, { at: 0.75, x: 2, y: -4 }, { at: 0.9 }, { at: 1 }]),
  ])
}

/** Sous-agent déjà parti : il regarde dans sa direction en attendant, tape du pied. */
function watchScene(rand: () => number): MascotScene {
  const scene = tapFootScene(rand)
  const d = between(SCENES.durations.watch, rand)
  return sceneOf('watch', 'activity', null, [
    hold('face', d, { x: 1 }),
    ...scene.tracks.filter((t) => t.part === 'leg4').map((t) => ({ ...t, duration: d })),
  ])
}

export interface ActivityContext {
  activity: ClaudeActivity
  /** Depuis quand cette activité est montrée (ms). */
  activityElapsed: number
  /** La scène précédente montrait déjà cette activité. */
  repeat: boolean
}

export function activityScene(ctx: ActivityContext, rand: () => number): MascotScene {
  switch (ctx.activity) {
    case 'read':
      return readScene(rand)
    case 'search':
      return searchScene(rand)
    case 'write':
      return writeScene(rand)
    case 'command':
      return ctx.activityElapsed >= SCENES.longCommandMs && rand() < 0.6 ? tapFootScene(rand) : typeScene(rand)
    case 'web':
      return webScene(rand)
    case 'think':
      return thinkScene(rand)
    case 'subagent':
      return ctx.repeat ? watchScene(rand) : subagentScene()
  }
}

// ---------------------------------------------------------------------------
// Variations
// ---------------------------------------------------------------------------

/** S'étire les bras en l'air, les yeux fermés, puis se tasse. */
function stretchScene(): MascotScene {
  const d = SCENES.durations.stretch
  return sceneOf('stretch', 'variation', null, [
    hold('armL', d, { x: 1, y: -7 }, 0.25, 0.7, 0.12),
    hold('armR', d, { x: -1, y: -7 }, 0.25, 0.7, 0.12),
    track('upper', d, [{ at: 0 }, { at: 0.3 }, { at: 0.45, sy: 1.08 }, { at: 0.65, sy: 1.08 }, { at: 0.8 }, { at: 1 }]),
    track('figure', d, [{ at: 0 }, { at: 0.82 }, { at: 0.9, sx: 1.08, sy: 0.9 }, { at: 1 }]),
    lids(d, [[0, 0], [0.28, 0], [0.34, 1], [0.7, 1], [0.76, 0], [1, 0]]),
  ])
}

/** Bâille : yeux fermés, bouche qui s'ouvre, il s'allonge un peu. */
function yawnScene(): MascotScene {
  const d = SCENES.durations.yawn
  return sceneOf('yawn', 'variation', null, [
    track('mouth', d, [{ at: 0, o: 0, sy: 0.5 }, { at: 0.15, o: 1, sy: 1 }, { at: 0.5, o: 1, sy: 2.5 }, { at: 0.8, o: 1, sy: 1.5 }, { at: 0.9, o: 0, sy: 0.5 }, { at: 1, o: 0, sy: 0.5 }]),
    track('upper', d, [{ at: 0 }, { at: 0.5, sy: 1.06 }, { at: 0.85 }, { at: 1 }]),
    lids(d, [[0, 0], [0.12, 1], [0.86, 1], [0.92, 0], [1, 0]]),
  ])
}

/** Se gratte la tête d'une patte, la tête penchée. */
function scratchScene(rand: () => number): MascotScene {
  const d = SCENES.durations.scratch
  const arm: Pose[] = [{ at: 0 }, { at: 0.15, x: -3, y: -6 }]
  for (let i = 0; i < 6; i++) arm.push({ at: 0.22 + i * 0.09, x: -3 + (i % 2 === 0 ? 0.6 : -0.6), y: -6 })
  arm.push({ at: 0.82, x: -3, y: -6 }, { at: 0.95 }, { at: 1 })
  const tilt = between([5, 9], rand)
  return sceneOf('scratch', 'variation', null, [
    track('armR', d, arm, { easing: 'linear' }),
    track('figure', d, [{ at: 0 }, { at: 0.2, r: -tilt }, { at: 0.8, r: -tilt }, { at: 1 }]),
    hold('face', d, { y: -1 }, 0.15, 0.82),
  ])
}

/** Se retourne un instant (on voit son dos : plus d'yeux), puis revient. */
function turnBackScene(): MascotScene {
  const d = SCENES.durations.turnBack
  return sceneOf('turnBack', 'variation', null, [
    track('figure', d, [{ at: 0 }, { at: 0.08, sx: 0.75 }, { at: 0.16 }, { at: 0.74 }, { at: 0.82, sx: 0.75 }, { at: 0.9 }, { at: 1 }]),
    track('face', d, [{ at: 0, o: 1 }, { at: 0.08, o: 1 }, { at: 0.1, o: 0 }, { at: 0.8, o: 0 }, { at: 0.82, o: 1 }, { at: 1, o: 1 }], { easing: 'linear' }),
  ])
}

/** Trébuche sur un pixel, bras en l'air, et se rattrape. */
function tripScene(): MascotScene {
  const d = SCENES.durations.trip
  return sceneOf('trip', 'variation', null, [
    track('figure', d, [
      { at: 0 },
      { at: 0.2, x: 1, r: 15 },
      { at: 0.35, x: 1.5, y: 0.5, r: 24 },
      { at: 0.55, x: 1, r: -8 },
      { at: 0.75, sx: 1.08, sy: 0.92 },
      { at: 1 },
    ]),
    track('armL', d, [{ at: 0 }, { at: 0.25, y: -3 }, { at: 0.4, x: -0.5, y: -4 }, { at: 0.7 }, { at: 1 }]),
    track('armR', d, [{ at: 0 }, { at: 0.3, y: -3 }, { at: 0.45, x: 0.5, y: -4 }, { at: 0.75 }, { at: 1 }]),
    hold('face', d, { x: 1, y: 1 }, 0.2, 0.6),
  ])
}

/** S'essuie le front d'un revers de patte ; une goutte de sueur tombe. */
function wipeScene(prop: MascotProp | null): MascotScene {
  const d = SCENES.durations.wipe
  return sceneOf('wipe', 'variation', prop, [
    track('armR', d, [{ at: 0 }, { at: 0.2, x: -2, y: -6 }, { at: 0.6, x: -11, y: -6 }, { at: 0.7, x: -11, y: -6 }, { at: 0.92 }, { at: 1 }]),
    track('sweat', d, [{ at: 0, o: 0 }, { at: 0.5, o: 0 }, { at: 0.56, o: 1 }, { at: 1, y: 5, o: 0 }], { easing: 'ease-in' }),
    lids(d, [[0, 0], [0.25, 0], [0.3, 0.5], [0.65, 0.5], [0.7, 0], [1, 0]]),
  ])
}

/** Un des gestes de mascot.ts (saut, penché, écrasement, pas de côté, regard), accessoire gardé. */
function gestureScene(gesture: MascotGesture, prop: MascotProp | null, family: MascotScene['family'], rand: () => number): MascotScene {
  const animation = gestureAnimation(gesture, rand)
  const tracks: MascotTrack[] = animation
    ? [{ part: animation.target, keyframes: animation.keyframes, duration: animation.duration, easing: animation.easing }]
    : []
  return sceneOf(gesture, family, prop, tracks)
}

export interface VariationContext {
  activity: ClaudeActivity
  activityElapsed: number
  /** Depuis le début du tour (ms). */
  workingFor: number
}

/** Variations permises : bâiller seulement après un long moment, s'essuyer le front si ça dure. */
export function allowedVariations(ctx: VariationContext): MascotVariation[] {
  return (Object.keys(VARIATION_WEIGHTS) as MascotVariation[]).filter((v) => {
    if (v === 'yawn') return ctx.workingFor >= SCENES.yawnAfterMs
    if (v === 'wipe') {
      return (ctx.activity === 'command' && ctx.activityElapsed >= SCENES.longCommandMs) || ctx.workingFor >= SCENES.wipeAfterMs
    }
    return true
  })
}

export function variationScene(variation: MascotVariation, ctx: VariationContext, rand: () => number): MascotScene {
  const prop = ACTIVITY_PROP[ctx.activity]
  switch (variation) {
    case 'gesture':
      return gestureScene(pickGesture({ ...WORKING_WEIGHTS, rest: 0 }, null, rand), prop, 'variation', rand)
    case 'stretch':
      return stretchScene()
    case 'yawn':
      return yawnScene()
    case 'scratch':
      return scratchScene(rand)
    case 'turnBack':
      return turnBackScene()
    case 'trip':
      return tripScene()
    case 'wipe':
      return wipeScene(prop)
  }
}

function pickVariation(ctx: VariationContext, rand: () => number): MascotVariation {
  const allowed = allowedVariations(ctx)
  const total = allowed.reduce((sum, v) => sum + VARIATION_WEIGHTS[v], 0)
  let roll = rand() * total
  for (const v of allowed) {
    roll -= VARIATION_WEIGHTS[v]
    if (roll < 0) return v
  }
  return allowed[allowed.length - 1] ?? 'gesture'
}

// ---------------------------------------------------------------------------
// Moments
// ---------------------------------------------------------------------------

/** Se réveille en sursaut (yeux qui s'ouvrent d'un coup, petit saut) et se secoue. */
function startScene(): MascotScene {
  const d = SCENES.durations.start
  const shake: Pose[] = [{ at: 0 }, { at: 0.3 }, { at: 0.4, y: -2.5, sx: 0.9, sy: 1.15 }, { at: 0.5, sx: 1.1, sy: 0.9 }]
  for (let i = 0; i < 4; i++) shake.push({ at: 0.56 + i * 0.08, x: i % 2 === 0 ? 0.6 : -0.6, r: i % 2 === 0 ? 5 : -5 })
  shake.push({ at: 0.92 }, { at: 1 })
  return sceneOf('start', 'moment', null, [
    track('figure', d, shake),
    lids(d, [[0, 1], [0.3, 1], [0.34, 0], [1, 0]]),
    track('armL', d, [{ at: 0 }, { at: 0.35 }, { at: 0.42, y: -2 }, { at: 0.55 }, { at: 1 }]),
    track('armR', d, [{ at: 0 }, { at: 0.35 }, { at: 0.42, y: -2 }, { at: 0.55 }, { at: 1 }]),
  ])
}

/** Fin de session : petite danse, bulle ✓ et gerbe d'étincelles. */
function doneScene(rand: () => number): MascotScene {
  const d = SCENES.durations.done
  const dance: Pose[] = [{ at: 0 }]
  const left: Pose[] = [{ at: 0 }]
  const right: Pose[] = [{ at: 0 }]
  for (let i = 0; i < 4; i++) {
    const at = 0.08 + i * 0.18
    const side = i % 2 === 0 ? 1 : -1
    dance.push({ at, y: 0, r: side * 4, sx: 1.05, sy: 0.95 }, { at: at + 0.09, y: -2.5, r: side * 10 })
    left.push({ at: at + 0.09, y: side > 0 ? -5 : 0 })
    right.push({ at: at + 0.09, y: side > 0 ? 0 : -5 })
  }
  dance.push({ at: 0.86 }, { at: 1 })
  left.push({ at: 0.86 }, { at: 1 })
  right.push({ at: 0.86 }, { at: 1 })
  return sceneOf('done', 'moment', null, [
    track('figure', d, dance),
    track('armL', d, left),
    track('armR', d, right),
    popBubble('bubbleDone', d, 0.04, 0.88),
    ...burst(rand, d * 0.1),
  ])
}

/** Erreur ou refus : recule, bulle « ? », se gratte la tête. */
function errorScene(): MascotScene {
  const d = SCENES.durations.error
  const arm: Pose[] = [{ at: 0 }, { at: 0.3 }, { at: 0.4, x: -3, y: -6 }]
  for (let i = 0; i < 5; i++) arm.push({ at: 0.46 + i * 0.07, x: -3 + (i % 2 === 0 ? 0.6 : -0.6), y: -6 })
  arm.push({ at: 0.85, x: -3, y: -6 }, { at: 0.95 }, { at: 1 })
  return sceneOf('error', 'moment', null, [
    track('figure', d, [
      { at: 0 },
      { at: 0.1, x: -1.5, sx: 0.9, sy: 1.08 },
      { at: 0.22, x: -1, sx: 1.04, sy: 0.96 },
      { at: 0.4, x: -1, r: -6 },
      { at: 0.85, x: -1, r: -6 },
      { at: 1 },
    ]),
    track('armR', d, arm, { easing: 'linear' }),
    hold('face', d, { y: -1 }, 0.12, 0.85),
    popBubble('bubbleErr', d, 0.1, 0.86),
  ])
}

/** Demande d'autorisation : il te regarde, tape du pied, et parfois te fait signe d'une patte. */
function waitingScene(rand: () => number): MascotScene {
  const d = between(SCENES.durations.waiting, rand)
  const foot: Pose[] = [{ at: 0 }]
  for (let i = 0; i < 4; i++) {
    const at = 0.06 + i * 0.13
    foot.push({ at, y: 0 }, { at: at + 0.05, y: -1 }, { at: at + 0.1, y: 0 })
  }
  foot.push({ at: 1 })
  const tracks: MascotTrack[] = [track('leg4', d, foot, { easing: 'linear' })]
  if (rand() < 0.5) {
    const wave: Pose[] = [{ at: 0 }, { at: 0.58 }, { at: 0.64, x: 1, y: -4 }]
    for (let i = 0; i < 4; i++) wave.push({ at: 0.68 + i * 0.06, x: i % 2 === 0 ? 2 : 1, y: -4 })
    wave.push({ at: 0.94 }, { at: 1 })
    tracks.push(track('armR', d, wave, { easing: 'linear' }))
  }
  return sceneOf('waiting', 'moment', null, tracks)
}

export function momentScene(moment: MascotMoment, rand: () => number): MascotScene {
  switch (moment) {
    case 'start':
      return startScene()
    case 'done':
      return doneScene(rand)
    case 'error':
      return errorScene()
  }
}

/**
 * Moment à jouer quand l'état de la session change : réveil quand le travail commence (pas en revenant d'une
 * demande d'autorisation), danse à la fin, recul à une erreur. Rien au premier affichage.
 */
export function detectMoment(
  previous: { status: ClaudeSessionStatus | null; error: boolean } | null,
  next: { status: ClaudeSessionStatus | null; error: boolean },
): MascotMoment | null {
  if (!previous) return null
  if (next.error && !previous.error) return 'error'
  if (next.status === 'done' && previous.status !== 'done') return 'done'
  if (next.status === 'working' && previous.status !== 'working' && previous.status !== 'waiting') return 'start'
  return null
}

/** Phase de la session : un changement de phase interrompt la scène en cours (accessoires à jour tout de suite). */
export function mascotPhase(status: ClaudeSessionStatus | null): 'working' | 'waiting' | 'rest' {
  if (status === 'working') return 'working'
  if (status === 'waiting') return 'waiting'
  return 'rest'
}

// ---------------------------------------------------------------------------
// Choix de la scène suivante
// ---------------------------------------------------------------------------

export interface DirectorContext {
  status: ClaudeSessionStatus | null
  activity: ClaudeActivity | null
  activityElapsed: number
  workingFor: number
  /** Scène précédente (null au départ). */
  previous: Pick<MascotScene, 'name' | 'family'> | null
  /** Activité de la scène d'activité précédente. */
  previousActivity: ClaudeActivity | null
}

/** Scène suivante hors moment (les moments sont joués d'abord par ClaudeMascot). */
export function nextScene(ctx: DirectorContext, rand: () => number): MascotScene {
  const phase = mascotPhase(ctx.status)
  if (phase === 'waiting') return waitingScene(rand)
  if (phase === 'rest') return gestureScene(pickGesture(IDLE_WEIGHTS, null, rand), null, 'idle', rand)
  const activity = ctx.activity ?? 'think'
  const variationCtx: VariationContext = { activity, activityElapsed: ctx.activityElapsed, workingFor: ctx.workingFor }
  if (ctx.previous?.family !== 'variation' && rand() < SCENES.variationChance) {
    return variationScene(pickVariation(variationCtx, rand), variationCtx, rand)
  }
  return activityScene(
    { activity, activityElapsed: ctx.activityElapsed, repeat: ctx.previousActivity === activity },
    rand,
  )
}
