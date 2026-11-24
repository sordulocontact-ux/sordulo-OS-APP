import { describe, expect, it } from 'vitest'
import { ISLAND_SIZES, SHARED_ELEMENTS } from '../geometry'
import { GARDEN, GARDEN_ANGRY_TOKEN, GARDEN_COLOR_TOKENS } from './constants'
import {
  CALM_MOOD,
  GardenSim,
  nodPulse,
  nodPulseAt,
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
    expect(w.y).toBeCloseTo(40 - GARDEN.groundOffset.win - (9 + 22 * GARDEN.footRatio), 5)
    expect(w.op).toBe(1)
    expect(w.delay).toBe(0)
    expect(main(sim, 's1').delay).toBeGreaterThan(0)
  })
})

describe('états des sessions', () => {
  it('montre une bulle par statut : terminé, bloqué ; en attente, des « ? » sortent de la tête', () => {
    const sim = new GardenSim(seeded(6))
    sim.reset([session(0, { status: 'waiting' }), session(1, { status: 'done' }), session(2, { status: 'idle', error: true })], OPTS)
    run(sim, 2)
    const v = (id: string) => walkerVisual(main(sim, id), sim.statusOf(main(sim, id)), visualCtx)
    expect(v('s0').bubble).toBeNull()
    expect(walkerVisual(main(sim, 's0'), 'waiting', { ...visualCtx, reduced: true }).bubble).toBe('wait')
    expect(sim.fx.some((e) => e.kind === 'ask' && e.text === '?')).toBe(true)
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

  it('pose une session inactive sur le ventre, yeux fermés, avec des « z », et la réveille d’un saut', () => {
    const sim = new GardenSim(seeded(9))
    sim.reset([session(0, { status: 'sleep' }), session(1)], OPTS)
    let sawZ = false
    run(sim, 4, FRAME, () => {
      sawZ ||= sim.fx.some((e) => e.kind === 'z')
      return false
    })
    const w = main(sim, 's0')
    // Posé, pas couché : aucune rotation, corps descendu au sol, yeux en traits.
    expect(w.rot).toBe(0)
    expect(w.rest).toBeGreaterThan(0.9)
    expect(sawZ).toBe(true)
    const asleep = walkerVisual(w, 'sleep', visualCtx)
    expect(asleep.closed).toBe(true)
    expect(asleep.lid).toBe(0)
    expect(asleep.top).toBeGreaterThan(walkerVisual(main(sim, 's1'), 'working', visualCtx).top)
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
    w.stepAmp = 1
    w.gait = Math.PI / 2
    const calm = walkerVisual(w, 'working', visualCtx)
    const call = walkerVisual(w, 'working', { ...visualCtx, mood: { call: true, music: false } })
    // Le haut du corps monte moins (1 px au plus), les pieds restent au sol : pas de saut.
    expect(calm.bodyLift).toBeGreaterThan(call.bodyLift)
    expect(calm.bodyLift).toBeLessThanOrEqual(1)
    expect(calm.top).toBe(call.top)
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
    w.dir = 1
    const music = { call: false, music: true }
    const beat = 60 / GARDEN.musicTempoBpm
    const at = (now: number, status: GardenSession['status'] = 'working', mood = music) =>
      walkerVisual(w, status, { ...visualCtx, mood, now })
    // De bas en haut, sans inclinaison : la tête revient devant (plus bas) sur le temps, en arrière (plus haut) entre.
    const hit = at(beat * GARDEN.nod.attack)
    expect(hit.nod).toBe(0)
    expect(hit.bodyLift).toBeCloseTo(-GARDEN.nod.dip, 5)
    expect(at(beat * 0.99).bodyLift).toBeGreaterThan(GARDEN.nod.back * 0.9)
    expect(at(beat * 0.5).bodyLift).toBeGreaterThan(hit.bodyLift)
    // Même coup au temps suivant : sur le tempo
    expect(at(beat * (3 + GARDEN.nod.attack)).bodyLift).toBeCloseTo(hit.bodyLift, 5)
    // Le hochement ne déplace pas le personnage (pas de saut) : seuls le haut du corps et la tête bougent.
    expect(hit.top).toBe(at(beat * 0.99).top)
    // Tourné vers la gauche : même hochement, jamais incliné.
    w.dir = -1
    expect(at(beat * GARDEN.nod.attack).nod).toBe(0)
    // Fini, en attente : immobiles. Sans musique (ou musique en pause) : pas de hochement.
    expect(at(beat * GARDEN.nod.attack, 'done').bodyLift).toBe(0)
    expect(at(beat * GARDEN.nod.attack, 'waiting').bodyLift).toBe(0)
    expect(at(beat * GARDEN.nod.attack, 'working', CALM_MOOD).bodyLift).toBe(0)
  })

  it('vrais temps de la musique : le hochement suit leur phase ; silence analysé : immobile', () => {
    const sim = new GardenSim(seeded(3))
    sim.reset(sessions(1), REDUCED)
    const w = main(sim, 's0')
    w.mode = 'pause'
    const music = { call: false, music: true }
    const at = (beatPhase: number | undefined, now = 0.3, musicSilent?: boolean) =>
      walkerVisual(w, 'working', { ...visualCtx, mood: music, now, beatPhase, musicSilent })
    // Sur le vrai temps (fin de la montée) : tête devant, quel que soit le temps du tempo fixe.
    expect(at(GARDEN.nod.attack, 0.3).bodyLift).toBeCloseTo(-GARDEN.nod.dip, 5)
    expect(at(GARDEN.nod.attack, 1.7).bodyLift).toBeCloseTo(-GARDEN.nod.dip, 5)
    // Juste avant le vrai temps suivant : en arrière.
    expect(at(0.99).bodyLift).toBeGreaterThan(GARDEN.nod.back * 0.9)
    // Même forme que le tempo fixe : nodPulse = nodPulseAt de la phase du tempo fixe.
    const beat = 60 / GARDEN.musicTempoBpm
    expect(nodPulse(beat * 2.3)).toBeCloseTo(nodPulseAt(0.3), 6)
    // Sans vraie phase : tempo fixe.
    expect(at(undefined, beat * GARDEN.nod.attack).bodyLift).toBeCloseTo(-GARDEN.nod.dip, 5)
    // Silence : pas de hochement.
    expect(at(GARDEN.nod.attack, 0.3, true).bodyLift).toBe(0)
    expect(at(undefined, beat * GARDEN.nod.attack, true).bodyLift).toBe(0)
  })

  it('silence analysé : personne ne hoche la tête, donc pas de notes', () => {
    const music: GardenFrame = { ...FRAME, mood: { call: false, music: true } }
    const notesIn = (frame: GardenFrame) => {
      // Un seul Claude au travail : pas de rencontre, les notes ne viennent que du hochement.
      const sim = new GardenSim(seeded(31))
      sim.reset(sessions(1), OPTS)
      const notes = new Set<number>()
      run(sim, 20, frame, () => {
        for (const e of sim.fx) if (e.kind === 'note') notes.add(e.id)
        return false
      })
      return notes.size
    }
    expect(notesIn(music)).toBeGreaterThan(0)
    expect(notesIn({ ...music, musicSilent: true })).toBe(0)
  })

  it('en musique : celui qui dort fait des « z » et jamais de note, celui qui travaille fait des notes', () => {
    const music: GardenFrame = { ...FRAME, mood: { call: false, music: true } }
    const notesOver = (sim: GardenSim, w: Walker) =>
      sim.fx.filter((e) => e.kind === 'note' && Math.abs(e.x + 3 - w.x) < 1).length
    const zOver = (sim: GardenSim, w: Walker) => sim.fx.filter((e) => e.kind === 'z' && Math.abs(e.x + 8 - w.x) < 1).length

    // Seul, endormi (immobile) : des « z », aucune note, pas de hochement.
    const alone = new GardenSim(seeded(30))
    alone.reset([session(0, { status: 'sleep' })], OPTS)
    const z = new Set<number>()
    let notes = 0
    run(alone, 12, music, () => {
      for (const e of alone.fx) if (e.kind === 'z') z.add(e.id)
      notes += alone.fx.filter((e) => e.kind === 'note').length
      return false
    })
    expect(z.size).toBeGreaterThan(0)
    expect(notes).toBe(0)
    const sleeper = main(alone, 's0')
    expect(walkerVisual(sleeper, 'sleep', { ...visualCtx, mood: music.mood, now: 0.05 }).nod).toBe(0)

    // Avec un Claude qui travaille et un qui a fini : les notes ne partent que de celui qui travaille.
    const sim = new GardenSim(seeded(31))
    sim.reset([session(0, { status: 'sleep' }), session(1), session(2, { status: 'done' })], OPTS)
    const asleep = main(sim, 's0')
    const worker = main(sim, 's1')
    const done = main(sim, 's2')
    const workerNotes = new Set<number>()
    const sleepZ = new Set<number>()
    run(sim, 20, music, () => {
      // Un seul Claude au travail : aucune rencontre ; une note naît au-dessus de lui (positions du moment).
      expect(sim.interactions).toHaveLength(0)
      for (const e of sim.fx) {
        if (e.kind === 'note' && !workerNotes.has(e.id)) {
          expect(Math.abs(e.x + 3 - worker.x)).toBeLessThan(1)
          workerNotes.add(e.id)
        }
        if (e.kind === 'z' && !sleepZ.has(e.id)) {
          expect(Math.abs(e.x + 8 - asleep.x)).toBeLessThan(1)
          sleepZ.add(e.id)
        }
      }
      expect(notesOver(sim, asleep) + notesOver(sim, done) + zOver(sim, done)).toBe(0)
      return false
    })
    expect(workerNotes.size).toBeGreaterThan(0)
    expect(sleepZ.size).toBeGreaterThan(0)
  })

  it('en marchant sur la musique : hochement et pattes en même temps', () => {
    const sim = new GardenSim(seeded(3))
    sim.reset(sessions(1), REDUCED)
    const w = main(sim, 's0')
    w.mode = 'walk'
    w.dir = 1
    w.stepAmp = 1
    w.gait = Math.PI / 2
    const beat = 60 / GARDEN.musicTempoBpm
    const v = walkerVisual(w, 'working', { ...visualCtx, mood: { call: false, music: true }, now: beat * GARDEN.nod.attack })
    expect(v.bodyLift).toBeCloseTo(-GARDEN.nod.dip, 5)
    expect(v.legs[0].lift).toBeGreaterThan(0)
  })
})

describe('pauses de travail', () => {
  it('il marche, se pose avec l’accessoire de son activité, puis repart se poser ailleurs', () => {
    const sim = new GardenSim(seeded(31))
    sim.reset([session(0, { activity: 'read' })], OPTS)
    const w = main(sim, 's0')
    const spots: number[] = []
    let walked = false
    let props = 0
    for (let t = 0; t < 60; t += DT) {
      sim.step(DT, FRAME)
      const v = walkerVisual(w, 'working', visualCtx, sim.activityOf(w))
      if (w.mode === 'pause' && w.busy) {
        expect(v.prop).toBe('paper')
        props += 1
        if (walked) spots.push(w.x)
        walked = false
      } else {
        if (w.mode === 'walk' && w.vel > 0) walked = true
        expect(v.prop).toBeNull()
      }
    }
    expect(props).toBeGreaterThan(0)
    // Plusieurs endroits différents, avec de la marche entre deux.
    const distinct = spots.filter((x, i) => i === 0 || Math.abs(x - (spots[i - 1] ?? x)) > 3)
    expect(distinct.length).toBeGreaterThanOrEqual(3)
  })

  it('l’accessoire suit l’activité de la session ; engrenages quand il réfléchit ou sans activité connue', () => {
    const sim = new GardenSim(seeded(32))
    sim.reset([session(0, { activity: 'search' })], OPTS)
    const w = main(sim, 's0')
    run(sim, 1)
    w.mode = 'pause'
    w.busy = true
    w.t = 5
    const prop = () => walkerVisual(w, sim.statusOf(w), visualCtx, sim.activityOf(w)).prop
    expect(prop()).toBe('folder')
    sim.sync([session(0, { activity: 'write' })], OPTS)
    expect(prop()).toBe('pencil')
    sim.sync([session(0, { activity: 'think' })], OPTS)
    expect(prop()).toBe('thought')
    sim.sync([session(0, { activity: null })], OPTS)
    expect(prop()).toBe('thought')
    // Hors du travail : pas d'accessoire.
    expect(walkerVisual(w, 'done', visualCtx, 'read').prop).toBeNull()
  })

  it('animations réduites : immobile, l’accessoire toujours visible quand la session travaille', () => {
    const sim = new GardenSim(seeded(33))
    sim.reset([session(0, { activity: 'web' })], REDUCED)
    const w = main(sim, 's0')
    expect(walkerVisual(w, 'working', { ...visualCtx, reduced: true }, 'web').prop).toBe('lens')
  })
})

describe('marche', () => {
  /** Hasard fixe : jamais de pause ni de saut spontanés, vitesse de croisière au plus haut. */
  const steady: Rng = () => 0.99

  it('accélère au départ, puis freine avant de s’arrêter', () => {
    const sim = new GardenSim(steady)
    sim.reset(sessions(1), OPTS)
    const w = main(sim, 's0')
    run(sim, GARDEN.appearDelay.main + 0.1)
    expect(w.vel).toBeGreaterThan(0)
    expect(w.vel).toBeLessThan(w.speed / 2)
    run(sim, 3)
    expect(w.vel).toBeCloseTo(w.speed, 5)
    // Freinage : plusieurs images de ralentissement, jamais d'accélération, puis la pause.
    w.stopping = true
    const speeds: number[] = []
    run(sim, 3, FRAME, () => {
      speeds.push(w.vel)
      return w.mode === 'pause'
    })
    expect(w.mode).toBe('pause')
    expect(w.vel).toBe(0)
    expect(speeds.length).toBeGreaterThan(20)
    for (let i = 1; i < speeds.length; i++) expect(speeds[i]).toBeLessThanOrEqual(speeds[i - 1] ?? Infinity)
  })

  it('les pattes alternent par paires en marchant et se posent à l’arrêt', () => {
    const sim = new GardenSim(steady)
    sim.reset(sessions(1), OPTS)
    const w = main(sim, 's0')
    run(sim, 3)
    let sawA = false
    let sawB = false
    run(sim, 1, FRAME, () => {
      const v = walkerVisual(w, 'working', visualCtx)
      const [l3, l5, l10, l12] = v.legs
      // Paires 3 + 10 et 5 + 12 : jamais les deux paires en l'air en même temps.
      expect(l3.lift).toBe(l10.lift)
      expect(l5.lift).toBe(l12.lift)
      expect(l3.lift > 0 && l5.lift > 0).toBe(false)
      expect(Math.max(l3.lift, l5.lift)).toBeLessThanOrEqual((GARDEN.legs.lift * w.size) / 16 + 1e-9)
      sawA ||= l3.lift > 0
      sawB ||= l5.lift > 0
      // Le corps reste à hauteur constante (pas de sautillement), seul le haut se balance de moins de 1 px.
      expect(v.top).toBeCloseTo(SIZE.h - GARDEN.groundOffset.win - w.size * GARDEN.footRatio - w.depth * GARDEN.depth.rise, 5)
      expect(v.bodyLift).toBeLessThanOrEqual(1)
      return false
    })
    expect(sawA && sawB).toBe(true)
    // À l'arrêt : pattes posées, corps immobile.
    w.stopping = true
    run(sim, 3, FRAME, () => w.mode === 'pause')
    run(sim, 0.8)
    expect(w.mode).toBe('pause')
    const still = walkerVisual(w, 'working', visualCtx)
    expect(still.legs.every((l) => l.lift === 0 && l.shift === 0)).toBe(true)
    expect(still.bodyLift).toBe(0)
  })

  it('la cadence des pas suit la vitesse', () => {
    const cadence = (frame: GardenFrame) => {
      const sim = new GardenSim(steady)
      sim.reset(sessions(1), OPTS)
      const w = main(sim, 's0')
      run(sim, 3, frame)
      let turns = 0
      let prev = w.gait
      run(sim, 2, frame, () => {
        turns += (w.gait - prev + 2 * Math.PI) % (2 * Math.PI)
        prev = w.gait
        return false
      })
      return turns
    }
    const calm = cadence(FRAME)
    const slow = cadence({ ...FRAME, mood: { call: true, music: false } })
    expect(calm).toBeGreaterThan(0)
    // Pendant un appel, il marche deux fois moins vite : deux fois moins de pas.
    expect(slow / calm).toBeGreaterThan(0.4)
    expect(slow / calm).toBeLessThan(0.6)
  })
})

describe('profondeur', () => {
  it('répartit les sessions sur les plans ; seule, une session est devant', () => {
    const one = new GardenSim(seeded(20))
    one.reset(sessions(1), OPTS)
    expect(main(one, 's0').plane).toBe(0)
    const sim = new GardenSim(seeded(20))
    sim.reset(sessions(3), OPTS)
    expect(new Set(['s0', 's1', 's2'].map((id) => main(sim, id).plane)).size).toBe(GARDEN.depth.planes)
  })

  it('au fond : plus petit, posé sur le même bord bas, dessiné derrière ; les sous-agents suivent leur parent', () => {
    const sim = new GardenSim(seeded(21))
    sim.reset([session(0), session(1), session(2, { subagents: 1 })], REDUCED)
    const front = main(sim, 's0')
    const back = main(sim, 's2')
    expect(front.plane).toBe(0)
    expect(back.plane).toBe(2)
    const vf = walkerVisual(front, 'working', visualCtx)
    const vb = walkerVisual(back, 'working', visualCtx)
    expect(vb.scaleY).toBeLessThan(vf.scaleY)
    // Tous posés sur le bas de l'île (demande de Maël) : la profondeur se lit à la taille, la teinte, l'ordre.
    expect(vb.shadowTop).toBeCloseTo(vf.shadowTop, 5)
    expect(vb.depth).toBe(2)
    expect(vf.depth).toBe(0)
    expect(vb.zIndex).toBeLessThan(vf.zIndex)
    const [sub] = sim.subsOf(back)
    expect(sub).toBeDefined()
    if (!sub) return
    const vs = walkerVisual(sub, 'working', visualCtx)
    expect(vs.depth).toBe(vb.depth)
    expect(vs.zIndex).toBeGreaterThan(vb.zIndex)
    expect(vs.zIndex).toBeLessThan(vf.zIndex)
  })

  it('deux personnages qui interagissent passent doucement sur le même plan, puis retrouvent le leur', () => {
    const sim = new GardenSim(seeded(22))
    sim.reset(sessions(2), OPTS)
    run(sim, 1)
    const a = main(sim, 's0')
    const b = main(sim, 's1')
    expect(a.plane).not.toBe(b.plane)
    const shared = Math.min(a.plane, b.plane)
    const behind = a.plane > b.plane ? a : b
    a.meet = { to: b, type: 'handoff' }
    const depths: number[] = []
    run(sim, 20, FRAME, () => {
      depths.push(behind.depth)
      return sim.interactions.length > 0 && behind.depth === shared
    })
    expect(behind.depth).toBe(shared)
    // Transition douce : plusieurs images entre les deux plans.
    expect(depths.filter((d) => d > shared && d < behind.plane).length).toBeGreaterThan(5)
    // Fin de l'interaction (temps de repos ensuite : pas de nouvelle rencontre tout de suite).
    run(sim, 15, FRAME, () => sim.interactions.length === 0)
    expect(sim.interactions).toHaveLength(0)
    run(sim, 2)
    expect(sim.interactions).toHaveLength(0)
    expect(behind.depth).toBe(behind.plane)
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
    w.mode = 'walk'
    w.stepAmp = 1
    w.gait = Math.PI / 2
    const music = { call: false, music: true }
    const a = walkerVisual(w, 'working', { ...visualCtx, reduced: true, mood: music, now: 0.1 })
    const b = walkerVisual(w, 'working', { ...visualCtx, reduced: true, mood: music, now: 0.37 })
    expect(a.top).toBe(b.top)
    // Pattes posées, pas de balancement ni de hochement, même en musique.
    for (const v of [a, b]) {
      expect(v.legs.every((l) => l.lift === 0 && l.shift === 0)).toBe(true)
      expect(v.bodyLift).toBe(0)
      expect(v.nod).toBe(0)
    }
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

describe('encoche du Mac', () => {
  const MAC = ISLAND_SIZES.mac.multi
  const MAC_OPTS: GardenSyncOptions = { width: MAC.w, height: MAC.h, platform: 'mac', reduced: false, live: true }
  const MAC_FRAME: GardenFrame = { width: MAC.w, height: MAC.h, platform: 'mac', mood: CALM_MOOD }
  const left = (MAC.w - GARDEN.notch.width) / 2
  const right = (MAC.w + GARDEN.notch.width) / 2
  const behindNotch = (w: Walker) => w.x + w.size / 2 > left && w.x - w.size / 2 < right

  it('au repos, personne ne reste caché derrière l’encoche : qui y entre ressort de l’autre côté', () => {
    const sim = new GardenSim(seeded(21))
    sim.reset(sessions(3), MAC_OPTS)
    let seen = 0
    for (let t = 0; t < 30; t += DT) {
      sim.step(DT, MAC_FRAME)
      for (const w of sim.walkers) {
        if (w.dead || w.delay > 0 || w.mode === 'interact' || w.mode === 'ride') continue
        seen += 1
        expect(behindNotch(w)).toBe(false)
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('ressort du côté vers lequel il avançait', () => {
    const sim = new GardenSim(seeded(22))
    sim.reset([session(0)], MAC_OPTS)
    const w = main(sim, 's0')
    run(sim, 1, MAC_FRAME)
    w.mode = 'walk'
    w.dir = 1
    w.px = left - w.size / 2 - 1
    w.x = left - w.size / 2 + 1
    sim.step(0, MAC_FRAME)
    expect(w.x).toBeCloseTo(right + GARDEN.notch.gap + w.size / 2, 5)
    w.dir = -1
    w.px = right + w.size / 2 + 1
    w.x = right + w.size / 2 - 1
    sim.step(0, MAC_FRAME)
    expect(w.x).toBeCloseTo(left - GARDEN.notch.gap - w.size / 2, 5)
  })

  it('personne ne reste arrêté à moins de 4 px de l’encoche', () => {
    // Sessions qui attendent ou ont fini : elles restent sur place, sauf contre l'encoche, d'où elles s'écartent.
    const sim = new GardenSim(seeded(25))
    sim.reset(
      [session(0), session(1, { status: 'waiting' }), session(2, { status: 'done' }), session(3)],
      MAC_OPTS,
    )
    const tooClose = (w: Walker) =>
      Math.abs(w.x - MAC.w / 2) < GARDEN.notch.width / 2 + GARDEN.notch.gap + w.size / 2 - 0.01
    const idle = main(sim, 's1')
    run(sim, 1, MAC_FRAME)
    idle.x = right + 1
    // « Reste » : arrêté contre l'encoche plus d'un quart de seconde (à la fin d'une rencontre près de
    // l'encoche, il repart dès l'image suivante : une image à l'arrêt ne compte pas).
    const stoppedFor = new Map<number, number>()
    let longest = 0
    for (let t = 0; t < 40; t += DT) {
      sim.step(DT, MAC_FRAME)
      for (const w of sim.walkers) {
        if (w.sub || w.dead || w.delay > 0 || w.mode === 'interact' || w.y !== 0 || t <= 3) continue
        const stopped = w.vel === 0 && tooClose(w) ? (stoppedFor.get(w.id) ?? 0) + DT : 0
        stoppedFor.set(w.id, stopped)
        longest = Math.max(longest, stopped)
      }
    }
    expect(longest).toBeLessThan(0.25)
    expect(tooClose(idle)).toBe(false)
  })

  it('île ouverte (sol sous l’encoche) ou Windows : rien ne change', () => {
    const sim = new GardenSim(seeded(23))
    sim.reset([session(0)], MAC_OPTS)
    const w = main(sim, 's0')
    run(sim, 1, MAC_FRAME)
    const open: GardenFrame = { ...MAC_FRAME, height: ISLAND_SIZES.mac.multiOpen.h }
    run(sim, 2, open)
    w.mode = 'walk'
    w.px = MAC.w / 2 - 1
    w.x = MAC.w / 2
    sim.step(0, open)
    expect(w.x).toBe(MAC.w / 2)
    const win = new GardenSim(seeded(24))
    win.reset([session(0)], OPTS)
    const v = main(win, 's0')
    run(win, 1)
    v.mode = 'walk'
    v.px = SIZE.w / 2 - 1
    v.x = SIZE.w / 2
    win.step(0, FRAME)
    expect(v.x).toBe(SIZE.w / 2)
  })
})
