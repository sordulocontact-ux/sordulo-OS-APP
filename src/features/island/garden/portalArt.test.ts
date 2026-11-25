import { describe, expect, it } from 'vitest'
import { PORTAL_CORE, PORTAL_FLOW, PORTAL_FLOW_FRAMES, PORTAL_GRID, PORTAL_RIM, type PortalCell } from './portalArt'

const cellsOf = (rects: readonly PortalCell[]) =>
  rects.flatMap(([x, y, w, h]) => Array.from({ length: w * h }, (_, i) => `${x + (i % w)},${y + Math.floor(i / w)}`))

describe('portail en pixel art', () => {
  it('anneau et cœur ne se recouvrent pas et restent dans la grille', () => {
    const rim = cellsOf(PORTAL_RIM)
    const core = cellsOf(PORTAL_CORE)
    expect(rim.filter((c) => core.includes(c))).toEqual([])
    for (const c of [...rim, ...core]) {
      const [x, y] = c.split(',').map(Number)
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(PORTAL_GRID.w)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThan(PORTAL_GRID.h)
    }
  })

  it('reflets : quatre images, toutes dans le cœur, décalées d’une rangée chacune', () => {
    expect(PORTAL_FLOW).toHaveLength(PORTAL_FLOW_FRAMES)
    const core = new Set(cellsOf(PORTAL_CORE))
    for (const frame of PORTAL_FLOW) {
      expect(frame.length).toBeGreaterThan(4)
      for (const c of cellsOf(frame)) expect(core.has(c)).toBe(true)
    }
    // L'image suivante = la précédente une rangée plus bas (hors bords du cœur).
    const [first = [], second = []] = PORTAL_FLOW
    const shifted = new Set(
      cellsOf(first).map((c) => {
        const [x = 0, y = 0] = c.split(',').map(Number)
        return `${x},${y + 1}`
      }),
    )
    const next = cellsOf(second).filter((c) => Number(c.split(',')[1]) > 3 && Number(c.split(',')[1]) < 11)
    for (const c of next) expect(shifted.has(c)).toBe(true)
  })
})
