/**
 * Gestes du Claude de l'île (icône partagée `agentIcon`), absent du prototype (demande de Maël : « plus vivant
 * que juste sauter sur place »). Logique pure : choix du geste, images clés et délais, tirés au hasard.
 * Le composant ClaudeMascot les joue avec l'API Web Animations.
 *
 * Unités : les translations sont en % de l'élément animé. Le visage (yeux + paupières) fait toute la figure :
 * 6,25 % = un pixel de la grille 16 × 16 de l'icône.
 */

export type Range = readonly [number, number]

/** Délais et amplitudes, en ms, % et degrés. */
export const MASCOT = {
  /** Clignement : durée d'un battement, délai entre deux clignements, chance d'un double clignement. */
  blink: { duration: 150, gap: 90, every: [2200, 5500] as Range, idleEvery: [3500, 7500] as Range, double: 0.25 },
  /** Délai avant le geste suivant : en travail, au repos (seulement des regards). */
  next: { working: [700, 2400] as Range, idle: [4000, 9000] as Range },
  hop: { height: [6, 13] as Range, duration: [360, 520] as Range },
  tilt: { angle: [6, 13] as Range, duration: [520, 760] as Range },
  squash: { amount: [0.07, 0.13] as Range, duration: [380, 520] as Range },
  shuffle: { step: [4, 8] as Range, duration: [420, 600] as Range },
  /** Regard : déplacement du visage (un pixel de la grille), tenu un moment. */
  look: { shift: 6.25, hold: [450, 1300] as Range, move: 140 },
} as const

export type MascotGesture = 'hop' | 'doubleHop' | 'tilt' | 'squash' | 'shuffle' | 'lookSide' | 'lookUp' | 'rest'

/** Poids des gestes en travail : le saut reste le plus fréquent, mais n'est plus le seul. */
export const WORKING_WEIGHTS: Readonly<Record<MascotGesture, number>> = {
  hop: 3,
  doubleHop: 1,
  tilt: 2,
  squash: 2,
  shuffle: 1.5,
  lookSide: 3,
  lookUp: 1,
  rest: 1.5,
}

/** Au repos : il regarde autour de lui, sans bouger. */
export const IDLE_WEIGHTS: Readonly<Record<MascotGesture, number>> = {
  hop: 0,
  doubleHop: 0,
  tilt: 0,
  squash: 0,
  shuffle: 0,
  lookSide: 3,
  lookUp: 1,
  rest: 2,
}

export const between = (range: Range, rand: () => number): number => range[0] + (range[1] - range[0]) * rand()

/** Tire un geste selon les poids ; évite de répéter deux fois de suite le même (sauf « rest »). */
export function pickGesture(
  weights: Readonly<Record<MascotGesture, number>>,
  previous: MascotGesture | null,
  rand: () => number,
): MascotGesture {
  const entries = (Object.entries(weights) as [MascotGesture, number][]).filter(
    ([gesture, weight]) => weight > 0 && (gesture === 'rest' || gesture !== previous),
  )
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = rand() * total
  for (const [gesture, weight] of entries) {
    roll -= weight
    if (roll < 0) return gesture
  }
  return entries[entries.length - 1]?.[0] ?? 'rest'
}

export interface GestureAnimation {
  /** Figure entière (sauts, penchés, écrasements, pas de côté) ou visage seul (regards). */
  target: 'figure' | 'face'
  keyframes: Keyframe[]
  duration: number
  easing: string
}

/** Images clés d'un geste, amplitudes tirées au hasard ; null pour « rest ». */
export function gestureAnimation(gesture: MascotGesture, rand: () => number): GestureAnimation | null {
  const sign = rand() < 0.5 ? -1 : 1
  switch (gesture) {
    case 'hop': {
      const h = between(MASCOT.hop.height, rand)
      return {
        target: 'figure',
        keyframes: [
          { transform: 'translateY(0) scale(1, 1)' },
          { transform: 'translateY(0) scale(1.06, 0.92)', offset: 0.15 },
          { transform: `translateY(-${h.toFixed(1)}%) scale(0.97, 1.04)`, offset: 0.5 },
          { transform: 'translateY(0) scale(1.04, 0.95)', offset: 0.85 },
          { transform: 'translateY(0) scale(1, 1)' },
        ],
        duration: between(MASCOT.hop.duration, rand),
        easing: 'ease-in-out',
      }
    }
    case 'doubleHop': {
      const h1 = between(MASCOT.hop.height, rand)
      const h2 = h1 * 0.6
      return {
        target: 'figure',
        keyframes: [
          { transform: 'translateY(0)' },
          { transform: `translateY(-${h1.toFixed(1)}%)`, offset: 0.25 },
          { transform: 'translateY(0)', offset: 0.5 },
          { transform: `translateY(-${h2.toFixed(1)}%)`, offset: 0.72 },
          { transform: 'translateY(0)' },
        ],
        duration: between(MASCOT.hop.duration, rand) * 1.7,
        easing: 'ease-in-out',
      }
    }
    case 'tilt': {
      const a = between(MASCOT.tilt.angle, rand) * sign
      return {
        target: 'figure',
        keyframes: [
          { transform: 'rotate(0deg)' },
          { transform: `rotate(${a.toFixed(1)}deg)`, offset: 0.35 },
          { transform: `rotate(${(a * 0.8).toFixed(1)}deg)`, offset: 0.65 },
          { transform: 'rotate(0deg)' },
        ],
        duration: between(MASCOT.tilt.duration, rand),
        easing: 'ease-in-out',
      }
    }
    case 'squash': {
      const k = between(MASCOT.squash.amount, rand)
      return {
        target: 'figure',
        keyframes: [
          { transform: 'scale(1, 1)' },
          { transform: `scale(${(1 + k).toFixed(3)}, ${(1 - k).toFixed(3)})`, offset: 0.3 },
          { transform: `scale(${(1 - k / 2).toFixed(3)}, ${(1 + k / 2).toFixed(3)})`, offset: 0.65 },
          { transform: 'scale(1, 1)' },
        ],
        duration: between(MASCOT.squash.duration, rand),
        easing: 'ease-out',
      }
    }
    case 'shuffle': {
      const s = between(MASCOT.shuffle.step, rand) * sign
      return {
        target: 'figure',
        keyframes: [
          { transform: 'translateX(0) rotate(0deg)' },
          { transform: `translateX(${s.toFixed(1)}%) rotate(${(sign * 4).toFixed(0)}deg)`, offset: 0.33 },
          { transform: `translateX(${(-s).toFixed(1)}%) rotate(${(-sign * 4).toFixed(0)}deg)`, offset: 0.66 },
          { transform: 'translateX(0) rotate(0deg)' },
        ],
        duration: between(MASCOT.shuffle.duration, rand),
        easing: 'ease-in-out',
      }
    }
    case 'lookSide':
    case 'lookUp': {
      const { shift, move } = MASCOT.look
      const hold = between(MASCOT.look.hold, rand)
      const away = gesture === 'lookUp' ? `translate(0, -${shift}%)` : `translate(${sign * shift}%, 0)`
      const duration = hold + 2 * move
      const inAt = move / duration
      return {
        target: 'face',
        keyframes: [
          { transform: 'translate(0, 0)' },
          { transform: away, offset: inAt },
          { transform: away, offset: 1 - inAt },
          { transform: 'translate(0, 0)' },
        ],
        duration,
        easing: 'ease-out',
      }
    }
    case 'rest':
      return null
  }
}
