import { describe, expect, it } from 'vitest'
import { ISLAND_SIZES, SHARED_ELEMENTS } from '../geometry'
import { GARDEN, GARDEN_ANGRY_TOKEN, GARDEN_COLOR_TOKENS } from './constants'
import {
  CALM_MOOD,
  GardenSim,
  walkerVisual,
  type GardenFrame,
  type GardenSession,
  type GardenSyncOptions,
  type Rng,
  type Walker,
  twinLeftOf,
} from './simulation'

/** Hasard reproductible (mulberry32). */
function seeded(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SIZE = ISLAND_SIZES.win.multi
const OPTS: GardenSyncOptions = { width: SIZE.w, height: SIZE.h, platform: 'win', reduced: false, live: true }
const HIDDEN: GardenSyncOptions = { ...OPTS, live: false }
const REDUCED: GardenSyncOptions = { ...OPTS, reduced: true }
const FRAME: GardenFrame = { width: SIZE.w, height: SIZE.h, platform: 'win', mood: CALM_MOOD }
const DT = 1 / 60

function session(i: number, patch: Partial<GardenSession> = {}): GardenSession {
  return { id: `s${i}`, status: 'working', conflict: false, error: false, subagents: 0, ...patch }
}

function sessions(n: number): GardenSession[] {
  return Array.from({ length: n }, (_, i) => session(i))
}

function run(sim: GardenSim, seconds: number, frame: GardenFrame = FRAME, until?: () => boolean): void {
  for (let t = 0; t < seconds; t += DT) {
    sim.step(DT, frame)
    if (until?.()) return
  }
}

function main(sim: GardenSim, id: string): Walker {
  const w = sim.mainOf(id)
  if (!w) throw new Error(`pas de personnage pour ${id}`)
  return w
}

const visualCtx = { width: SIZE.w, height: SIZE.h, platform: 'win' as const, mood: CALM_MOOD, reduced: false, now: 0 }

describe('attribution des personnages', () => {
  it('donne un personnage aux 5 premières sessions, chacun sa couleur', () => {
    const sim = new GardenSim(seeded(1))
    sim.reset(sessions(7), OPTS)
    const mains = sim.walkers.filter((w) => !w.sub)
    expect(mains.map((w) => w.sessionId)).toEqual(['s0', 's1', 's2', 's3', 's4'])
    expect(new Set(mains.map((w) => w.colorSlot)).size).toBe(GARDEN.maxSessions)
    expect(mains.every((w) => w.size === GARDEN.size.main)).toBe(true)
    // Places de départ réparties sur la largeur, apparition une à une
    expect(mains.map((w) => w.delay)).toEqual([0.25, 0.39, 0.53, 0.67, 0.81].map((d) => expect.closeTo(d, 5)))
  })

  it('garde la couleur de chaque session et réutilise celle d’une session partie', () => {
    const sim = new GardenSim(seeded(2))
    sim.reset(sessions(3), OPTS)
    const slot1 = main(sim, 's1').colorSlot
    const slot2 = main(sim, 's2').colorSlot
    sim.sync([session(0), session(2)], HIDDEN)
    expect(sim.mainOf('s1')).toBeNull()
    expect(main(sim, 's2').colorSlot).toBe(slot2)
    sim.sync([session(0), session(2), session(9)], HIDDEN)
    expect(main(sim, 's9').colorSlot).toBe(slot1)
  })

  it('fait tomber une nouvelle session dans le jardin visible, les autres l’accueillent', () => {
    const sim = new GardenSim(seeded(3))
    sim.reset(sessions(2), OPTS)
    run(sim, 2)
    sim.sync(sessions(3), OPTS)
    const w = main(sim, 's2')
    expect(w.y).toBe(GARDEN.hello.y)
    expect(w.sc).toBe(GARDEN.hello.scale)
    expect(main(sim, 's0').cheerAt).toBe(w)
  })

  it('efface une session partie quand le jardin est visible', () => {
    const sim = new GardenSim(seeded(4))
    sim.reset(sessions(2), OPTS)
    run(sim, 2)
    sim.sync([session(0)], OPTS)
    const leaving = sim.walkers.find((w) => w.sessionId === 's1')
    expect(leaving?.retiring).toBe(true)
    run(sim, 1)
    expect(sim.walkers.some((w) => w.sessionId === 's1')).toBe(false)
  })

  it('fait partir le personnage de la session affichée depuis l’icône Claude', () => {
    const sim = new GardenSim(seeded(5))
    const icon = SHARED_ELEMENTS.agentIcon.win.agent
    expect(icon).toBeDefined()
    if (!icon) return
    sim.reset(sessions(2), OPTS, { sessionId: 's0', left: icon.x, top: icon.y, size: icon.s ?? 22 })
    const w = main(sim, 's0')
    expect(w.x).toBe(13 + 11)
    expect(w.y).toBeCloseTo(40 - 6 - (9 + 22 * 0.81), 5)
    expect(w.op).toBe(1)
    expect(w.delay).toBe(0)
    expect(main(sim, 's1').delay).toBeGreaterThan(0)
  })
})

describe('états des sessions', () => {
  it('montre une bulle par statut : attend, terminé, bloqué', () => {
    const sim = new GardenSim(seeded(6))
    sim.reset([session(0, { status: 'waiting' }), session(1, { status: 'done' }), session(2, { status: 'idle', error: true })], OPTS)
    run(sim, 2)
    const v = (id: string) => walkerVisual(main(sim, id), sim.statusOf(main(sim, id)), visualCtx)
    expect(v('s0').bubble).toBe('wait')
    expect(v('s1').bubble).toBe('done')
    expect(v('s1').lid).toBe(GARDEN.lidHalf)
    const blocked = v('s2')
    expect(blocked.bubble).toBe('err')
    expect(blocked.scaleY).toBeLessThan(blocked.scaleX)
    expect(blocked.opacity).toBeLessThanOrEqual(GARDEN.idleOpacity)
  })

  it('ne fait marcher que les sessions qui travaillent', () => {
    const sim = new GardenSim(seeded(7))
    sim.reset([session(0, { status: 'waiting' }), session(1)], OPTS)
    run(sim, 1)
    const x0 = main(sim, 's0').x
    run(sim, 2)
    expect(main(sim, 's0').x).toBe(x0)
    expect(main(sim, 's0').mode).toBe('stand')
  })

  it('fête une session qui termine', () => {
    const sim = new GardenSim(seeded(8))
    sim.reset(sessions(3), OPTS)
    run(sim, 2)
    sim.sync([session(0, { status: 'done' }), session(1), session(2)], OPTS)
    const done = main(sim, 's0')
    expect(sim.walkers.filter((w) => !w.sub && w.cheerAt === done).length).toBeGreaterThan(0)
    expect(sim.fx.some((e) => e.kind === 'spark')).toBe(true)
  })

  it('allonge une session inactive, avec des « z », et la réveille d’un saut', () => {
    const sim = new GardenSim(seeded(9))
    sim.reset([session(0, { status: 'sleep' }), session(1)], OPTS)
    let sawZ = false
    run(sim, 4, FRAME, () => {
      sawZ ||= sim.fx.some((e) => e.kind === 'z')
      return false
    })
    const w = main(sim, 's0')
    expect(w.rot).toBeLessThan(-80)
    expect(sawZ).toBe(true)
    expect(walkerVisual(w, 'sleep', visualCtx).lid).toBe(GARDEN.lidClosed)
    sim.sync(sessions(2), OPTS)
    expect(w.vy).toBe(GARDEN.wakeJump)
    expect(sim.fx.some((e) => e.kind === 'say' && e.text === '!')).toBe(true)
  })

  it('envoie le Claude libre le plus proche consoler une session bloquée', () => {
    const sim = new GardenSim(seeded(10))
    sim.reset(sessions(3), OPTS)
    run(sim, 2)
    sim.sync([session(0, { status: 'idle', error: true }), session(1), session(2)], OPTS)
    const blocked = main(sim, 's0')
    expect(blocked.sad).toBe(true)
    const helper = sim.walkers.find((w) => w.meet?.to === blocked)
    expect(helper?.meet?.type).toBe('comfort')
    run(sim, 15, FRAME, () => !blocked.sad)
    expect(blocked.sad).toBe(false)
    expect(blocked.comforted).toBe(true)
  })
})

describe('conflit', () => {
  it('fait se disputer les deux personnages concernés, une fois par conflit', () => {
    const sim = new GardenSim(seeded(11))
    sim.reset(sessions(3), OPTS)
    run(sim, 1)
    sim.sync([session(0, { conflict: true }), session(1), session(2, { conflict: true })], OPTS)
    const a = main(sim, 's0')
    const b = main(sim, 's2')
    expect(a.conflictWith).toBe(b)
    expect(b.conflictWith).toBe(a)
    expect(main(sim, 's1').conflictWith).toBeNull()

    run(sim, 20, FRAME, () => sim.interactions.some((ia) => ia.type === 'conflict'))
    run(sim, 0.5)
    expect(sim.interactions.some((ia) => ia.type === 'conflict')).toBe(true)
    expect(walkerVisual(a, 'working', visualCtx).colorToken).toBe(GARDEN_ANGRY_TOKEN)
    expect(sim.fx.some((e) => e.kind === 'say' && e.red)).toBe(true)

    run(sim, GARDEN.duration.conflict)
    expect(sim.interactions.some((ia) => ia.type === 'conflict')).toBe(false)
    expect(a.conflictWith).toBeNull()
    expect(a.conflictPlayed).toBe(true)
    expect(walkerVisual(a, 'working', visualCtx).colorToken).toBe(GARDEN_COLOR_TOKENS[a.colorSlot])

    // Le conflit dure : pas de nouvelle dispute ; il disparaît puis revient : elle se rejoue.
    const conflicted = [session(0, { conflict: true }), session(1), session(2, { conflict: true })]
    sim.sync(conflicted, OPTS)
    expect(a.conflictWith).toBeNull()
    sim.sync(sessions(3), OPTS)
    sim.sync(conflicted, OPTS)
    expect(a.conflictWith).toBe(b)
  })
})

describe('sous-agents', () => {
  it('suivent le parent, de sa couleur et plus petits, 3 au plus', () => {
    const sim = new GardenSim(seeded(12))
    sim.reset([session(0, { subagents: 5 }), session(1)], OPTS)
    const parent = main(sim, 's0')
    const subs = sim.subsOf(parent)
    expect(subs).toHaveLength(GARDEN.maxSubagents)
    expect(subs.every((w) => w.colorSlot === parent.colorSlot && w.size === GARDEN.size.sub)).toBe(true)
    expect(walkerVisual(subs[0] as Walker, 'working', visualCtx).bubble).toBeNull()
  })

  it('un sous-agent qui a fini rentre dans les bras du parent', () => {
    const sim = new GardenSim(seeded(13))
    sim.reset([session(0, { subagents: 1 }), session(1)], OPTS)
    run(sim, 3)
    const parent = main(sim, 's0')
    const [sub] = sim.subsOf(parent)
    expect(sub).toBeDefined()
    sim.sync([session(0, { subagents: 0 }), session(1)], OPTS)
    expect(sub?.mode).toBe('home')
    run(sim, 10, FRAME, () => !sim.walkers.includes(sub as Walker))
    expect(sim.walkers.includes(sub as Walker)).toBe(false)
  })

  it('disparaissent quand le parent ne travaille plus, reviennent quand il reprend', () => {
    const sim = new GardenSim(seeded(14))
    sim.reset([session(0, { subagents: 2 }), session(1)], OPTS)
    run(sim, 3)
    sim.sync([session(0, { status: 'waiting', subagents: 2 }), session(1)], OPTS)
    run(sim, 1)
    const parent = main(sim, 's0')
    for (const sub of sim.subsOf(parent)) expect(walkerVisual(sub, 'waiting', visualCtx).opacity).toBe(0)
    sim.sync([session(0, { subagents: 2 }), session(1)], OPTS)
    run(sim, 1)
    for (const sub of sim.subsOf(parent)) expect(sub.op).toBeGreaterThan(0.5)
  })
})

describe('humeur appel', () => {
  it('paroles grises et plus petites pendant un appel', () => {
    const sim = new GardenSim(seeded(15))
    sim.reset([session(0, { status: 'sleep' }), session(1)], OPTS)
    const callFrame = { ...FRAME, mood: { call: true, music: false } }
    run(sim, 1, callFrame)
    sim.sync(sessions(2), OPTS)
    const say = sim.fx.find((e) => e.kind === 'say')
    expect(say?.grey).toBe(true)
    expect(say?.small).toBe(true)
  })

  it('pendant un appel, les rencontres sont des discussions ou des chuchotements', () => {
    const sim = new GardenSim(seeded(16))
    sim.reset(sessions(5), OPTS)
    const callFrame = { ...FRAME, mood: { call: true, music: false } }
    const types = new Set<string>()
    run(sim, 120, callFrame, () => {
      sim.interactions.forEach((ia) => types.add(ia.type))
      return false
    })
    for (const t of types) expect(['talk', 'whisper', 'handoff', 'queue', 'comfort', 'apology']).toContain(t)
  })

  it('balancement de la marche réduit pendant un appel', () => {
    const sim = new GardenSim(seeded(1))
    sim.reset(sessions(1), REDUCED)
    const w = main(sim, 's0')
    w.mode = 'walk'
    const calm = walkerVisual(w, 'working', { ...visualCtx, now: 0.2 })
    const call = walkerVisual(w, 'working', { ...visualCtx, now: 0.2, mood: { call: true, music: false } })
    // 1,2 px → 0,5 px : le personnage monte moins haut
    expect(calm.top).toBeLessThan(call.top)
  })
})

describe('musique', () => {
  it('l’île s’ouvre au survol : le sol descend, les personnages tombent jusqu’en bas puis s’y posent', () => {
    const sim = new GardenSim(seeded(5))
    sim.reset(sessions(2), OPTS)
    run(sim, 2)
    for (const w of sim.walkers) w.y = 0
    const tall: GardenFrame = { ...FRAME, height: FRAME.height + 110 }
    sim.step(DT, tall)
    // Juste après l'ouverture : en l'air, au-dessus du nouveau sol.
    expect(sim.walkers.filter((w) => !w.sub).every((w) => w.y > 50)).toBe(true)
    run(sim, 2, tall)
    expect(sim.walkers.filter((w) => !w.sub && w.mode !== 'interact').every((w) => w.y < 20)).toBe(true)
    // Retour à l'île fermée : posés sur le sol remonté, jamais sous terre.
    sim.step(DT, FRAME)
    expect(sim.walkers.every((w) => w.y >= 0)).toBe(true)
  })

  it('ceux qui travaillent hochent la tête sur le tempo, même à l’arrêt ; les autres restent immobiles', () => {
    const sim = new GardenSim(seeded(3))
    sim.reset(sessions(1), REDUCED)
    const w = main(sim, 's0')
    w.mode = 'pause'
    const music = { call: false, music: true }
    // Un demi-battement plus loin, la tête n'est pas à la même hauteur.
    const beat = 60 / GARDEN.musicTempoBpm
    const a = walkerVisual(w, 'working', { ...visualCtx, mood: music, now: beat / 4 })
    const b = walkerVisual(w, 'working', { ...visualCtx, mood: music, now: beat })
    expect(a.top).not.toBe(b.top)
    const doneA = walkerVisual(w, 'done', { ...visualCtx, mood: music, now: beat / 4 })
    const doneB = walkerVisual(w, 'done', { ...visualCtx, mood: music, now: beat })
    expect(doneA.top).toBe(doneB.top)
    // Sans musique, un Claude arrêté ne bouge pas.
    const still = walkerVisual(w, 'working', { ...visualCtx, now: beat / 4 })
    expect(still.top).toBe(walkerVisual(w, 'working', { ...visualCtx, now: beat }).top)
  })
})

describe('animations réduites', () => {
  it('pose les personnages au sol, visibles tout de suite, sous-agents rangés à droite du parent', () => {
    const sim = new GardenSim(seeded(17))
    sim.reset([session(0, { subagents: 2 }), session(1)], REDUCED)
    const parent = main(sim, 's0')
    for (const w of sim.walkers) {
      expect(w.delay).toBe(0)
      expect(w.op).toBe(1)
      expect(w.y).toBe(0)
    }
    expect(sim.subsOf(parent).map((w) => w.x)).toEqual([parent.x + 16, parent.x + 30])
  })

  it('ne crée aucun effet et ne fait pas balancer la marche', () => {
    const sim = new GardenSim(seeded(18))
    sim.reset(sessions(3), REDUCED)
    sim.sync([session(0, { status: 'done' }), session(1, { conflict: true }), session(2, { conflict: true })], REDUCED)
    expect(sim.fx).toHaveLength(0)
    expect(sim.walkers.every((w) => !w.conflictWith && w.cheer === 0)).toBe(true)
    const w = main(sim, 's1')
    const a = walkerVisual(w, 'working', { ...visualCtx, reduced: true, now: 0.1 })
    const b = walkerVisual(w, 'working', { ...visualCtx, reduced: true, now: 0.37 })
    expect(a.top).toBe(b.top)
  })

  it('settle arrête les interactions et retire les effets en cours', () => {
    const sim = new GardenSim(seeded(19))
    sim.reset(sessions(3), OPTS)
    sim.sync([session(0, { conflict: true }), session(1, { conflict: true }), session(2)], OPTS)
    run(sim, 20, FRAME, () => sim.interactions.length > 0 && sim.fx.length > 0)
    sim.settle()
    expect(sim.interactions).toHaveLength(0)
    expect(sim.fx).toHaveLength(0)
    expect(sim.walkers.every((w) => w.y === 0 && w.op === 1 && !w.hidden && !w.angry)).toBe(true)
  })
})

describe('bords en portail', () => {
  it('le jumeau apparaît de l’autre côté seulement quand le sprite chevauche un bord', () => {
    expect(twinLeftOf(10, 20, 200)).toBeNull()
    expect(twinLeftOf(180, 20, 200)).toBeNull()
    expect(twinLeftOf(190, 20, 200)).toBe(-10)
    expect(twinLeftOf(-5, 20, 200)).toBe(195)
    expect(twinLeftOf(-5, 20, 0)).toBeNull()
  })

  it('un personnage qui sort à droite rentre à gauche sans disparaître', () => {
    const sim = new GardenSim(seeded(11))
    sim.reset([session(0)], OPTS)
    const w = main(sim, 's0')
    run(sim, 1)
    // Au bord droit, en marche vers la droite : la partie qui dépasse est déjà dessinée à gauche.
    w.x = SIZE.w - w.size / 4
    w.dir = 1
    w.mode = 'walk'
    const edge = walkerVisual(w, 'working', visualCtx)
    expect(edge.twinLeft).not.toBeNull()
    expect(edge.twinLeft ?? 0).toBeLessThan(0)
    expect((edge.twinLeft ?? 0) + w.size).toBeGreaterThan(0)
    // La position boucle sur la largeur : jamais de temps mort hors de la forme.
    for (let t = 0; t < 20; t += DT) {
      sim.step(DT, FRAME)
      if (w.mode === 'walk') {
        expect(w.x).toBeGreaterThanOrEqual(0)
        expect(w.x).toBeLessThan(SIZE.w)
      }
    }
  })
})
