import { describe, expect, it } from 'vitest'
import {
  BUBBLE_GAP,
  COMPACT_SIZE_KEYS,
  VERTICAL_PILL_LENGTH,
  DRAG_THRESHOLD_PX,
  edgeFrameSize,
  edgePlatform,
  edgeShapeGeometry,
  isDragMove,
  isVerticalLayout,
  islandBoxPosition,
  sharedPlacement,
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
import type { IslandEdge, IslandSizeKey, IslandState } from './types'

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

  it('keeps the music shape when the Claude walk in front of it, and still opens it on hover', () => {
    expect(sizeKeyFor('music', false, false, true)).toBe('musicGarden')
    expect(sizeKeyFor('music', true, false, true)).toBe('musicOpen')
    expect(sizeKeyFor('multi', false, false, true)).toBe('multi')
    for (const platform of ['win', 'mac'] as const) {
      // L'île ne grandit pas : les Claude passent devant la pochette et l'égaliseur.
      expect(ISLAND_SIZES[platform].musicGarden).toEqual(ISLAND_SIZES[platform].music)
      expect(sharedPosition('musicCover', platform, 'musicGarden', { hasGarden: true, sessionCount: 1 })).toEqual(
        sharedPosition('musicCover', platform, 'music', { hasGarden: true, sessionCount: 1 }),
      )
    }
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
  it('drops the controls row when the island cannot control the player', () => {
    for (const platform of ['win', 'mac'] as const) {
      const full = islandSize(platform, 'musicOpen', 0, true, true).h
      expect(islandSize(platform, 'musicOpen', 0, true, false).h).toBe(full - MUSIC_OPEN.controlsRow)
    }
  })

  it('adds one line per Claude session under the music, like under the call', () => {
    for (const platform of ['win', 'mac'] as const) {
      const base = islandSize(platform, 'musicOpen', 0, true).h
      const { rowH, gap } = MEET_BACKGROUND[platform]
      expect(islandSize(platform, 'musicOpen', 2, true).h).toBe(base + gap + 2 * rowH)
      expect(islandSize(platform, 'musicOpen', 2, false).h).toBe(base - MUSIC_OPEN.progressRow + gap + 2 * rowH)
    }
  })

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
    expect(sharedPosition('musicCover', 'win', 'music', ctx)).toEqual({ x: 8, y: 8, s: 24 })
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

  it('shows no call element for a Claude question outside a call', () => {
    for (const platform of ['win', 'mac'] as const) {
      expect(sharedPosition('meetGroup', platform, 'agentQuestion', ctx)).toBeNull()
      expect(sharedPosition('timer', platform, 'agentQuestion', ctx)).toBeNull()
      expect(sharedPosition('agentIcon', platform, 'agentQuestion', ctx)).toEqual(
        sharedPosition('agentIcon', platform, 'agentAsk', ctx),
      )
      expect(ISLAND_SIZES[platform].agentQuestion).toEqual(ISLAND_SIZES[platform].agentAskCall)
    }
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

describe('goutte du glisser (detach)', () => {
  it('garde la forme collée au bord à 0 et devient un rond détaché à 1', () => {
    expect(shapeGeometry(193, 40, 14, 'win', 0)).toEqual(shapeGeometry(193, 40, 14, 'win'))
    const blob = shapeGeometry(44, 44, 22, 'win', 1)
    expect(blob.edge).toBe(0)
    expect(blob.cap).toBe(22)
    expect(blob.radius).toBe(22)
    expect(blob.width).toBe(44)
    // À mi-chemin : ni arrondi concave, ni coin côté bord (le chemin reste continu).
    const half = shapeGeometry(193, 40, 14, 'win', 0.5)
    expect(half.edge).toBe(0)
    expect(half.cap).toBe(0)
    // Premier quart : les arrondis concaves ont rentré de moitié.
    expect(shapeGeometry(193, 40, 14, 'win', 0.25).edge).toBe(5)
  })

  it('se détache aussi sur les autres bords', () => {
    for (const edge of ['bottom', 'left', 'right'] as const) {
      const g = edgeShapeGeometry(44, 44, 22, 'win', edge, 1)
      expect(g.width).toBe(44)
      expect(g.height).toBe(44)
      expect(g.d).not.toContain('NaN')
    }
  })
})

describe('edges', () => {
  const root = { width: 1000, height: 600 }

  it('keeps the top path exactly as the prototype', () => {
    for (const [w, h, r] of [
      [120, 8, 4],
      [193, 40, 14],
      [384, 116, 24],
    ] as const) {
      for (const platform of ['win', 'mac'] as const) {
        const top = edgeShapeGeometry(w, h, r, platform, 'top')
        const ref = shapeGeometry(w, h, r, platform)
        expect(top.d).toBe(ref.d)
        expect([top.width, top.height]).toEqual([ref.width, ref.height])
        expect(top.content).toEqual({ x: ref.edge, y: 0, width: w, height: ref.height })
      }
    }
  })

  it('mirrors the shape at the bottom: straight edge and concave corners below, round corners above', () => {
    const g = edgeShapeGeometry(193, 40, 14, 'win', 'bottom')
    expect([g.width, g.height]).toEqual([213, 40])
    expect(g.d).toBe(
      'M0 40L213 40A10 10 0 0 1 203 30L203 14A14 14 0 0 0 189 0L24 0A14 14 0 0 0 10 14L10 30A10 10 0 0 1 0 40Z',
    )
    expect(g.content).toEqual({ x: 10, y: 0, width: 193, height: 40 })
  })

  it('stands the pill up on the left: straight edge on the left, round corners on the right', () => {
    const g = edgeShapeGeometry(193, 40, 14, 'win', 'left')
    expect([g.width, g.height]).toEqual([40, 213])
    expect(g.d).toBe(
      'M0 0L0 213A10 10 0 0 1 10 203L26 203A14 14 0 0 0 40 189L40 24A14 14 0 0 0 26 10L10 10A10 10 0 0 1 0 0Z',
    )
    expect(g.content).toEqual({ x: 0, y: 10, width: 40, height: 193 })
  })

  it('stands the pill up on the right: straight edge on the right, round corners on the left', () => {
    const g = edgeShapeGeometry(193, 40, 14, 'win', 'right')
    expect([g.width, g.height]).toEqual([40, 213])
    expect(g.d).toBe(
      'M40 0L40 213A10 10 0 0 0 30 203L14 203A14 14 0 0 1 0 189L0 24A14 14 0 0 1 14 10L30 10A10 10 0 0 0 40 0Z',
    )
  })

  it('never draws the notch away from the top edge', () => {
    expect(edgePlatform('mac', 'top')).toBe('mac')
    for (const edge of ['bottom', 'left', 'right'] as const) {
      expect(edgePlatform('mac', edge)).toBe('win')
      expect(edgeShapeGeometry(193, 40, 14, 'mac', edge).edge).toBe(10)
    }
  })

  it('places the box in the middle of each edge', () => {
    const box = { width: 40, height: 213 }
    expect(islandBoxPosition('top', { width: 213, height: 40 }, root)).toEqual({ x: 393.5, y: 0 })
    expect(islandBoxPosition('bottom', { width: 213, height: 40 }, root)).toEqual({ x: 393.5, y: 560 })
    expect(islandBoxPosition('left', box, root)).toEqual({ x: 0, y: 193.5 })
    expect(islandBoxPosition('right', box, root)).toEqual({ x: 960, y: 193.5 })
  })

  it('stands compact states up and keeps open states as horizontal cards on the sides', () => {
    const all = Object.keys(ISLAND_SIZES.win) as IslandSizeKey[]
    for (const key of all) {
      const size = ISLAND_SIZES.win[key]
      const compact = COMPACT_SIZE_KEYS.has(key)
      for (const edge of ['top', 'bottom'] as const) {
        expect(isVerticalLayout(edge, key)).toBe(false)
        expect(edgeFrameSize(size, edge, key)).toEqual(size)
      }
      for (const edge of ['left', 'right'] as const) {
        expect(isVerticalLayout(edge, key)).toBe(compact)
        const frame = edgeFrameSize(size, edge, key)
        const g = edgeShapeGeometry(frame.w, frame.h, frame.r, 'win', edge)
        if (compact) {
          // Pilule verticale : la boîte de l'état, transposée et raccourcie (VERTICAL_PILL_LENGTH).
          expect(g.width).toBe(size.h)
          expect(g.height).toBe((VERTICAL_PILL_LENGTH[key] ?? size.w) + 2 * g.edge)
          expect(VERTICAL_PILL_LENGTH[key] ?? size.w).toBeLessThan(size.w)
        } else {
          // Carte horizontale de la taille normale, contenu identique au haut.
          expect(g.content.width).toBe(size.w)
          expect(g.content.height).toBe(size.h)
        }
      }
    }
    expect([...COMPACT_SIZE_KEYS].sort()).toEqual(
      ['agent', 'dragWake', 'meet', 'multi', 'music', 'musicGarden', 'peek', 'progress', 'repos'].sort(),
    )
  })

  it('starts a drag beyond the threshold only', () => {
    expect(DRAG_THRESHOLD_PX).toBe(6)
    expect(isDragMove(6, 0)).toBe(false)
    expect(isDragMove(4, 4)).toBe(false)
    expect(isDragMove(5, 4)).toBe(true)
    expect(isDragMove(0, -7)).toBe(true)
  })
})

describe('sharedPlacement', () => {
  const ctx = { hasGarden: true, sessionCount: 3 }

  it('keeps the top placement of SHARED_ELEMENTS', () => {
    expect(sharedPlacement('timer', 'win', 'meet', ctx)).toEqual({ h: 'right', x: 13, v: 'top', y: 13 })
    expect(sharedPlacement('agentIcon', 'mac', 'agent', ctx, 'top')).toEqual({ h: 'left', x: 13, v: 'top', y: 6, s: 20 })
  })

  it('measures from the bottom at the bottom edge (same distance to the screen edge), win sizes even on Mac', () => {
    expect(sharedPlacement('meetGroup', 'win', 'meet', ctx, 'bottom')).toEqual({ h: 'left', x: 13, v: 'bottom', y: 12 })
    expect(sharedPlacement('agentIcon', 'mac', 'agent', ctx, 'bottom')).toEqual({ h: 'left', x: 13, v: 'bottom', y: 9, s: 22 })
  })

  it('transposes compact elements in the vertical pill', () => {
    // Gauche : x' = y depuis la gauche, y' = x depuis le haut (ancré à gauche) ou le bas (ancré à droite).
    expect(sharedPlacement('agentIcon', 'win', 'agent', ctx, 'left')).toEqual({ h: 'left', x: 9, v: 'top', y: 13, s: 22 })
    expect(sharedPlacement('musicCover', 'win', 'music', ctx, 'left')).toEqual({ h: 'left', x: 8, v: 'top', y: 8, s: 24 })
    expect(sharedPlacement('dropIcon', 'win', 'dragWake', ctx, 'left')).toEqual({ h: 'left', x: 13, v: 'top', y: 16 })
    // Droite : mesuré depuis la droite (x' = largeur − y − taille).
    expect(sharedPlacement('agentIcon', 'mac', 'agent', ctx, 'right')).toEqual({ h: 'right', x: 9, v: 'top', y: 13, s: 22 })
    expect(sharedPlacement('meetGroup', 'win', 'meet', ctx, 'right')).toEqual({ h: 'right', x: 12, v: 'top', y: 13 })
  })

  it('centers across the pill the elements wider than their transposed place', () => {
    expect(sharedPlacement('timer', 'win', 'meet', ctx, 'left', 30)).toEqual({ h: 'left', x: 5, v: 'bottom', y: 13 })
    expect(sharedPlacement('musicEq', 'win', 'music', ctx, 'right', 23)).toEqual({ h: 'right', x: 8.5, v: 'bottom', y: 11 })
    expect(sharedPlacement('dots', 'win', 'agent', ctx, 'left', 18)).toEqual({ h: 'left', x: 11, v: 'bottom', y: 13 })
  })

  it('keeps open states laid out as at the top on the sides', () => {
    for (const edge of ['left', 'right'] as IslandEdge[]) {
      expect(sharedPlacement('timer', 'mac', 'meetOpen', ctx, edge)).toEqual({ h: 'right', x: 16, v: 'top', y: 24 })
      expect(sharedPlacement('seg2', 'win', 'multiOpen', ctx, edge)).toEqual({ h: 'left', x: 16, v: 'top', y: 128 })
    }
  })

  it('fits every compact element inside the vertical pill', () => {
    const sizes: Partial<Record<string, number>> = { timer: 30, musicEq: 23, dots: 18, count: 8, meetGroup: 16, dropIcon: 18, seg0: 6, seg1: 6, seg2: 6 }
    const noGarden = { hasGarden: false, sessionCount: 3 }
    for (const key of COMPACT_SIZE_KEYS) {
      const pill = ISLAND_SIZES.win[key]
      for (const id of ['meetGroup', 'timer', 'agentIcon', 'dots', 'count', 'seg0', 'seg1', 'seg2', 'dropIcon', 'musicCover', 'musicEq'] as const) {
        const p = sharedPlacement(id, 'win', key, noGarden, 'left', sizes[id] ?? 0)
        if (!p || p.o === 0) continue
        const size = p.s ?? sizes[id] ?? 0
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x + size).toBeLessThanOrEqual(pill.h)
        expect(p.y).toBeLessThanOrEqual(pill.w)
      }
    }
  })
})

describe('hitRectsFor on every edge', () => {
  const size = ISLAND_SIZES.win.meet
  const at = (edge: IslandEdge, current = size, target = size) =>
    hitRectsFor({ rootWidth: 520, rootHeight: 480, edge, platform: 'mac', island: { current, target }, bubble: null })

  it('sticks the rect to the edge, in the middle', () => {
    expect(at('bottom')).toEqual([{ x: 153, y: 440, width: 214, height: 40 }])
    expect(at('left')).toEqual([{ x: 0, y: 133, width: 40, height: 214 }])
    expect(at('right')).toEqual([{ x: 480, y: 133, width: 40, height: 214 }])
  })

  it('covers the pill and the open card during the transition on the sides', () => {
    const card = edgeFrameSize(ISLAND_SIZES.win.meetOpen, 'left', 'meetOpen')
    expect(card).toEqual({ w: 96, h: 360, r: 24 })
    // Pilule 40 × 213 et carte 360 × 116 : union 360 × 213, centrée verticalement.
    expect(at('left', size, card)).toEqual([{ x: 0, y: 133, width: 360, height: 214 }])
    expect(at('right', size, card)).toEqual([{ x: 160, y: 133, width: 360, height: 214 }])
  })

  it('ignores the bubble away from the top', () => {
    const rects = hitRectsFor({
      rootWidth: 640,
      rootHeight: 300,
      edge: 'bottom',
      platform: 'win',
      island: { current: size, target: size },
      bubble: { current: { w: 44, h: 40 }, target: { w: 44, h: 40 } },
    })
    expect(rects).toHaveLength(1)
  })
})
