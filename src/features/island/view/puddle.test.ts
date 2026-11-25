import { describe, expect, it } from 'vitest'
import {
  PUDDLE,
  PUDDLE_MAX_RADIUS,
  PUDDLE_POINTS,
  PUDDLE_RADIUS,
  boxRadius,
  createPuddle,
  isPuddleAtRest,
  pointAngle,
  puddleLag,
  puddlePath,
  puddleTarget,
  relaxPuddle,
  resetPuddle,
  setPuddleTargets,
  splatPuddle,
  stepPuddle,
  type Puddle,
} from './puddle'
import { substeps } from './spring'

function run(p: Puddle, seconds: number, motion?: { vx: number; vy: number }) {
  const frame = 1 / 60
  for (let t = 0; t < seconds; t += frame) {
    if (motion) setPuddleTargets(p, frame, motion.vx, motion.vy)
    const { count, h } = substeps(frame)
    for (let k = 0; k < count; k++) stepPuddle(p, h)
  }
}

describe('puddle', () => {
  it('stays close to a circle at rest, irregular but not wild', () => {
    for (let i = 0; i < PUDDLE_POINTS; i++) {
      const r = puddleTarget(pointAngle(i), 1.3, 0, 0)
      expect(Math.abs(r - PUDDLE_RADIUS)).toBeLessThan(PUDDLE_RADIUS * 0.15)
    }
  })

  it('stretches behind the motion and flattens a bit in front, within the window', () => {
    const back = puddleTarget(Math.PI, 0, 1500, 0)
    const front = puddleTarget(0, 0, 1500, 0)
    expect(back).toBeGreaterThan(PUDDLE_RADIUS * 1.4)
    expect(front).toBeLessThan(PUDDLE_RADIUS)
    expect(puddleTarget(Math.PI, 0, 100_000, 0)).toBeLessThanOrEqual(PUDDLE_MAX_RADIUS)
  })

  it('trails behind the cursor, then comes back under it', () => {
    const p = createPuddle()
    run(p, 1, { vx: 1000, vy: 0 })
    expect(puddleLag(p, 1).dx).toBeLessThan(-4)
    expect(Math.hypot(puddleLag(p, 1).dx, puddleLag(p, 1).dy)).toBeLessThanOrEqual(PUDDLE.maxLag + 0.5)
    expect(puddleLag(p, 0)).toEqual({ dx: 0, dy: 0 })
    relaxPuddle(p)
    run(p, 4)
    expect(isPuddleAtRest(p)).toBe(true)
  })

  it('wobbles while dragged, then settles back to a circle', () => {
    const p = createPuddle()
    run(p, 1, { vx: 800, vy: 300 })
    expect(p.radii.some((s) => Math.abs(s.x - PUDDLE_RADIUS) > 3)).toBe(true)
    relaxPuddle(p)
    run(p, 10)
    expect(isPuddleAtRest(p)).toBe(true)
  })

  it('splats: the points facing the edge go in, those on the sides spread', () => {
    const p = createPuddle()
    // Bord en haut : direction (0, −1).
    splatPuddle(p, 0, -1, 1500)
    const up = p.radii[Math.round((3 * PUDDLE_POINTS) / 4)]
    const side = p.radii[0]
    expect(up?.v).toBeLessThan(0)
    expect(side?.v).toBeGreaterThan(0)
    resetPuddle(p)
    expect(isPuddleAtRest(p)).toBe(true)
  })

  it('measures a rounded box in every direction', () => {
    const box = { a: 60, b: 20, radius: () => 20 }
    expect(boxRadius(box, 0)).toBeCloseTo(60, 6)
    expect(boxRadius(box, Math.PI / 2)).toBeCloseTo(20, 6)
    const diag = Math.atan2(20, 60)
    expect(boxRadius(box, diag)).toBeLessThan(Math.hypot(60, 20))
    // Coins carrés côté bord : le coin pointu.
    const square = { a: 60, b: 20, radius: (_sx: number, sy: number) => (sy < 0 ? 0 : 20) }
    expect(boxRadius(square, -diag)).toBeCloseTo(Math.hypot(60, 20), 6)
  })

  it('draws a closed smooth path', () => {
    const d = puddlePath(22, 22, () => PUDDLE_RADIUS)
    expect(d.startsWith('M44 22')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d.match(/C/g)).toHaveLength(PUDDLE_POINTS)
  })
})
