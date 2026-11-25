/**
 * Flaque du glisser de l'île : saisie par le curseur, elle traîne et s'étire derrière lui, son contour ondule,
 * et à l'arrivée sur un bord elle s'écrase et s'étale le long du bord avant de prendre sa forme. Pur : le moteur
 * (engine.ts) garde l'état, l'avance et écrit le DOM ; la vitesse vient de Rust (island-motion).
 *
 * Contour : N points à angles fixes autour du centre, rayon de chaque point tiré par un ressort peu amorti vers
 * une cible (ondulation lente + étirement selon la vitesse) ; courbe lisse par Catmull-Rom. En se posant, chaque
 * rayon glisse vers celui de la forme du bord (rectangle arrondi, `boxRadius`). Retard : la flaque traîne
 * derrière le curseur de vitesse × lagSeconds (au plus maxLag px) et revient sous lui à l'arrêt.
 */
import { createSpring, isSpringAtRest, snapSpring, stepSpring, type Spring } from './spring'

export const PUDDLE = {
  /** Ondulation du contour au repos (part du rayon) et sa vitesse (rad / s). */
  wobble: 0.07,
  wobbleSpeed: 2.2,
  /** Étirement vers l'arrière par px / s, au plus maxStretch (part du rayon). */
  stretchPerSpeed: 0.0005,
  maxStretch: 0.55,
  /** Ressort de chaque point du contour (peu amorti : la flaque ondule et rebondit). */
  stiffness: 150,
  damping: 9,
  /** Écrasement à l'arrivée : élan le long du bord (px / s de forme) par px / s d'impact. */
  splat: 0.9,
  /** Retard sur le curseur et son ressort. */
  lagSeconds: 0.006,
  maxLag: 6,
  lagStiffness: 320,
  lagDamping: 15,
  /** Sans vitesse reçue depuis ce temps (ms), la flaque est considérée immobile. */
  staleMs: 120,
} as const

/** Nombre de points du contour. */
export const PUDDLE_POINTS = 40
/** Rayon de la flaque (px), celui de la goutte ronde. */
export const PUDDLE_RADIUS = 22
/** Rayon maximal d'un point (px) : la flaque reste dans la fenêtre (centre à 70 px du bord). */
export const PUDDLE_MAX_RADIUS = 64
/** Vitesse lissée qui pilote la flaque et l'écrasement (amortissement critique). */
export const DRAG_VELOCITY_SPRING = { stiffness: 120, damping: 22 } as const
/** Impact pris en compte au plus (px / s) pour l'écrasement. */
export const SPLAT_MAX_IMPACT = 2000

export interface Puddle {
  /** Rayon de chaque point (px), à l'angle 2π i / N. */
  radii: Spring[]
  /** Retard du centre sur le curseur (px). */
  lagX: Spring
  lagY: Spring
  /** Temps (s) de l'ondulation. */
  time: number
}

export function createPuddle(): Puddle {
  return {
    radii: Array.from({ length: PUDDLE_POINTS }, () => createSpring(PUDDLE_RADIUS)),
    lagX: createSpring(0),
    lagY: createSpring(0),
    time: 0,
  }
}

export function puddleSprings(p: Puddle): Spring[] {
  return [...p.radii, p.lagX, p.lagY]
}

export function isPuddleAtRest(p: Puddle): boolean {
  return puddleSprings(p).every((s) => isSpringAtRest(s))
}

export function pointAngle(i: number): number {
  return (2 * Math.PI * i) / PUDDLE_POINTS
}

/** Écart d'angle ramené à [-π, π]. */
function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

/**
 * Rayon cible du point d'angle `theta` : ondulation (harmoniques 2 à 4, phases qui tournent), étirement de la
 * masse vers l'arrière (opposé à la vitesse) et léger aplatissement devant.
 */
export function puddleTarget(theta: number, time: number, vx: number, vy: number): number {
  const R = PUDDLE_RADIUS
  const w = PUDDLE.wobbleSpeed * time
  const organic =
    PUDDLE.wobble *
    (Math.sin(2 * theta + w + 0.7) / 2 + Math.sin(3 * theta - 1.3 * w + 2.1) / 3 + Math.sin(4 * theta + 0.8 * w) / 4) *
    1.6
  const speed = Math.hypot(vx, vy)
  let stretch = 0
  if (speed > 1) {
    const m = Math.min(PUDDLE.maxStretch, speed * PUDDLE.stretchPerSpeed)
    const back = Math.cos(angleDiff(theta, Math.atan2(-vy, -vx)))
    stretch = back > 0 ? m * back * back * 1.25 : -m * back * back * 0.3
  }
  return Math.min(PUDDLE_MAX_RADIUS, R * (1 + organic + stretch))
}

function clampLength(x: number, y: number, max: number): [number, number] {
  const len = Math.hypot(x, y)
  return len > max ? [(x / len) * max, (y / len) * max] : [x, y]
}

/**
 * Une image pendant le glisser : le temps avance, chaque point vise sa cible, le centre traîne derrière le
 * curseur (vitesse en px / s).
 */
export function setPuddleTargets(p: Puddle, dt: number, vx: number, vy: number): void {
  p.time += dt
  p.radii.forEach((s, i) => {
    s.t = puddleTarget(pointAngle(i), p.time, vx, vy)
  })
  const [lx, ly] = clampLength(-vx * PUDDLE.lagSeconds, -vy * PUDDLE.lagSeconds, PUDDLE.maxLag)
  p.lagX.t = lx
  p.lagY.t = ly
}

/** Hors du glisser : plus d'ondulation ni de retard, la flaque revient au rond. */
export function relaxPuddle(p: Puddle): void {
  for (const s of p.radii) s.t = PUDDLE_RADIUS
  p.lagX.t = 0
  p.lagY.t = 0
}

export function stepPuddle(p: Puddle, h: number): void {
  for (const s of p.radii) stepSpring(s, h, PUDDLE.stiffness, PUDDLE.damping)
  stepSpring(p.lagX, h, PUDDLE.lagStiffness, PUDDLE.lagDamping)
  stepSpring(p.lagY, h, PUDDLE.lagStiffness, PUDDLE.lagDamping)
}

/** Remise au rond sans animation (début du glisser, prefers-reduced-motion). */
export function resetPuddle(p: Puddle): void {
  p.time = 0
  relaxPuddle(p)
  puddleSprings(p).forEach(snapSpring)
}

/** Retard du centre (px), réduit par `amount` (détachement : collée, aucun décalage). */
export function puddleLag(p: Puddle, amount: number): { dx: number; dy: number } {
  const [dx, dy] = clampLength(p.lagX.x * amount, p.lagY.x * amount, PUDDLE.maxLag * 1.5)
  return { dx: dx + 0, dy: dy + 0 }
}

/**
 * Arrivée sur un bord : élan des points du contour, ceux face au bord rentrent, ceux des côtés s'étalent.
 * `edgeX`, `edgeY` : direction du bord (unitaire), `impact` : vitesse vers le bord (px / s).
 */
export function splatPuddle(p: Puddle, edgeX: number, edgeY: number, impact: number): void {
  p.radii.forEach((s, i) => {
    const a = pointAngle(i)
    const facing = Math.cos(a) * edgeX + Math.sin(a) * edgeY
    s.v += impact * PUDDLE.splat * 0.3 * (1 - 2 * facing * facing)
  })
}

/** Rectangle arrondi centré en 0 : demi-largeur a, demi-hauteur b, rayon de chaque coin (signes x, y). */
export interface RoundedBox {
  a: number
  b: number
  radius: (sx: number, sy: number) => number
}

/** Distance du centre au bord du rectangle arrondi dans la direction `theta`. */
export function boxRadius(box: RoundedBox, theta: number): number {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  const { a, b } = box
  const t = Math.min(Math.abs(c) > 1e-9 ? a / Math.abs(c) : Infinity, Math.abs(s) > 1e-9 ? b / Math.abs(s) : Infinity)
  const px = t * c
  const py = t * s
  const sx = px < 0 ? -1 : 1
  const sy = py < 0 ? -1 : 1
  const rc = Math.max(0, Math.min(box.radius(sx, sy), a, b))
  if (rc <= 0 || Math.abs(px) <= a - rc || Math.abs(py) <= b - rc) return t
  // Coin arrondi : intersection avec le cercle de centre (sx (a − rc), sy (b − rc)).
  const cx = sx * (a - rc)
  const cy = sy * (b - rc)
  const dc = c * cx + s * cy
  const disc = dc * dc - (cx * cx + cy * cy) + rc * rc
  return disc > 0 ? dc + Math.sqrt(disc) : t
}

function n(v: number): string {
  return String(+v.toFixed(2))
}

/**
 * Contour lisse (Catmull-Rom fermé) des points de rayon `radius(i)` autour de (cx, cy), dans le sens des
 * aiguilles d'une montre à l'écran (angles croissants, y vers le bas).
 */
export function puddlePath(cx: number, cy: number, radius: (i: number) => number): string {
  const N = PUDDLE_POINTS
  const pts = Array.from({ length: N }, (_, i) => {
    const a = pointAngle(i)
    const r = Math.max(0, radius(i))
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const
  })
  const at = (i: number) => pts[((i % N) + N) % N] ?? ([cx, cy] as const)
  const start = at(0)
  let d = `M${n(start[0])} ${n(start[1])}`
  for (let i = 0; i < N; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(p2[0])} ${n(p2[1])}`
  }
  return `${d}Z`
}
