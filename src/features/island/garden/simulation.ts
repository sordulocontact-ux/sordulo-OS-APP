/**
 * Moteur du jardin des Claude, logique pure (ni React ni DOM) : portage du script du prototype
 * design/prototypes/ile-sordulo-os.html (gOff, initGarden, wrap, showSpark, mainStep, stackTop, subStep,
 * pickType, headY, fx, say, startInteraction / updateInteractions / endInteraction, updateGarden, freeW,
 * nearest, celebrate, mood, scnConflict).
 *
 * - Un personnage (walker) par session Claude Code (5 au plus), avec sa couleur ; ses sous-agents sont de
 *   petits personnages de la même couleur qui le suivent, grimpent sur lui et rentrent dans ses bras.
 * - L'état réel des sessions remplace les boutons du prototype : `sync` compare les sessions reçues aux
 *   précédentes et déclenche les événements (arrivée, fin → fête, réveil, blocage → un autre vient consoler,
 *   conflit → les deux se disputent, sous-agents qui naissent ou rentrent).
 * - `step` avance la simulation (marche, sauts, interactions, effets) ; `walkerVisual` dit comment dessiner
 *   un personnage. Le dessin lui-même est dans ./renderer.ts, la boucle dans ./Garden.tsx.
 * - Le hasard est injecté (`rng`) pour les tests.
 */
import type { ClaudeSessionStatus, IslandPlatform } from '../types'
import {
  GARDEN,
  GARDEN_ANGRY_TOKEN,
  GARDEN_BLUSH_TOKEN,
  GARDEN_COLOR_TOKENS,
  type InteractionType,
  type Range,
} from './constants'

export type Rng = () => number

/** Ce que le jardin lit d'une session Claude Code (sous-ensemble de ClaudeSession). */
export interface GardenSession {
  id: string
  status: ClaudeSessionStatus
  conflict: boolean
  error: boolean
  subagents: number
}

/** Humeur du jardin (prototype : mood) : appel en cours, musique (hors périmètre, scénario E). */
export interface GardenMood {
  call: boolean
  music: boolean
}

export const CALM_MOOD: GardenMood = { call: false, music: false }

/** Taille courante de l'île (ressort) et contexte d'une image. */
export interface GardenFrame {
  /** Largeur de la zone de contenu (px). */
  width: number
  /** Hauteur de la forme (px). */
  height: number
  platform: IslandPlatform
  mood: GardenMood
}

export interface GardenSyncOptions {
  /** Largeur de `multi` (cible du ressort) : places de départ. */
  width: number
  /** Hauteur courante de la forme (départ depuis l'icône). */
  height: number
  platform: IslandPlatform
  /** Animations réduites : personnages immobiles, pas d'effets. */
  reduced: boolean
  /** Le jardin est à l'écran : arrivées animées (chute, accueil, fête). Sinon : simple apparition. */
  live: boolean
}

/** Icône Claude de l'état `agent` d'où part le personnage de la session affichée (prototype : initGarden(true)). */
export interface GardenIconStart {
  sessionId: string
  /** Bord gauche de l'icône (px depuis la gauche du contenu). */
  left: number
  /** Haut de l'icône (px). */
  top: number
  /** Taille de l'icône (px). */
  size: number
}

export type WalkerMode =
  | 'walk'
  | 'pause'
  | 'check'
  | 'stand'
  | 'interact'
  | 'ride'
  | 'seek'
  | 'jumpOn'
  | 'home'
  | 'homeJump'
  | 'blink'

export interface Walker {
  readonly id: number
  /** Session représentée (celle du parent pour un sous-agent). */
  readonly sessionId: string
  readonly sub: boolean
  readonly parent: Walker | null
  /** Indice de couleur (GARDEN_COLOR_TOKENS). */
  readonly colorSlot: number
  readonly size: number
  /** Centre horizontal (px), hauteur au-dessus du sol (px), vitesse verticale (px/s), sens (-1 / 1). */
  x: number
  y: number
  vy: number
  dir: number
  speed: number
  mode: WalkerMode
  /** Minuteur du mode courant (s). */
  t: number
  op: number
  sc: number
  cool: number
  delay: number
  rot: number
  shake: number
  angry: boolean
  hidden: boolean
  blush: boolean
  sit: boolean
  /** Bloqué (session en erreur), tant que personne n'est venu le consoler. */
  sad: boolean
  comforted: boolean
  sulk: number
  cheer: number
  cheerAt: Walker | null
  leap: number
  apologize: { to: Walker; wait: number } | null
  meet: { to: Walker; type: InteractionType } | null
  conflictWith: Walker | null
  /** La dispute a eu lieu pour ce conflit (rejouée seulement si le conflit disparaît puis revient). */
  conflictPlayed: boolean
  target: Walker | null
  nextBlink: number
  blink: number
  gone: boolean
  dead: boolean
  /** Session partie ou sous-agent fini : retiré à la fin de son fondu ou de son retour. */
  retiring: boolean
}

export type FxKind = 'say' | 'heart' | 'steam' | 'star' | 'cloud' | 'paper' | 'z' | 'note' | 'spark'

/** Effet éphémère (bulle de parole, cœur, vapeur, étoile, nuage de bagarre, feuille, « z », note, étincelle). */
export interface Fx {
  readonly id: number
  readonly kind: FxKind
  readonly text: string
  /** Position du coin haut gauche (px). */
  x: number
  y: number
  age: number
  life: number
  readonly red: boolean
  readonly grey: boolean
  readonly small: boolean
  /** Étoile : direction de l'éclat (px). */
  readonly dx: number
  readonly dy: number
  /** Nuage : tremblement (px). */
  jx: number
  jy: number
}

export interface Interaction {
  readonly a: Walker
  readonly b: Walker
  readonly sa: number
  readonly sb: number
  readonly type: InteractionType
  t: number
  readonly mid: number
  readonly marks: Set<string>
  readonly noPlace: boolean
  gap: number | null
  cloud: Fx | null
  paper: Fx | null
  race: { da: number; db: number; va: number; vb: number } | null
}

export type GardenEvent = 'handoff' | 'queue'

export type BubbleKind = 'wait' | 'done' | 'err'

/** Comment dessiner un personnage à cette image. */
export interface WalkerVisual {
  /** Translation du sprite (coin haut gauche, px), rotation (deg), échelle. */
  left: number
  /**
   * Portail : position du jumeau quand le sprite dépasse un bord (même image décalée d'une largeur : la partie
   * qui sort d'un côté rentre de l'autre) ; null quand il est entier dans la forme.
   */
  twinLeft: number | null
  top: number
  rot: number
  scaleX: number
  scaleY: number
  /** Token de couleur du corps (sans var()). */
  colorToken: string
  opacity: number
  /** Hauteur des paupières (% du sprite). */
  lid: number
  bubble: BubbleKind | null
}

export const BUBBLE_TEXT: Record<BubbleKind, string> = { wait: '!', done: '✓', err: '?' }

const MAIN_TOP_RATIO = GARDEN.size.main * GARDEN.headRatio

function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0
}

export function groundOffset(platform: IslandPlatform): number {
  return GARDEN.groundOffset[platform]
}

/** Sessions représentées : les 5 premières (comme les lignes de multiOpen). */
export function gardenSessions<T extends GardenSession>(sessions: readonly T[]): T[] {
  return sessions.slice(0, GARDEN.maxSessions)
}

export class GardenSim {
  private list: Walker[] = []
  private ias: Interaction[] = []
  private effects: Fx[] = []
  private readonly sessions = new Map<string, GardenSession>()
  private nextId = 1
  private nextFxId = 1
  private height = 0
  private platform: IslandPlatform = 'win'
  private mood: GardenMood = CALM_MOOD
  private ambient: number

  constructor(private readonly rng: Rng = Math.random) {
    this.ambient = this.rnd(GARDEN.ambientEvery)
  }

  get walkers(): readonly Walker[] {
    return this.list
  }

  get fx(): readonly Fx[] {
    return this.effects
  }

  get interactions(): readonly Interaction[] {
    return this.ias
  }

  /** Statut de la session d'un personnage (celle du parent pour un sous-agent). */
  statusOf(w: Walker): ClaudeSessionStatus {
    return this.sessions.get(w.sessionId)?.status ?? 'working'
  }

  /** Personnage principal d'une session. */
  mainOf(sessionId: string): Walker | null {
    return this.list.find((w) => !w.sub && !w.dead && w.sessionId === sessionId) ?? null
  }

  /** Sous-agents affichés d'une session (hors ceux qui rentrent). */
  subsOf(parent: Walker): Walker[] {
    return this.list.filter((w) => w.parent === parent && !w.dead && !w.retiring)
  }

  // --- Hasard -------------------------------------------------------------------------------------------------

  private rnd(range: Range): number {
    return range[0] + this.rng() * (range[1] - range[0])
  }

  private coin(p: number): boolean {
    return this.rng() < p
  }

  private randomDir(): number {
    return this.coin(0.5) ? -1 : 1
  }

  // --- Création -----------------------------------------------------------------------------------------------

  private makeWalker(sessionId: string, parent: Walker | null, colorSlot: number): Walker {
    const sub = parent !== null
    return {
      id: this.nextId++,
      sessionId,
      sub,
      parent,
      colorSlot,
      size: sub ? GARDEN.size.sub : GARDEN.size.main,
      x: 0,
      y: 0,
      vy: 0,
      dir: this.randomDir(),
      speed: this.rnd(sub ? GARDEN.walkSpeed.sub : GARDEN.walkSpeed.main),
      mode: 'walk',
      t: sub ? this.rnd(GARDEN.sub.firstTurn) : 0,
      op: 0,
      sc: GARDEN.appearScale,
      cool: GARDEN.initialCooldown,
      delay: 0,
      rot: 0,
      shake: 0,
      angry: false,
      hidden: false,
      blush: false,
      sit: false,
      sad: false,
      comforted: false,
      sulk: 0,
      cheer: 0,
      cheerAt: null,
      leap: 0,
      apologize: null,
      meet: null,
      conflictWith: null,
      conflictPlayed: false,
      target: null,
      nextBlink: this.rnd(GARDEN.blink.first),
      blink: 0,
      gone: false,
      dead: false,
      retiring: false,
    }
  }

  private freeColorSlot(): number {
    const used = new Set(this.list.filter((w) => !w.sub && !w.dead).map((w) => w.colorSlot))
    for (let i = 0; i < GARDEN_COLOR_TOKENS.length; i++) if (!used.has(i)) return i
    return this.list.filter((w) => !w.sub).length % GARDEN_COLOR_TOKENS.length
  }

  private settleStill(w: Walker): void {
    w.delay = 0
    w.op = 1
    w.sc = 1
    w.y = 0
    w.vy = 0
  }

  /**
   * Repart d'un jardin neuf (prototype : initGarden). `fromIcon` : le personnage de cette session part de
   * l'icône Claude de l'état `agent`, les autres apparaissent un à un.
   */
  reset(sessions: readonly GardenSession[], opts: GardenSyncOptions, fromIcon: GardenIconStart | null = null): void {
    this.list = []
    this.ias = []
    this.effects = []
    this.sessions.clear()
    this.height = opts.height
    this.platform = opts.platform
    const shown = gardenSessions(sessions)
    const n = Math.max(1, shown.length)
    const mains = shown.map((s, i) => {
      this.sessions.set(s.id, { ...s })
      const w = this.makeWalker(s.id, null, i)
      w.x = ((i + 0.5) * opts.width) / n + this.rnd([-GARDEN.startJitter, GARDEN.startJitter])
      w.delay = GARDEN.appearDelay.main + i * GARDEN.appearDelay.mainStep
      if (fromIcon && fromIcon.sessionId === s.id) {
        w.x = fromIcon.left + fromIcon.size / 2
        w.y = Math.max(0, opts.height - groundOffset(opts.platform) - (fromIcon.top + fromIcon.size * GARDEN.footRatio))
        w.op = 1
        w.sc = 1
        w.delay = 0
        w.dir = 1
      }
      if (opts.reduced) this.settleStill(w)
      this.list.push(w)
      return w
    })
    shown.forEach((s, i) => {
      const parent = mains[i]
      if (!parent) return
      this.applyFlags(parent, s)
      const count = Math.min(Math.max(0, s.subagents), GARDEN.maxSubagents)
      for (let k = 0; k < count; k++) this.addSub(parent, k, opts, i)
    })
    this.pairConflicts(opts)
  }

  /** Nouveau sous-agent (k : rang parmi ceux du parent ; parentIndex : rang du parent à la création du jardin). */
  private addSub(parent: Walker, k: number, opts: GardenSyncOptions, parentIndex: number | null): Walker {
    const w = this.makeWalker(parent.sessionId, parent, parent.colorSlot)
    w.x = parent.x + this.rnd([-GARDEN.subSpawnSpread, GARDEN.subSpawnSpread])
    if (parentIndex !== null) {
      w.delay = GARDEN.appearDelay.sub + k * GARDEN.appearDelay.subStep + parentIndex * GARDEN.appearDelay.subParentStep
    }
    if (opts.reduced) {
      this.settleStill(w)
      w.x = parent.x + GARDEN.reducedSubOffset + k * GARDEN.reducedSubGap
      if (this.statusOf(parent) !== 'working') w.op = 0
    }
    this.list.push(w)
    return w
  }

  // --- Sessions réelles ---------------------------------------------------------------------------------------

  /**
   * Accorde le jardin aux sessions reçues : arrivées, départs, changements de statut, sous-agents, conflits.
   * Les effets visibles (fête, réveil, accueil) ne se jouent que si le jardin est à l'écran et animé.
   */
  sync(sessions: readonly GardenSession[], opts: GardenSyncOptions): void {
    this.height = opts.height
    this.platform = opts.platform
    const shown = gardenSessions(sessions)
    const ids = new Set(shown.map((s) => s.id))
    const animate = opts.live && !opts.reduced

    for (const w of this.list) {
      if (!w.sub && !w.dead && !w.retiring && !ids.has(w.sessionId)) this.retireMain(w, opts)
    }

    const hadWalkers = this.list.some((w) => !w.sub && !w.dead && !w.retiring)
    shown.forEach((s, i) => {
      const prev = this.sessions.get(s.id)
      this.sessions.set(s.id, { ...s })
      let w = this.mainOf(s.id)
      if (w && w.retiring) w = null
      if (!w) {
        w = this.addMain(s, i, shown.length, opts, hadWalkers && animate)
      } else if (prev) {
        this.applyTransitions(w, prev, s, opts, animate)
      }
      this.applyFlags(w, s)
      this.syncSubs(w, s, opts)
    })

    this.pairConflicts(opts)
    this.prune()
  }

  private addMain(s: GardenSession, i: number, n: number, opts: GardenSyncOptions, hello: boolean): Walker {
    const w = this.makeWalker(s.id, null, this.freeColorSlot())
    if (hello) {
      // Nouvelle session (prototype : hello) : elle tombe dans le jardin, les autres l'accueillent.
      w.x = this.rnd([GARDEN.hello.margin, Math.max(GARDEN.hello.margin, opts.width - GARDEN.hello.margin)])
      w.y = GARDEN.hello.y
      w.sc = GARDEN.hello.scale
      for (const o of this.mains()) {
        if (o !== w && this.isFree(o)) {
          o.cheer = GARDEN.hello.cheer
          o.cheerAt = w
        }
      }
    } else {
      w.x = ((i + 0.5) * opts.width) / Math.max(1, n) + this.rnd([-GARDEN.startJitter, GARDEN.startJitter])
      w.delay = GARDEN.appearDelay.main + i * GARDEN.appearDelay.mainStep
    }
    if (opts.reduced) this.settleStill(w)
    this.list.push(w)
    return w
  }

  private retireMain(w: Walker, opts: GardenSyncOptions): void {
    w.retiring = true
    this.endInteractionsOf(w)
    this.forgetRefsTo(w)
    if (!opts.live || opts.reduced) w.dead = true
    for (const sub of this.list) {
      if (sub.parent === w) {
        sub.retiring = true
        if (!opts.live || opts.reduced) sub.dead = true
      }
    }
  }

  private applyTransitions(
    w: Walker,
    prev: GardenSession,
    s: GardenSession,
    opts: GardenSyncOptions,
    animate: boolean,
  ): void {
    if (prev.status !== 'done' && s.status === 'done' && animate) this.celebrate(w)
    if (prev.status === 'sleep' && s.status !== 'sleep' && animate) {
      w.vy = GARDEN.wakeJump
      this.say(w, '!')
    }
    if (!prev.error && s.error) {
      w.comforted = false
      // Appel à l'aide : le plus proche des Claude libres vient le consoler.
      if (!opts.reduced) {
        const helper = this.nearest(w, (o) => this.isFree(o))
        if (helper) helper.meet = { to: w, type: 'comfort' }
      }
    }
    if (!s.error) w.comforted = false
    if (!s.conflict) {
      w.conflictPlayed = false
      const other = w.conflictWith
      if (other && !this.ias.some((ia) => ia.type === 'conflict' && (ia.a === w || ia.b === w))) {
        w.conflictWith = null
        if (other.conflictWith === w) other.conflictWith = null
      }
    }
  }

  private applyFlags(w: Walker, s: GardenSession): void {
    w.sad = s.error && !w.comforted
  }

  private syncSubs(parent: Walker, s: GardenSession, opts: GardenSyncOptions): void {
    const desired = Math.min(Math.max(0, s.subagents), GARDEN.maxSubagents)
    const subs = this.subsOf(parent)
    for (let k = subs.length; k < desired; k++) this.addSub(parent, k, opts, opts.live ? null : 0)
    if (subs.length <= desired) return
    // Les sous-agents qui ont fini rentrent dans les bras du parent (ceux qui ne sont pas perchés d'abord).
    const leaving = [...subs].sort((a, b) => Number(a.mode === 'ride') - Number(b.mode === 'ride')).slice(0, subs.length - desired)
    for (const sub of leaving) this.retireSub(sub, opts)
  }

  private retireSub(sub: Walker, opts: GardenSyncOptions): void {
    sub.retiring = true
    sub.target = null
    const parent = sub.parent
    const visible = sub.op > 0 && !sub.gone && sub.delay <= 0
    if (!opts.live || opts.reduced || !visible) {
      sub.dead = true
      return
    }
    if (parent && this.statusOf(parent) === 'working') {
      sub.mode = 'home'
      sub.vy = 0
    }
  }

  /** Conflit : les deux personnages concernés vont l'un vers l'autre et se disputent (prototype : scnConflict). */
  private pairConflicts(opts: GardenSyncOptions): void {
    if (opts.reduced) return
    const candidates = this.mains().filter((w) => {
      const s = this.sessions.get(w.sessionId)
      return !!s && s.conflict && !w.conflictWith && !w.conflictPlayed
    })
    for (let i = 0; i + 1 < candidates.length; i += 2) {
      const a = candidates[i]
      const b = candidates[i + 1]
      if (a && b) this.startConflict(a, b)
    }
  }

  private startConflict(a: Walker, b: Walker): void {
    for (const ia of [...this.ias]) {
      if (ia.type !== 'conflict' && (ia.a === a || ia.b === a || ia.a === b || ia.b === b)) {
        this.endInteraction(ia)
        this.ias.splice(this.ias.indexOf(ia), 1)
      }
    }
    for (const w of [a, b]) {
      w.meet = null
      w.apologize = null
      w.cheer = 0
      w.leap = 0
    }
    a.conflictWith = b
    b.conflictWith = a
  }

  /** Animations réduites : tout s'arrête, personnages posés au sol, effets retirés. */
  settle(): void {
    for (const ia of this.ias) this.endInteraction(ia)
    this.ias = []
    this.effects = []
    for (const w of this.list) {
      if (w.retiring) w.dead = true
      w.conflictWith = null
      w.conflictPlayed = false
      w.meet = null
      w.apologize = null
      w.cheer = 0
      w.leap = 0
      w.target = null
      w.rot = 0
      this.settleStill(w)
      w.mode = w.sub || this.statusOf(w) === 'working' ? 'walk' : 'stand'
    }
    this.prune()
    for (const parent of this.mains()) {
      const working = this.statusOf(parent) === 'working'
      this.subsOf(parent).forEach((sub, k) => {
        sub.x = parent.x + GARDEN.reducedSubOffset + k * GARDEN.reducedSubGap
        sub.op = working ? 1 : 0
      })
    }
  }

  // --- Simulation ---------------------------------------------------------------------------------------------

  private mains(): Walker[] {
    return this.list.filter((w) => !w.sub && !w.dead && !w.retiring)
  }

  private headY(w: Walker): number {
    return this.height - groundOffset(this.platform) - w.size * GARDEN.headRatio - w.y
  }

  /**
   * Bords en portail : la position boucle sur la largeur, sans temps mort hors de la forme. Le personnage qui
   * dépasse d'un côté est déjà visible de l'autre (jumeau dessiné par renderer.ts, voir walkerVisual).
   */
  private wrap(w: Walker, width: number): void {
    if (width <= 0) return
    if (w.x >= width) w.x -= width
    else if (w.x < 0) w.x += width
  }

  /** Libre pour une rencontre (prototype : freeW). */
  private isFree(w: Walker): boolean {
    return (
      !w.sub &&
      !w.dead &&
      !w.retiring &&
      this.statusOf(w) === 'working' &&
      w.mode !== 'interact' &&
      !w.sad &&
      !w.conflictWith &&
      !w.meet &&
      w.delay <= 0
    )
  }

  private nearest(w: Walker, accept: (o: Walker) => boolean): Walker | null {
    let best: Walker | null = null
    let bd = Infinity
    for (const o of this.mains()) {
      if (o === w || !accept(o)) continue
      const d = Math.abs(o.x - w.x)
      if (d < bd) {
        bd = d
        best = o
      }
    }
    return best
  }

  private addFx(kind: FxKind, text: string, x: number, y: number, life: number, opts: Partial<Fx> = {}): Fx {
    const e: Fx = {
      id: this.nextFxId++,
      kind,
      text,
      x,
      y,
      age: 0,
      life,
      red: opts.red ?? false,
      grey: opts.grey ?? false,
      small: opts.small ?? false,
      dx: opts.dx ?? 0,
      dy: opts.dy ?? 0,
      jx: 0,
      jy: 0,
    }
    this.effects.push(e)
    return e
  }

  private removeFx(e: Fx | null): void {
    if (!e) return
    const i = this.effects.indexOf(e)
    if (i >= 0) this.effects.splice(i, 1)
  }

  /** Bulle de parole (prototype : say) : rouge en conflit, grise et plus petite pendant un appel. */
  private say(w: Walker, text: string, red = false, small = false): void {
    const grey = !red && this.mood.call
    this.addFx('say', text, w.x - 3, this.headY(w) - 13, GARDEN.fxLife.say, { red, grey, small: small || grey })
  }

  private spark(x: number, y?: number): void {
    const top = y ?? this.height - groundOffset(this.platform) - GARDEN.sparkLift
    this.addFx('spark', '✦', x - 5, top, GARDEN.fxLife.spark)
  }

  /** Fin de session : les autres se tournent vers lui et sautent (prototype : celebrate). */
  private celebrate(w: Walker): void {
    for (const o of this.mains()) {
      if (o !== w && this.isFree(o)) {
        o.cheer = GARDEN.celebrateCheer
        o.cheerAt = w
      }
    }
    this.spark(w.x, this.headY(w) - 12)
  }

  /** Événements du prototype sans équivalent réel : passage de relais, file d'attente. */
  trigger(event: GardenEvent): boolean {
    const free = this.mains().filter((w) => this.isFree(w))
    if (free.length < 2) return false
    const i = free[Math.floor(this.rng() * free.length)]
    if (!i) return false
    const j = this.nearest(i, (o) => this.isFree(o))
    if (!j) return false
    if (event === 'handoff') i.meet = { to: j, type: 'handoff' }
    else j.meet = { to: i, type: 'queue' }
    return true
  }

  private pickType(): InteractionType {
    if (this.mood.call) return this.coin(GARDEN.callTalkChance) ? 'talk' : 'whisper'
    if (this.mood.music && this.coin(GARDEN.musicDanceChance)) return 'dance'
    const types = GARDEN.interactionTypes
    return types[Math.floor(this.rng() * types.length)] ?? 'talk'
  }

  private startInteraction(a: Walker, b: Walker, type: InteractionType): void {
    a.mode = 'interact'
    b.mode = 'interact'
    a.vy = 0
    b.vy = 0
    a.dir = sign(b.x - a.x) || 1
    b.dir = -a.dir
    const sa = a.x < b.x ? -1 : 1
    this.ias.push({
      a,
      b,
      sa,
      sb: -sa,
      type,
      t: 0,
      mid: (a.x + b.x) / 2,
      marks: new Set(),
      noPlace: type === 'race',
      gap: null,
      cloud: null,
      paper: null,
      race: null,
    })
  }

  private endInteraction(ia: Interaction): void {
    for (const w of [ia.a, ia.b]) {
      w.mode = 'walk'
      w.rot = 0
      w.shake = 0
      w.angry = false
      w.hidden = false
      w.blush = false
      w.sit = false
      w.cool = this.rnd(GARDEN.cooldown)
    }
    if (ia.type !== 'annoyed' && ia.type !== 'race' && ia.type !== 'dance') {
      ia.a.dir *= -1
      ia.b.dir *= -1
    }
    this.removeFx(ia.cloud)
    this.removeFx(ia.paper)
    ia.cloud = null
    ia.paper = null
    if (ia.type === 'comfort') {
      ia.b.comforted = true
      ia.b.sad = false
    }
    if (ia.type === 'apology') ia.b.sulk = 0
    // Après une bagarre, l'un boude, l'autre reviendra s'excuser.
    if (ia.type === 'fight' && this.coin(GARDEN.fightSulkChance)) {
      ia.b.sulk = GARDEN.sulk.duration
      ia.b.cool = GARDEN.sulk.cooldown
      ia.a.apologize = { to: ia.b, wait: GARDEN.sulk.apologyWait }
    }
    if (ia.type === 'conflict') {
      ia.a.conflictWith = null
      ia.b.conflictWith = null
      ia.a.conflictPlayed = true
      ia.b.conflictPlayed = true
    }
  }

  private endInteractionsOf(w: Walker): void {
    for (const ia of [...this.ias]) {
      if (ia.a === w || ia.b === w) {
        this.endInteraction(ia)
        this.ias.splice(this.ias.indexOf(ia), 1)
      }
    }
  }

  private forgetRefsTo(dead: Walker): void {
    for (const w of this.list) {
      if (w.target === dead) w.target = null
      if (w.cheerAt === dead) {
        w.cheerAt = null
        w.cheer = 0
      }
      if (w.meet?.to === dead) w.meet = null
      if (w.apologize?.to === dead) w.apologize = null
      if (w.conflictWith === dead) w.conflictWith = null
    }
  }

  private prune(): void {
    const dead = this.list.filter((w) => w.dead)
    if (dead.length === 0) return
    for (const d of dead) {
      this.endInteractionsOf(d)
      this.forgetRefsTo(d)
    }
    this.list = this.list.filter((w) => !w.dead)
    const live = new Set(this.list.map((w) => w.sessionId))
    for (const id of [...this.sessions.keys()]) if (!live.has(id)) this.sessions.delete(id)
  }

  /**
   * Le sol suit le bas de l'île. Il descend (l'île s'ouvre au survol pendant la musique) : les personnages
   * restent où ils sont et tombent, la gravité les ramène au nouveau sol. Il remonte : ils sont posés dessus.
   */
  private followGround(dh: number): void {
    if (dh === 0) return
    for (const w of this.list) {
      if (w.dead || w.mode === 'ride') continue
      w.y = Math.max(0, w.y + dh)
      if (w.y === 0 && w.vy < 0) w.vy = 0
    }
  }

  /** Avance la simulation (prototype : updateGarden). */
  step(dtSeconds: number, frame: GardenFrame): void {
    const dt = Math.min(Math.max(0, dtSeconds), GARDEN.maxDt)
    const width = frame.width
    this.followGround(frame.height - this.height)
    this.height = frame.height
    this.platform = frame.platform
    this.mood = frame.mood

    for (const w of this.list) {
      if (w.dead) continue
      if (w.delay > 0) {
        w.delay -= dt
        continue
      }
      // Clignement des yeux, à un rythme propre à chacun
      w.nextBlink -= dt
      if (w.nextBlink <= 0) {
        w.blink = GARDEN.blink.duration
        w.nextBlink = this.rnd(w.sub ? GARDEN.blink.sub : GARDEN.blink.main)
      }
      if (w.blink > 0) w.blink -= dt
      const st = this.statusOf(w)
      if (!w.sub && w.retiring) {
        w.op = Math.max(0, w.op - dt * GARDEN.leaveFadeRate)
        if (w.op <= 0) w.dead = true
        continue
      }
      if (w.sub) {
        const homing = w.mode === 'home' || w.mode === 'homeJump'
        if (st !== 'working' || (w.retiring && !homing)) {
          w.op = Math.max(0, w.op - dt * GARDEN.subFadeOutRate)
          w.gone = true
          if (w.retiring && w.op <= 0) w.dead = true
          continue
        }
        if (w.gone) {
          w.gone = false
          w.x = this.rnd([GARDEN.sub.blinkMargin, width - GARDEN.sub.blinkMargin])
          w.sc = GARDEN.appearScale
          w.mode = 'walk'
        }
      }
      if (w.mode !== 'blink') w.op = Math.min(1, w.op + dt * GARDEN.fadeInRate)
      w.sc += (1 - w.sc) * Math.min(1, dt * GARDEN.growRate)
      if (w.sub) this.subStep(w, dt, width)
      else if (st === 'working' || w.conflictWith) this.mainStep(w, dt, width)
      else if (w.mode !== 'interact') w.mode = 'stand'
      // Sieste : il s'allonge et des « z » s'envolent ; sinon il se redresse
      if (!w.sub) {
        if (st === 'sleep' && w.mode !== 'interact') {
          w.rot += (GARDEN.sleep.angle - w.rot) * Math.min(1, dt * GARDEN.sleep.rate)
          if (this.coin(dt * GARDEN.sleep.zRate)) this.addFx('z', 'z', w.x - 8, this.headY(w) + 2, GARDEN.fxLife.z)
        } else if (w.mode !== 'interact' && w.rot) {
          w.rot += -w.rot * Math.min(1, dt * GARDEN.sleep.standRate)
          if (Math.abs(w.rot) < 0.5) w.rot = 0
        }
      }
      if (w.mode !== 'ride' && (w.y > 0 || w.vy > 0)) {
        w.vy -= (w.sub ? GARDEN.gravity.sub : GARDEN.gravity.main) * dt
        w.y += w.vy * dt
        if (w.y <= 0) {
          w.y = 0
          w.vy = 0
        }
      }
    }
    this.updateInteractions(dt, width)
    this.prune()

    // Événements spontanés : relais ou file d'attente (le prototype les déclenche par des boutons)
    if (!this.mood.call) {
      this.ambient -= dt
      if (this.ambient <= 0) {
        this.ambient = this.rnd(GARDEN.ambientEvery)
        this.trigger(this.coin(0.5) ? 'handoff' : 'queue')
      }
    }
    if (this.mood.music && this.coin(dt * GARDEN.noteRate)) {
      const mains = this.mains()
      const nw = mains[Math.floor(this.rng() * mains.length)]
      if (nw) this.addFx('note', '♪', nw.x - 3, this.headY(nw) - 10, GARDEN.fxLife.note)
    }
    for (const e of this.effects) e.age += dt
    this.effects = this.effects.filter((e) => e.age < e.life)
  }

  private mainStep(w: Walker, dt: number, width: number): void {
    if (w.mode === 'interact') return
    const mood = this.mood
    const spd = (mood.call ? GARDEN.callSlowdown : 1) * (w.sulk > 0 ? GARDEN.sulkSlowdown : 1)
    if (w.sulk > 0) w.sulk -= dt
    // Bloqué : il s'assoit et attend de l'aide
    if (w.sad) {
      w.mode = 'stand'
      return
    }
    // Fête ou accueil : il se tourne vers l'autre et saute
    if (w.cheer > 0) {
      w.cheer -= dt
      w.mode = 'walk'
      if (w.cheerAt) w.dir = sign(w.cheerAt.x - w.x) || w.dir
      if (w.y === 0 && this.coin(dt * GARDEN.cheerHopRate)) w.vy = GARDEN.cheerHopSpeed
      return
    }
    // Saute-mouton
    if (w.leap > 0) {
      w.leap -= dt
      w.x += w.dir * GARDEN.leap.speed * dt
      this.wrap(w, width)
      return
    }
    if (w.apologize) {
      w.apologize.wait -= dt
      if (w.apologize.wait <= 0) {
        w.meet = { to: w.apologize.to, type: 'apology' }
        w.apologize = null
      }
    }
    // Rendez-vous avec un autre Claude (relais, aide, file d'attente, excuses)
    if (w.meet) {
      const o = w.meet.to
      if (o.mode !== 'interact') {
        const d = o.x - w.x
        w.dir = sign(d) || 1
        w.x += w.dir * GARDEN.meetSpeed * dt
        w.mode = 'walk'
        if (Math.abs(d) < GARDEN.meetDistance && w.y === 0 && o.y === 0) {
          const type = w.meet.type
          w.meet = null
          this.startInteraction(w, o, type)
        }
      }
      return
    }
    // En conflit : les deux Claude vont l'un vers l'autre pour s'expliquer
    if (w.conflictWith) {
      const o = w.conflictWith
      if (o.mode !== 'interact') {
        const d = o.x - w.x
        w.dir = sign(d) || 1
        w.x += w.dir * GARDEN.conflictSpeed * dt
        w.mode = 'walk'
        if (Math.abs(d) < GARDEN.conflictDistance && w.y === 0 && o.y === 0) this.startInteraction(w, o, 'conflict')
      }
      return
    }
    if (w.mode === 'check' || w.mode === 'pause') {
      w.t -= dt
      if (w.t <= 0) {
        if (w.mode === 'check' || this.coin(GARDEN.pauseTurnChance)) w.dir *= -1
        w.mode = 'walk'
      }
      return
    }
    w.mode = 'walk'
    w.x += w.dir * w.speed * spd * dt
    w.cool -= dt
    if (this.coin(dt * GARDEN.pauseRate)) {
      w.mode = 'pause'
      w.t = this.rnd(GARDEN.pauseDuration)
    } else if (!mood.call && w.y === 0 && this.coin(dt * GARDEN.hopRate)) w.vy = GARDEN.hopSpeed
    this.wrap(w, width)
    if (w.cool > 0 || w.y !== 0) return
    // Deux Claude qui se croisent interagissent : check, discussion, bisou, câlin, bagarre ou énervement
    const [near, far] = GARDEN.crossDistance
    for (const o of this.list) {
      if (
        o === w ||
        o.sub ||
        o.dead ||
        o.retiring ||
        o.delay > 0 ||
        o.mode !== 'walk' ||
        o.cool > 0 ||
        o.y !== 0 ||
        this.statusOf(o) !== 'working' ||
        w.mode !== 'walk' ||
        o.conflictWith
      ) {
        continue
      }
      const dx = o.x - w.x
      if (Math.abs(dx) < far && Math.abs(dx) > near && w.dir === sign(dx) && o.dir === -sign(dx)) {
        this.startInteraction(w, o, this.pickType())
      }
    }
    // Deux Claude qui marchent dans le même sens : saute-mouton ou course
    const [min, max] = GARDEN.followDistance
    for (const o of this.list) {
      if (
        o === w ||
        o.sub ||
        o.dead ||
        o.retiring ||
        o.delay > 0 ||
        o.mode !== 'walk' ||
        w.mode !== 'walk' ||
        o.dir !== w.dir ||
        o.y !== 0 ||
        w.y !== 0 ||
        this.statusOf(o) !== 'working' ||
        o.sad ||
        o.cheer > 0 ||
        mood.call
      ) {
        continue
      }
      const ahead = (o.x - w.x) * w.dir
      if (ahead > min && ahead < max && this.coin(dt * GARDEN.followRate)) {
        if (this.coin(GARDEN.leapChance)) {
          w.leap = GARDEN.leap.duration
          w.vy = GARDEN.leap.jump
          w.cool = this.rnd(GARDEN.leap.cooldown)
        } else if (o.cool <= 0) {
          const d = w.dir
          w.cool = this.rnd(GARDEN.raceCooldown)
          o.cool = this.rnd(GARDEN.raceCooldown)
          this.startInteraction(w, o, 'race')
          w.dir = d
          o.dir = d
        }
      }
    }
  }

  /** Haut de la pile de sous-agents perchés sur le parent (prototype : stackTop). */
  private stackTop(p: Walker): Walker {
    let top = p
    let found = true
    while (found) {
      found = false
      for (const r of this.list) {
        if (r.sub && !r.dead && r.mode === 'ride' && r.target === top) {
          top = r
          found = true
          break
        }
      }
    }
    return top
  }

  private subStep(w: Walker, dt: number, width: number): void {
    const p = w.parent
    if (!p) return
    const S = GARDEN.sub
    const call = this.mood.call
    const tg = w.target ?? p
    // Le sous-agent a fini : il court vers son parent et lui saute dans les bras
    if (w.mode === 'home') {
      const dh = p.x - w.x
      w.dir = sign(dh) || 1
      w.x += w.dir * S.homeSpeed * dt
      if (Math.abs(dh) < S.homeDistance && w.y === 0) {
        w.vy = S.homeJump
        w.mode = 'homeJump'
      }
      return
    }
    if (w.mode === 'homeJump') {
      w.x += (p.x - w.x) * Math.min(1, dt * S.homeFollow)
      if (w.vy < 0 && w.y <= p.y + p.size * GARDEN.headRatio + 2) {
        this.spark(p.x, this.headY(p) - 10)
        w.dead = true
        p.vy = Math.max(p.vy, S.parentCatch)
      }
      return
    }
    if (w.mode === 'blink') {
      w.t -= dt
      w.op = Math.max(0, w.op - dt * S.blinkFade)
      if (w.t <= 0) {
        w.x = this.rnd([S.blinkMargin, width - S.blinkMargin])
        w.mode = 'walk'
      }
      return
    }
    if (w.mode === 'ride') {
      w.x = tg.x + 1
      w.y = tg.y + tg.size * GARDEN.headRatio
      w.vy = 0
      w.dir = tg.dir
      w.t -= dt
      if (
        w.t <= 0 ||
        this.statusOf(p) !== 'working' ||
        p.mode === 'interact' ||
        p.sad ||
        tg.dead ||
        (tg.sub && tg.mode !== 'ride')
      ) {
        w.mode = 'walk'
        w.vy = S.rideJumpOff
        w.dir = this.randomDir()
        w.target = null
      }
      return
    }
    if (w.mode === 'seek') {
      const dx = tg.x - w.x
      w.dir = sign(dx) || 1
      w.x += w.dir * S.seekSpeed * dt
      w.t -= dt
      if (Math.abs(dx) < S.seekDistance && w.y === 0) {
        w.vy = tg === p ? S.jumpOnParent : S.jumpOnSibling
        w.mode = 'jumpOn'
      } else if (w.t <= 0) w.mode = 'walk'
      return
    }
    if (w.mode === 'jumpOn') {
      const top = tg.y + tg.size * GARDEN.headRatio
      w.x += (tg.x - w.x) * Math.min(1, dt * S.jumpOnFollow)
      if (w.vy < 0 && w.y <= top + 1 && w.y > top - 4) {
        w.mode = 'ride'
        w.t = this.rnd(S.ride)
      } else if (w.y === 0 && w.vy === 0) w.mode = 'walk'
      return
    }
    // Course en zigzag, petits sauts, téléportations
    w.mode = 'walk'
    w.x += w.dir * w.speed * (call ? GARDEN.callSlowdown : 1) * dt
    w.t -= dt
    if (w.t <= 0) {
      w.dir = this.randomDir()
      w.t = this.rnd(S.zigzag)
      w.speed = this.rnd(S.zigzagSpeed)
    }
    if (w.y === 0 && this.coin(dt * (call ? S.callHopRate : S.hopRate))) w.vy = this.rnd(S.hopSpeed)
    // Grimper sur le parent, ou sur un frère déjà perché (pyramide)
    const st0 = this.stackTop(p)
    const chance = st0 !== p ? S.stackRate : S.climbRate
    if (this.coin(dt * chance) && this.statusOf(p) === 'working' && p.mode === 'walk' && !p.sad) {
      w.target = st0
      w.mode = 'seek'
      w.t = S.seekTime
    } else if (this.coin(dt * S.blinkRate)) {
      w.mode = 'blink'
      w.t = S.blinkDuration
    }
    this.wrap(w, width)
  }

  private once(ia: Interaction, key: string, at: number): boolean {
    if (ia.t >= at && !ia.marks.has(key)) {
      ia.marks.add(key)
      return true
    }
    return false
  }

  private updateInteractions(dt: number, width: number): void {
    const H = this.height
    const top = H - groundOffset(this.platform) - MAIN_TOP_RATIO
    const k6 = Math.min(1, dt * GARDEN.placeRate)
    this.ias = this.ias.filter((ia) => {
      const { a, b } = ia
      const gap = ia.gap ?? GARDEN.gap[ia.type]
      const mx = ia.mid
      ia.t += dt
      // Se placer face à face
      if (!ia.noPlace) {
        a.x += (mx + (ia.sa * gap) / 2 - a.x) * k6
        b.x += (mx + (ia.sb * gap) / 2 - b.x) * k6
      }
      switch (ia.type) {
        case 'check':
          if (this.once(ia, 'hop', 0)) {
            a.vy = 60
            b.vy = 60
            this.spark(mx)
          }
          break
        case 'handoff':
          if (this.once(ia, 'p', 0.2)) ia.paper = this.addFx('paper', '', a.x - 3, top - 6, GARDEN.fxLife.paper)
          if (ia.paper && ia.t >= 0.3 && ia.t <= 0.9) {
            const u = (ia.t - 0.3) / 0.6
            ia.paper.x = a.x + (b.x - a.x) * u - 3
            ia.paper.y = top - 6 - Math.sin(u * Math.PI) * 8
          }
          if (this.once(ia, 'got', 0.95)) {
            this.removeFx(ia.paper)
            ia.paper = null
            b.vy = 45
            this.say(b, '!')
          }
          break
        case 'comfort':
          a.rot = ia.t < 2 ? 12 * a.dir * Math.max(0, Math.sin(ia.t * 9)) : 0
          if (this.once(ia, 'h', 2.1)) {
            this.addFx('heart', '♥', mx - 3, top - 8, GARDEN.fxLife.smallHeart, { small: true })
            b.sad = false
            b.comforted = true
            b.vy = 50
          }
          break
        case 'queue':
          a.sit = true
          if (a.y === 0 && this.coin(dt * 4)) a.vy = 14
          if (this.once(ia, 'w1', 0.3)) this.say(a, '…')
          if (this.once(ia, 'w2', 1.8)) this.say(a, '…')
          if (this.once(ia, 'ok', 3.2)) this.say(b, 'ok')
          if (this.once(ia, 'yay', 3.5)) {
            a.sit = false
            a.vy = 70
            this.spark(a.x)
          }
          break
        case 'dance': {
          const beat = Math.floor(ia.t / 0.4)
          if (this.once(ia, `b${beat}`, beat * 0.4)) {
            a.vy = 55
            b.vy = 55
            a.dir *= -1
            b.dir *= -1
          }
          if (this.mood.music && this.once(ia, 'n', 0.3)) this.addFx('note', '♪', mx - 3, top - 10, GARDEN.fxLife.note)
          break
        }
        case 'whisper': {
          const lk = Math.min(1, ia.t / 0.25) * Math.min(1, Math.max(0, (1.1 - ia.t) / 0.25))
          a.rot = 12 * a.dir * lk
          if (this.once(ia, 'w', 0.3)) this.say(a, '…', false, true)
          if (ia.t > 1 && ia.t < 1.6) b.blush = true
          break
        }
        case 'apology':
          if (this.once(ia, 's', 0.2)) this.say(a, '…')
          if (this.once(ia, 'h', 0.9)) {
            this.addFx('heart', '♥', mx - 4, top - 10, GARDEN.fxLife.heart)
            b.sulk = 0
          }
          if (this.once(ia, 'hop', 1.2)) {
            a.vy = 50
            b.vy = 50
          }
          break
        case 'race': {
          if (!ia.race) ia.race = { da: 0, db: 0, va: this.rnd([60, 85]), vb: this.rnd([60, 85]) }
          const r = ia.race
          a.x += a.dir * r.va * dt
          b.x += b.dir * r.vb * dt
          r.da += r.va * dt
          r.db += r.vb * dt
          this.wrap(a, width)
          this.wrap(b, width)
          if (this.once(ia, 'win', 1.5)) {
            const winner = r.da > r.db ? a : b
            winner.vy = 80
            this.spark(winner.x, this.headY(winner) - 12)
          }
          break
        }
        case 'talk':
          if (this.once(ia, '1', 0.1)) {
            this.say(a, '…')
            a.vy = 30
          }
          if (this.once(ia, '2', 0.9)) {
            this.say(b, '?')
            b.vy = 30
          }
          if (this.once(ia, '3', 1.7)) {
            this.say(a, '!')
            a.vy = 30
          }
          break
        case 'kiss':
          if (this.once(ia, 'hop', 0.35)) {
            a.vy = 35
            b.vy = 35
          }
          if (this.once(ia, 'h', 0.5)) this.addFx('heart', '♥', mx - 4, top - 10, GARDEN.fxLife.heart)
          break
        case 'hug': {
          const k = Math.min(1, ia.t / 0.3) * Math.min(1, Math.max(0, (GARDEN.duration.hug - ia.t) / 0.3))
          a.rot = 9 * a.dir * k
          b.rot = 9 * b.dir * k
          if (this.once(ia, 'h1', 0.5)) this.addFx('heart', '♥', mx - 6, top - 8, GARDEN.fxLife.smallHeart, { small: true })
          if (this.once(ia, 'h2', 1.0)) this.addFx('heart', '♥', mx + 1, top - 10, GARDEN.fxLife.smallHeart, { small: true })
          break
        }
        case 'fight':
          if (ia.t > 0.25 && ia.t < 1.6) {
            a.hidden = true
            b.hidden = true
            if (!ia.cloud) ia.cloud = this.addFx('cloud', '', mx - 13, top - 4, GARDEN.fxLife.cloud)
            ia.cloud.jx = this.rnd([-1.5, 1.5])
            ia.cloud.jy = this.rnd([-1.5, 1.5])
            if (this.coin(dt * 9)) {
              this.addFx('star', '✦', mx - 3, top, GARDEN.fxLife.star, {
                dx: Math.round(this.rnd([-14, 14])),
                dy: Math.round(this.rnd([-12, -2])),
              })
            }
          }
          if (this.once(ia, 'out', 1.6)) {
            a.hidden = false
            b.hidden = false
            this.removeFx(ia.cloud)
            ia.cloud = null
            ia.gap = 30
            a.x = mx + ia.sa * 6
            b.x = mx + ia.sb * 6
            a.vy = 90
            b.vy = 90
          }
          break
        case 'annoyed':
          a.angry = true
          if (this.coin(dt * 3.5)) {
            this.addFx('steam', '~', a.x - 3 + this.rnd([-3, 3]), this.headY(a) - 8, GARDEN.fxLife.steam)
          }
          if (a.y === 0 && this.coin(dt * 2.5)) a.vy = 40
          if (this.once(ia, 'q', 0.5)) this.say(b, '?')
          if (this.once(ia, 'turn', 1.2)) {
            b.dir *= -1
            ia.gap = 44
          }
          break
        case 'conflict':
          if (ia.t < 2.8) {
            a.angry = true
            b.angry = true
            a.shake = this.rnd([-1, 1])
            b.shake = this.rnd([-1, 1])
            if (this.once(ia, 'c1', 0.2)) this.say(a, '!', true)
            if (this.once(ia, 'c2', 0.8)) this.say(b, '!', true)
            if (this.once(ia, 'c3', 1.4)) this.say(a, '!!', true)
            if (this.once(ia, 'c4', 2.0)) this.say(b, '!!', true)
            if (this.coin(dt * 3)) {
              const who = this.coin(0.5) ? a : b
              this.addFx('steam', '~', who.x - 3, top - 8, GARDEN.fxLife.steam)
            }
          } else {
            a.angry = false
            b.angry = false
            a.shake = 0
            b.shake = 0
            if (this.once(ia, 't1', 3.0)) this.say(a, '…')
            if (this.once(ia, 't2', 3.8)) this.say(b, '?')
            if (this.once(ia, 't3', 4.6)) this.say(a, 'ok')
            if (this.once(ia, 't4', 5.3)) {
              a.vy = 60
              b.vy = 60
              this.spark(mx)
            }
          }
          break
      }
      if (ia.t >= GARDEN.duration[ia.type]) {
        this.endInteraction(ia)
        return false
      }
      return true
    })
  }
}

export interface VisualContext {
  /** Largeur courante de la forme (px) : bords en portail. */
  width: number
  /** Hauteur courante de la forme (px). */
  height: number
  platform: IslandPlatform
  mood: GardenMood
  reduced: boolean
  /** Temps (s) pour le balancement de la marche. */
  now: number
}

/** Comment dessiner un personnage (prototype : renderGarden). */
export function walkerVisual(w: Walker, status: ClaudeSessionStatus, ctx: VisualContext): WalkerVisual {
  const ground = ctx.height - groundOffset(ctx.platform)
  let bob = 0
  // Musique : ceux qui travaillent hochent la tête sur le tempo, même à l'arrêt ; les autres restent immobiles.
  const nod = ctx.mood.music && status === 'working' && w.y === 0 && !ctx.reduced && w.mode !== 'interact'
  if (nod) {
    bob = Math.abs(Math.sin((ctx.now * Math.PI * GARDEN.musicTempoBpm) / 60)) * GARDEN.bob.musicAmplitude
  } else if (w.mode === 'walk' && w.y === 0 && !ctx.reduced && !ctx.mood.music) {
    bob =
      Math.abs(Math.sin(ctx.now * (w.sub ? GARDEN.bob.subFreq : GARDEN.bob.mainFreq) + w.size)) *
      (ctx.mood.call ? GARDEN.bob.callAmplitude : GARDEN.bob.amplitude)
  }
  const low = w.sad || w.sit
  const top = ground - w.size * GARDEN.footRatio - w.y - bob
  const colorToken = w.angry
    ? GARDEN_ANGRY_TOKEN
    : w.blush
      ? GARDEN_BLUSH_TOKEN
      : (GARDEN_COLOR_TOKENS[w.colorSlot] ?? GARDEN_COLOR_TOKENS[0])
  let opacity = w.op
  if (w.delay > 0 || w.hidden) opacity = 0
  else if (!w.sub && status === 'idle') opacity = Math.min(w.op, GARDEN.idleOpacity)
  if (ctx.reduced && w.sub && status !== 'working') opacity = 0
  const lid =
    w.blink > 0 || (!w.sub && status === 'sleep')
      ? GARDEN.lidClosed
      : !w.sub && (status === 'done' || status === 'idle' || status === 'background' || w.sad || w.sulk > 0)
        ? GARDEN.lidHalf
        : 0
  const bubble: BubbleKind | null = w.sub
    ? null
    : status === 'waiting'
      ? 'wait'
      : status === 'done'
        ? 'done'
        : w.sad
          ? 'err'
          : null
  const left = w.x - w.size / 2 + w.shake
  return {
    left,
    twinLeft: twinLeftOf(left, w.size, ctx.width),
    top,
    rot: w.rot,
    scaleX: w.sc * (low ? GARDEN.squash.x : 1),
    scaleY: w.sc * (low ? GARDEN.squash.y : 1),
    colorToken,
    opacity: Math.max(0, Math.min(1, opacity)),
    lid,
    bubble,
  }
}

/** Jumeau du portail : le sprite [left, left + size] chevauche un bord → la même image de l'autre côté. */
export function twinLeftOf(left: number, size: number, width: number): number | null {
  if (width <= 0) return null
  if (left < 0) return left + width
  if (left + size > width) return left - width
  return null
}
