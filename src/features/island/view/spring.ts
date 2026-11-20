/**
 * Ressort amorti du prototype (stepSpring, frame) : intégration d'Euler semi-implicite par sous-pas de 1/240 s,
 * pas d'image plafonné à 0,034 s. Les réglages viennent de ../geometry.
 */
import { SPRING_MAX_DT_S, SPRING_REST_EPSILON, SPRING_SUBSTEP_S } from '../geometry'

export interface Spring {
  /** Valeur courante. */
  x: number
  /** Vitesse. */
  v: number
  /** Cible. */
  t: number
}

export function createSpring(value: number): Spring {
  return { x: value, v: 0, t: value }
}

/** Un sous-pas h (s) : accélération -k(x - t) - c·v. */
export function stepSpring(s: Spring, h: number, stiffness: number, damping: number): void {
  const a = -stiffness * (s.x - s.t) - damping * s.v
  s.v += a * h
  s.x += s.v * h
}

/** Découpe une image en sous-pas : dt plafonné, n = ⌈dt / (1/240)⌉, h = dt / n. */
export function substeps(dtSeconds: number): { count: number; h: number } {
  const dt = Math.max(0, Math.min(SPRING_MAX_DT_S, dtSeconds))
  const count = Math.ceil(dt / SPRING_SUBSTEP_S)
  return { count, h: count > 0 ? dt / count : 0 }
}

/** Vrai quand le ressort est assez près de sa cible et assez lent pour être calé dessus. */
export function isSpringAtRest(s: Spring, epsilon: number = SPRING_REST_EPSILON): boolean {
  return Math.abs(s.x - s.t) < epsilon && Math.abs(s.v) < epsilon
}

/** Cale le ressort sur sa cible, sans vitesse (repos, ou prefers-reduced-motion). */
export function snapSpring(s: Spring): void {
  s.x = s.t
  s.v = 0
}
