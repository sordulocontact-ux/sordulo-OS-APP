import { describe, expect, it } from 'vitest'
import type { ClaudeActivity } from '../types'
import {
  REST_TRANSFORM,
  SCENES,
  VARIATION_WEIGHTS,
  activityScene,
  allowedVariations,
  detectMoment,
  momentScene,
  nextScene,
  variationScene,
  type DirectorContext,
  type MascotScene,
  type MascotVariation,
} from './mascotScenes'

/** Suite pseudo-aléatoire reproductible. */
function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const ACTIVITIES: ClaudeActivity[] = ['read', 'search', 'write', 'command', 'web', 'think', 'subagent']
const VARIATIONS = Object.keys(VARIATION_WEIGHTS) as MascotVariation[]
/** Effets cachés au repos : ils commencent et finissent invisibles. */
const HIDDEN = /^(bubble|sweat|spark|mini)/
/** Sortent d'un coup et restent : ils commencent invisibles et finissent au repos (les engrenages). */
const POP = /^gears$/

function allScenes(): MascotScene[] {
  const scenes: MascotScene[] = []
  for (let seed = 1; seed <= 12; seed++) {
    const rand = seeded(seed)
    for (const activity of ACTIVITIES) {
      scenes.push(activityScene({ activity, activityElapsed: seed % 2 ? 0 : 60_000, repeat: seed % 3 === 0 }, rand))
      for (const v of VARIATIONS) scenes.push(variationScene(v, { activity, activityElapsed: 60_000, workingFor: 600_000 }, rand))
    }
    for (const m of ['start', 'done', 'error'] as const) scenes.push(momentScene(m, rand))
    scenes.push(nextScene({ ...BASE, status: 'waiting' }, rand))
  }
  return scenes
}

const BASE: DirectorContext = {
  status: 'working',
  activity: 'read',
  activityElapsed: 0,
  workingFor: 0,
  previous: null,
  previousActivity: null,
}

describe('scènes du Claude de l’île', () => {
  it('chaque piste a des moments rangés de 0 à 1, et revient au repos', () => {
    for (const scene of allScenes()) {
      expect(scene.duration).toBeGreaterThan(0)
      for (const t of scene.tracks) {
        const offsets = t.keyframes.map((k) => k.offset).filter((o): o is number => typeof o === 'number')
        expect(offsets.every((o, i) => o >= 0 && o <= 1 && (i === 0 || o >= (offsets[i - 1] ?? 0)))).toBe(true)
        const first = t.keyframes[0]
        const last = t.keyframes[t.keyframes.length - 1]
        if (t.part === 'lids') {
          expect(last?.height).toBe('0%')
        } else if (POP.test(t.part)) {
          expect(first?.opacity).toBe(0)
          expect(last?.transform).toBe(REST_TRANSFORM)
        } else if (first?.transform && !HIDDEN.test(t.part)) {
          expect(last?.transform, `${scene.name} / ${t.part}`).toBe(first.transform)
        }
        if (HIDDEN.test(t.part)) {
          // Les étincelles jaillissent d'un coup (cachées pendant leur délai) ; les autres effets apparaissent.
          if (!t.part.startsWith('spark')) expect(first?.opacity, `${scene.name} / ${t.part}`).toBe(0)
          expect(last?.opacity, `${scene.name} / ${t.part}`).toBe(0)
        }
        expect(t.duration).toBeGreaterThan(0)
      }
    }
  })

  it('les pièces qui ne font que bouger partent du repos', () => {
    const rand = seeded(4)
    for (const activity of ACTIVITIES) {
      const scene = activityScene({ activity, activityElapsed: 0, repeat: false }, rand)
      for (const t of scene.tracks) {
        if (t.part === 'lids' || HIDDEN.test(t.part) || POP.test(t.part)) continue
        expect(t.keyframes[0]?.transform, `${scene.name} / ${t.part}`).toBe(REST_TRANSFORM)
      }
    }
  })

  it('chaque activité a sa scène et son accessoire', () => {
    const rand = seeded(9)
    const scene = (activity: ClaudeActivity, elapsed = 0, repeat = false) =>
      activityScene({ activity, activityElapsed: elapsed, repeat }, rand)
    expect(scene('read')).toMatchObject({ name: 'read', prop: 'paper' })
    expect(scene('search')).toMatchObject({ name: 'search', prop: 'folder' })
    expect(scene('write')).toMatchObject({ name: 'write', prop: 'pencil' })
    expect(scene('command')).toMatchObject({ name: 'type', prop: 'keyboard' })
    expect(scene('web')).toMatchObject({ name: 'web', prop: 'lens' })
    expect(scene('think')).toMatchObject({ name: 'think', prop: 'thought' })
    expect(scene('subagent').name).toBe('subagent')
    expect(scene('subagent', 0, true).name).toBe('watch')
    const long = new Set(Array.from({ length: 30 }, () => scene('command', SCENES.longCommandMs).name))
    expect(long).toContain('tapFoot')
  })

  it('bâille seulement après un long moment ; s’essuie le front si la commande ou la session dure', () => {
    const quick = allowedVariations({ activity: 'command', activityElapsed: 0, workingFor: 0 })
    expect(quick).not.toContain('yawn')
    expect(quick).not.toContain('wipe')
    expect(allowedVariations({ activity: 'read', activityElapsed: 0, workingFor: SCENES.yawnAfterMs })).toContain('yawn')
    expect(allowedVariations({ activity: 'command', activityElapsed: SCENES.longCommandMs, workingFor: 0 })).toContain('wipe')
    expect(allowedVariations({ activity: 'read', activityElapsed: 0, workingFor: SCENES.wipeAfterMs })).toContain('wipe')
  })

  it('au travail : surtout l’activité, des variations mais jamais deux de suite', () => {
    const rand = seeded(21)
    let previous: DirectorContext['previous'] = null
    let activities = 0
    let variations = 0
    for (let i = 0; i < 300; i++) {
      const scene = nextScene({ ...BASE, previous }, rand)
      if (scene.family === 'variation') {
        expect(previous?.family).not.toBe('variation')
        variations++
      } else {
        expect(scene.family).toBe('activity')
        activities++
      }
      previous = scene
    }
    expect(variations).toBeGreaterThan(20)
    expect(activities).toBeGreaterThan(variations * 2)
  })

  it('sans activité connue, il réfléchit ; en attente d’autorisation, il attend ; au repos, il regarde autour de lui', () => {
    const rand = seeded(2)
    const noVariation = { ...BASE, activity: null, previous: { name: 'stretch', family: 'variation' as const } }
    expect(nextScene(noVariation, rand).name).toBe('think')
    expect(nextScene({ ...BASE, status: 'waiting' }, rand).name).toBe('waiting')
    for (const status of ['done', 'idle', 'sleep', 'background', null] as const) {
      expect(nextScene({ ...BASE, status }, rand).family).toBe('idle')
    }
  })

  it('moments : réveil au début du travail, fin, erreur ; rien au premier affichage ni au retour d’une autorisation', () => {
    expect(detectMoment(null, { status: 'working', error: false })).toBeNull()
    expect(detectMoment({ status: 'done', error: false }, { status: 'working', error: false })).toBe('start')
    expect(detectMoment({ status: 'idle', error: false }, { status: 'working', error: false })).toBe('start')
    expect(detectMoment({ status: 'waiting', error: false }, { status: 'working', error: false })).toBeNull()
    expect(detectMoment({ status: 'working', error: false }, { status: 'done', error: false })).toBe('done')
    expect(detectMoment({ status: 'waiting', error: false }, { status: 'idle', error: true })).toBe('error')
    expect(detectMoment({ status: 'idle', error: true }, { status: 'idle', error: true })).toBeNull()
  })

  it('réfléchit : les engrenages sortent la première fois, puis restent sans ressortir', () => {
    const rand = seeded(8)
    const first = activityScene({ activity: 'think', activityElapsed: 0, repeat: false }, rand)
    const again = activityScene({ activity: 'think', activityElapsed: 5000, repeat: true }, rand)
    expect(first.tracks.map((t) => t.part)).toContain('gears')
    expect(again.tracks.map((t) => t.part)).not.toContain('gears')
    expect(again.prop).toBe('thought')
  })

  it('fin : bulle ✓ et étincelles ; erreur : bulle ?', () => {
    const rand = seeded(6)
    const parts = (scene: MascotScene) => scene.tracks.map((t) => t.part)
    expect(parts(momentScene('done', rand))).toEqual(expect.arrayContaining(['bubbleDone', 'spark0', 'spark5']))
    expect(parts(momentScene('error', rand))).toContain('bubbleErr')
  })
})
