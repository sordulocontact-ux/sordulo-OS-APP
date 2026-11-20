import { describe, expect, it } from 'vitest'
import { IDLE_WEIGHTS, WORKING_WEIGHTS, gestureAnimation, pickGesture, type MascotGesture } from './mascot'

/** Suite pseudo-aléatoire reproductible. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

describe('gestes du Claude de l’île', () => {
  it('en travail, il varie : plusieurs gestes différents, jamais deux fois de suite le même', () => {
    const rand = seeded(7)
    const seen = new Set<MascotGesture>()
    let previous: MascotGesture | null = null
    for (let i = 0; i < 200; i++) {
      const g = pickGesture(WORKING_WEIGHTS, previous, rand)
      if (g !== 'rest') expect(g).not.toBe(previous)
      seen.add(g)
      previous = g
    }
    expect(seen.size).toBeGreaterThanOrEqual(6)
  })

  it('au repos, il ne fait que regarder ou rester immobile', () => {
    const rand = seeded(3)
    for (let i = 0; i < 100; i++) {
      expect(['lookSide', 'lookUp', 'rest']).toContain(pickGesture(IDLE_WEIGHTS, null, rand))
    }
  })

  it('chaque geste revient à la position de départ', () => {
    const rand = seeded(11)
    const gestures: MascotGesture[] = ['hop', 'doubleHop', 'tilt', 'squash', 'shuffle', 'lookSide', 'lookUp']
    for (const g of gestures) {
      const a = gestureAnimation(g, rand)
      expect(a).not.toBeNull()
      expect(a?.keyframes[0]?.transform).toBe(a?.keyframes[a.keyframes.length - 1]?.transform)
      expect(a?.duration).toBeGreaterThan(0)
    }
    expect(gestureAnimation('rest', rand)).toBeNull()
  })

  it('les regards bougent le visage, les autres gestes la figure', () => {
    const rand = seeded(5)
    expect(gestureAnimation('lookSide', rand)?.target).toBe('face')
    expect(gestureAnimation('hop', rand)?.target).toBe('figure')
  })
})
