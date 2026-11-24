/**
 * Goutte liquide du glisser : la vitesse de la fenêtre (Rust, island-motion) étire la goutte dans le sens du
 * mouvement et la fait traîner derrière le curseur ; des ressorts peu amortis la font trembler quand la vitesse
 * change (arrêt, demi-tour, arrivée au bord). Pur : le moteur (engine.ts) l'avance et écrit la transformation.
 *
 * Étirement : matrice symétrique [[1 + a, b], [b, 1 − a]], de valeurs propres 1 ± √(a² + b²), d'axe l'angle de
 * la vitesse (a = m cos 2θ, b = m sin 2θ). Deux ressorts sur (a, b) : quand la vitesse tombe, ils passent de
 * l'autre côté de zéro et la goutte s'écrase dans le sens du mouvement, comme un liquide qui s'arrête.
 */
import { JELLY } from '../geometry'
import { createSpring, isSpringAtRest, snapSpring, stepSpring, type Spring } from './spring'

export interface Jelly {
  /** Étirement : composantes (a, b) de la matrice. */
  a: Spring
  b: Spring
  /** Retard de la goutte sur le curseur (px CSS). */
  x: Spring
  y: Spring
}

export interface JellyTransform {
  /** Matrice CSS matrix(m11, m12, m12, m22, 0, 0), d'aire 1. */
  m11: number
  m12: number
  m22: number
  /** Décalage (px CSS). */
  dx: number
  dy: number
}

export function createJelly(): Jelly {
  return { a: createSpring(0), b: createSpring(0), x: createSpring(0), y: createSpring(0) }
}

function clampLength(x: number, y: number, max: number): [number, number] {
  const len = Math.hypot(x, y)
  return len > max ? [(x / len) * max, (y / len) * max] : [x, y]
}

/** Nouvelle vitesse (px CSS / s) ; null : immobile. */
export function setJellyVelocity(j: Jelly, velocity: { vx: number; vy: number } | null): void {
  const vx = velocity && Number.isFinite(velocity.vx) ? velocity.vx : 0
  const vy = velocity && Number.isFinite(velocity.vy) ? velocity.vy : 0
  const speed = Math.hypot(vx, vy)
  const m = Math.min(JELLY.maxStretch, speed * JELLY.stretchPerSpeed)
  const angle = 2 * Math.atan2(vy, vx)
  j.a.t = speed > 0 ? m * Math.cos(angle) : 0
  j.b.t = speed > 0 ? m * Math.sin(angle) : 0
  const [lx, ly] = clampLength(-vx * JELLY.lagSeconds, -vy * JELLY.lagSeconds, JELLY.maxLag)
  j.x.t = lx
  j.y.t = ly
}

/** Un sous-pas h (s). */
export function stepJelly(j: Jelly, h: number): void {
  stepSpring(j.a, h, JELLY.stiffness, JELLY.damping)
  stepSpring(j.b, h, JELLY.stiffness, JELLY.damping)
  stepSpring(j.x, h, JELLY.lagStiffness, JELLY.lagDamping)
  stepSpring(j.y, h, JELLY.lagStiffness, JELLY.lagDamping)
}

export function jellySprings(j: Jelly): Spring[] {
  return [j.a, j.b, j.x, j.y]
}

export function isJellyAtRest(j: Jelly): boolean {
  return jellySprings(j).every((s) => isSpringAtRest(s))
}

/** Remise à plat sans animation (prefers-reduced-motion). */
export function resetJelly(j: Jelly): void {
  setJellyVelocity(j, null)
  jellySprings(j).forEach(snapSpring)
}

/**
 * Transformation de la goutte ; `amount` 0..1 (détachement du bord : collée, l'île n'est pas déformée).
 * L'étirement est borné (un ressort qui dépasse ne retourne jamais la forme) et l'aire reste celle du rond.
 */
export function jellyTransform(j: Jelly, amount: number): JellyTransform {
  const k = Math.max(0, Math.min(1, amount))
  const [a, b] = clampLength(j.a.x * k, j.b.x * k, JELLY.maxStretch * 1.5)
  const [dx, dy] = clampLength(j.x.x * k, j.y.x * k, JELLY.maxLag * 1.5)
  const area = Math.sqrt(1 - a * a - b * b)
  // « + 0 » : pas de −0 dans les styles écrits.
  return { m11: (1 + a) / area, m12: b / area + 0, m22: (1 - a) / area, dx: dx + 0, dy: dy + 0 }
}
