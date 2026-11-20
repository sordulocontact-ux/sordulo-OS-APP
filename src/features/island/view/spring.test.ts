import { describe, expect, it } from 'vitest'
import { SPRING, SPRING_MAX_DT_S, opacitySpring } from '../geometry'
import { createSpring, isSpringAtRest, snapSpring, stepSpring, substeps, type Spring } from './spring'

function run(s: Spring, seconds: number, frame = 1 / 60, k: number = SPRING.stiffness, c: number = SPRING.damping) {
  for (let t = 0; t < seconds; t += frame) {
    const { count, h } = substeps(frame)
    for (let i = 0; i < count; i++) stepSpring(s, h, k, c)
  }
}

describe('spring', () => {
  it('converges to its target with the prototype settings', () => {
    const s = createSpring(120)
    s.t = 360
    run(s, 2)
    expect(Math.abs(s.x - s.t)).toBeLessThan(0.01)
    expect(isSpringAtRest(s)).toBe(true)
  })

  it('overshoots a little, like the prototype bounce', () => {
    const s = createSpring(0)
    s.t = 100
    let max = 0
    for (let i = 0; i < 120; i++) {
      run(s, 1 / 60)
      max = Math.max(max, s.x)
    }
    expect(max).toBeGreaterThan(100)
    expect(max).toBeLessThan(110)
  })

  it('does not overshoot with the critically damped opacity spring', () => {
    const s = createSpring(0)
    s.t = 1
    const { stiffness, damping } = opacitySpring()
    let max = 0
    for (let i = 0; i < 120; i++) {
      run(s, 1 / 60, 1 / 60, stiffness, damping)
      max = Math.max(max, s.x)
    }
    expect(max).toBeLessThanOrEqual(1.0001)
    expect(Math.abs(s.x - 1)).toBeLessThan(0.01)
  })

  it('splits a frame into 1/240 s substeps and caps dt', () => {
    expect(substeps(1 / 60)).toEqual({ count: 4, h: 1 / 240 })
    const capped = substeps(1)
    expect(capped.count * capped.h).toBeCloseTo(SPRING_MAX_DT_S)
    expect(substeps(0)).toEqual({ count: 0, h: 0 })
  })

  it('snaps to the target', () => {
    const s = createSpring(0)
    s.t = 5
    s.v = 3
    snapSpring(s)
    expect(s).toEqual({ x: 5, v: 0, t: 5 })
  })
})
