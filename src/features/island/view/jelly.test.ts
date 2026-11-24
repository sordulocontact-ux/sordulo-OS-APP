import { describe, expect, it } from 'vitest'
import { JELLY } from '../geometry'
import { createJelly, isJellyAtRest, jellyTransform, resetJelly, setJellyVelocity, stepJelly, type Jelly } from './jelly'
import { substeps } from './spring'

function run(j: Jelly, seconds: number, frame = 1 / 60) {
  for (let t = 0; t < seconds; t += frame) {
    const { count, h } = substeps(frame)
    for (let i = 0; i < count; i++) stepJelly(j, h)
  }
}

/** Échelles le long des axes x et y (valeurs propres pour une matrice diagonale). */
function scales(j: Jelly, amount = 1) {
  const m = jellyTransform(j, amount)
  return { x: m.m11, y: m.m22, shear: m.m12, dx: m.dx, dy: m.dy }
}

describe('jelly', () => {
  it('is a plain circle at rest', () => {
    const m = jellyTransform(createJelly(), 1)
    expect(m).toEqual({ m11: 1, m12: 0, m22: 1, dx: 0, dy: 0 })
  })

  it('stretches along the motion and trails behind it', () => {
    const j = createJelly()
    setJellyVelocity(j, { vx: 1000, vy: 0 })
    run(j, 1.5)
    const s = scales(j)
    expect(s.x).toBeGreaterThan(1.15)
    expect(s.y).toBeLessThan(0.85)
    expect(s.x * s.y).toBeCloseTo(1, 5)
    expect(s.dx).toBeLessThan(-4)
    expect(Math.abs(s.dy)).toBeLessThan(0.01)
  })

  it('stretches vertically for a vertical motion and diagonally for a diagonal one', () => {
    const v = createJelly()
    setJellyVelocity(v, { vx: 0, vy: -900 })
    run(v, 1.5)
    expect(scales(v).y).toBeGreaterThan(scales(v).x)
    const d = createJelly()
    setJellyVelocity(d, { vx: 700, vy: 700 })
    run(d, 1.5)
    const m = jellyTransform(d, 1)
    // Axe (1, 1) étiré : m11 · 1 + m12 · 1 > 1 + écart.
    expect(m.m11 + m.m12).toBeGreaterThan(1.15)
    expect(m.m11 - m.m12).toBeLessThan(0.85)
  })

  it('caps the stretch for very fast throws', () => {
    const j = createJelly()
    setJellyVelocity(j, { vx: 50_000, vy: 0 })
    run(j, 2)
    // Étirement maximal, aire du rond gardée : (1 + m) / √(1 − m²).
    const max = (1 + JELLY.maxStretch) / Math.sqrt(1 - JELLY.maxStretch ** 2)
    expect(scales(j).x).toBeLessThan(max + 0.01)
    expect(Math.hypot(scales(j).dx, scales(j).dy)).toBeLessThanOrEqual(JELLY.maxLag + 1e-9)
  })

  it('squashes along the motion when it stops, then settles', () => {
    const j = createJelly()
    setJellyVelocity(j, { vx: 1200, vy: 0 })
    run(j, 1.5)
    setJellyVelocity(j, null)
    let minX = Infinity
    for (let i = 0; i < 30; i++) {
      run(j, 1 / 60)
      minX = Math.min(minX, scales(j).x)
    }
    expect(minX).toBeLessThan(0.93)
    run(j, 3)
    expect(isJellyAtRest(j)).toBe(true)
  })

  it('does not deform an island glued to its edge', () => {
    const j = createJelly()
    setJellyVelocity(j, { vx: 1000, vy: 400 })
    run(j, 1)
    expect(jellyTransform(j, 0)).toEqual({ m11: 1, m12: 0, m22: 1, dx: 0, dy: 0 })
  })

  it('ignores a broken velocity and resets without animation', () => {
    const j = createJelly()
    setJellyVelocity(j, { vx: Number.NaN, vy: Infinity })
    run(j, 0.5)
    expect(isJellyAtRest(j)).toBe(true)
    setJellyVelocity(j, { vx: 800, vy: 0 })
    run(j, 0.2)
    resetJelly(j)
    expect(jellyTransform(j, 1)).toEqual({ m11: 1, m12: 0, m22: 1, dx: 0, dy: 0 })
  })
})
