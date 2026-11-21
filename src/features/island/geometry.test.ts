import { describe, expect, it } from 'vitest'
import {
  BUBBLE_GAP,
  ISLAND_SIZES,
  RING,
  WAVE,
  edgeFor,
  hitRectsFor,
  layerSizeKeyFor,
  progressRatio,
  ringDashOffset,
  shapeGeometry,
  sharedPosition,
  MEET_BACKGROUND,
  MUSIC_OPEN,
  islandSize,
  sizeKeyFor,
  waveBarHeight,
} from './geometry'
import type { IslandState } from './types'

describe('sizeKeyFor', () => {
  it('maps hover like the prototype currentKey', () => {
    expect(sizeKeyFor('repos', true, false)).toBe('peek')
    expect(sizeKeyFor('agent', true, false)).toBe('agentOpen')
    expect(sizeKeyFor('multi', true, false)).toBe('multiOpen')
    expect(sizeKeyFor('meet', true, false)).toBe('meetOpen')
  })

  it('opens the music on hover', () => {
    expect(sizeKeyFor('music', true, false)).toBe('musicOpen')
    expect(sizeKeyFor('music', false, false)).toBe('music')
  })

  it('keeps the state without hover', () => {
    const states: IslandState[] = ['repos', 'appel', 'meet', 'music', 'progress', 'agent', 'multi', 'dragWake', 'dragOver']
    for (const s of states) expect(sizeKeyFor(s, false, false)).toBe(s)
  })

  it('uses the call variants for notif and agentAsk during a call', () => {
    expect(sizeKeyFor('notif', false, true)).toBe('notifCall')
    expect(sizeKeyFor('notif', true, true)).toBe('notifCall')
    expect(sizeKeyFor('agentAsk', false, true)).toBe('agentAskCall')
    expect(sizeKeyFor('notif', false, false)).toBe('notif')
    expect(sizeKeyFor('agentAsk', true, false)).toBe('agentAsk')
  })

  it('does not open other states on hover', () => {
    expect(sizeKeyFor('progress', true, false)).toBe('progress')
    expect(sizeKeyFor('appel', true, false)).toBe('appel')
  })
})

describe('layerSizeKeyFor', () => {
  it('sizes layers at their open size', () => {
    expect(layerSizeKeyFor('agent', false)).toBe('agentOpen')
    expect(layerSizeKeyFor('multi', false)).toBe('multiOpen')
    expect(layerSizeKeyFor('meet', false)).toBe('meetOpen')
    expect(layerSizeKeyFor('music', false)).toBe('musicOpen')
    expect(layerSizeKeyFor('notif', true)).toBe('notifCall')
    expect(layerSizeKeyFor('repos', false)).toBe('repos')
  })
})

describe('ISLAND_SIZES', () => {
  it('copies the prototype values', () => {
    expect(ISLAND_SIZES.win.repos).toEqual({ w: 120, h: 8, r: 4 })
    expect(ISLAND_SIZES.win.agentAskCall).toEqual({ w: 380, h: 196, r: 26 })
    expect(ISLAND_SIZES.mac.multiOpen).toEqual({ w: 420, h: 250, r: 26 })
  })

  it('gives meetOpen the agentOpen dimensions', () => {
    expect(ISLAND_SIZES.win.meetOpen).toEqual(ISLAND_SIZES.win.agentOpen)
    expect(ISLAND_SIZES.mac.meetOpen).toEqual(ISLAND_SIZES.mac.agentOpen)
  })
})

describe('musicOpen', () => {
  it('drops the progress row when the player gives no progress', () => {
    for (const platform of ['win', 'mac'] as const) {
      const full = islandSize(platform, 'musicOpen')
      expect(full).toEqual(ISLAND_SIZES[platform].musicOpen)
      expect(islandSize(platform, 'musicOpen', 0, false)).toEqual({ ...full, h: full.h - MUSIC_OPEN.progressRow })
    }
    expect(islandSize('win', 'agentOpen', 0, false)).toEqual(ISLAND_SIZES.win.agentOpen)
  })

  it('grows the cover from the compact island to the open view, below the notch on Mac', () => {
    const ctx = { hasGarden: true, sessionCount: 0 }
    expect(sharedPosition('musicCover', 'win', 'music', ctx)).toEqual({ x: 13, y: 6, s: 28 })
    expect(sharedPosition('musicCover', 'win', 'musicOpen', ctx)?.s).toBe(MUSIC_OPEN.coverSize)
    expect(sharedPosition('musicCover', 'mac', 'musicOpen', ctx)?.y).toBeGreaterThanOrEqual(ISLAND_SIZES.mac.repos.h)
    expect(sharedPosition('musicEq', 'mac', 'musicOpen', ctx)).not.toBeNull()
    expect(sharedPosition('musicCover', 'win', 'agent', ctx)).toBeNull()
  })

  it('fits the cover, progress and controls in the open shape', () => {
    // Haut (16 Windows, 44 Mac) + pochette + progression + écart 6 + boutons 32 + bas 14.
    expect(ISLAND_SIZES.win.musicOpen.h).toBe(16 + MUSIC_OPEN.coverSize + MUSIC_OPEN.progressRow + 6 + 32 + 14)
    expect(ISLAND_SIZES.mac.musicOpen.h).toBe(44 + MUSIC_OPEN.coverSize + MUSIC_OPEN.progressRow + 6 + 32 + 14)
  })
})

describe('shapeGeometry', () => {
  it('builds the prototype path for the resting line', () => {
    const g = shapeGeometry(120, 8, 4, 'win')
    expect(g.edge).toBe(4)
    expect(g.width).toBe(128)
    expect(g.d).toBe('M0 0H128A4 4 0 0 0 124 4V4A4 4 0 0 1 120 8H8A4 4 0 0 1 4 4V4A4 4 0 0 0 0 0Z')
  })

  it('caps the concave edge at 10 px on Windows and 8 px on Mac', () => {
    expect(edgeFor('win', 40)).toBe(10)
    expect(edgeFor('mac', 40)).toBe(8)
    expect(edgeFor('win', 8)).toBe(4)
    const g = shapeGeometry(193, 40, 14, 'win')
    expect(g.width).toBe(213)
    expect(g.d).toBe('M0 0H213A10 10 0 0 0 203 10V26A14 14 0 0 1 189 40H24A14 14 0 0 1 10 26V10A10 10 0 0 0 0 0Z')
  })

  it('clamps the bottom radius to the height and the width', () => {
    expect(shapeGeometry(193, 20, 30, 'win').radius).toBe(10)
    expect(shapeGeometry(10, 100, 30, 'win').radius).toBe(5)
    expect(shapeGeometry(100, 0, 4, 'win').height).toBe(1)
  })
})

describe('sharedPosition', () => {
  const ctx = { hasGarden: true, sessionCount: 5 }

  it('returns the SH positions of the prototype', () => {
    expect(sharedPosition('agentIcon', 'win', 'agentOpen', ctx)).toEqual({ x: 16, y: 17, s: 28 })
    expect(sharedPosition('dots', 'win', 'agentOpen', ctx)).toEqual({ x: 23, y: 29, o: 0 })
    expect(sharedPosition('seg3', 'win', 'multiOpen', ctx)).toEqual({ x: 16, y: 158 })
    expect(sharedPosition('timer', 'mac', 'notifCall', ctx)).toEqual({ x: 14, y: 9 })
    expect(sharedPosition('dots', 'win', 'repos', ctx)).toBeNull()
  })

  it('places the call elements in meetOpen', () => {
    expect(sharedPosition('meetGroup', 'win', 'meetOpen', ctx)).toEqual({ x: 16, y: 64 })
    expect(sharedPosition('timer', 'win', 'meetOpen', ctx)).toEqual({ x: 16, y: 24 })
  })

  it('hides status dots beyond the session count', () => {
    expect(sharedPosition('seg2', 'win', 'multiOpen', { hasGarden: true, sessionCount: 2 })).toBeNull()
    expect(sharedPosition('seg1', 'win', 'multiOpen', { hasGarden: true, sessionCount: 2 })).not.toBeNull()
  })

  it('shows count and right-aligned dots in multi without garden', () => {
    const noGarden = { hasGarden: false, sessionCount: 3 }
    expect(sharedPosition('count', 'win', 'multi', noGarden)).toEqual({ x: 41, y: 13 })
    expect(sharedPosition('seg2', 'win', 'multi', noGarden)).toEqual({ x: 193 - 13 - 6, y: 17 })
    expect(sharedPosition('seg0', 'win', 'multi', noGarden)).toEqual({ x: 193 - 13 - 6 - 20, y: 17 })
    expect(sharedPosition('count', 'win', 'multi', ctx)).toBeNull()
  })
})

describe('progress ring', () => {
  it('shows the real fraction as is', () => {
    expect(progressRatio({ fraction: 0.4, startedAt: 0, estimatedMs: 1000 }, 999_999)).toBe(0.4)
    expect(ringDashOffset(1)).toBe(0)
    expect(ringDashOffset(0)).toBeCloseTo(RING.circumference)
  })

  it('eases the estimate and stops before the end', () => {
    const at = (now: number) => progressRatio({ fraction: null, startedAt: 0, estimatedMs: 1000 }, now)
    expect(at(0)).toBe(0)
    expect(at(500)).toBeCloseTo(1 - Math.pow(0.5, RING.easePower))
    expect(at(5000)).toBe(RING.estimateCap)
  })
})

describe('waveBarHeight', () => {
  it('maps 0..1 to 1..14 px', () => {
    expect(waveBarHeight(0)).toBe(WAVE.minHeight)
    expect(waveBarHeight(1)).toBe(WAVE.maxHeight)
    expect(waveBarHeight(2)).toBe(WAVE.maxHeight)
    expect(waveBarHeight(0.5)).toBe(8)
  })
})

describe('hitRectsFor', () => {
  it('centers the island at the top of the root', () => {
    const size = ISLAND_SIZES.win.repos
    expect(hitRectsFor({ rootWidth: 1000, platform: 'win', island: { current: size, target: size }, bubble: null })).toEqual([
      { x: 436, y: 0, width: 128, height: 8 },
    ])
  })

  it('covers both the current and the target shape during a transition', () => {
    const [rect] = hitRectsFor({
      rootWidth: 1000,
      platform: 'win',
      island: { current: ISLAND_SIZES.win.repos, target: ISLAND_SIZES.win.agentOpen },
      bubble: null,
    })
    expect(rect).toEqual({ x: 310, y: 0, width: 380, height: 96 })
  })

  it('adds the bubble right of the island', () => {
    const size = ISLAND_SIZES.win.meet
    const rects = hitRectsFor({
      rootWidth: 1000,
      platform: 'win',
      island: { current: size, target: size },
      bubble: { current: { w: 44, h: 40 }, target: { w: 44, h: 40 } },
    })
    // Île 213 px de large centrée sur 500, écart de 4 px, bulle 44 + 2 × 10 = 64 px, arrondie vers l'extérieur.
    expect(BUBBLE_GAP).toBe(4)
    expect(rects[1]).toEqual({ x: 610, y: 0, width: 65, height: 40 })
  })
})

describe('islandSize', () => {
  it('meetOpen grandit d’une ligne à la fois, 3 au plus, et tient dans la fenêtre de l’île', () => {
    const base = ISLAND_SIZES.win.meetOpen
    expect(islandSize('win', 'meetOpen', 0)).toEqual(base)
    expect(islandSize('win', 'meetOpen', 1).h).toBe(base.h + MEET_BACKGROUND.win.gap + MEET_BACKGROUND.win.rowH)
    expect(islandSize('win', 'meetOpen', 9)).toEqual(islandSize('win', 'meetOpen', MEET_BACKGROUND.maxRows))
    expect(islandSize('mac', 'meetOpen', 9).h).toBeLessThanOrEqual(260)
  })

  it('les autres tailles ignorent les lignes', () => {
    expect(islandSize('win', 'meet', 3)).toEqual(ISLAND_SIZES.win.meet)
    expect(islandSize('win', 'agentOpen', 3)).toEqual(ISLAND_SIZES.win.agentOpen)
  })
})
