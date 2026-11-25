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
 * - Bords en portail : les bords de l'île, et sur le Mac au repos les deux bords de l'encoche de la caméra
 *   (coordonnée repliée, voir throughNotch) ; les écarts entre deux Claude se mesurent à travers l'encoche.
 * - Le hasard est injecté (`rng`) pour les tests.
 */
import { activityProp, type GardenProp } from '../art/props'
import type { ClaudeActivity, ClaudeSessionStatus, IslandPlatform } from '../types'
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
  /** Ce que fait la session (outil en cours) : accessoire du personnage quand il s'arrête pour travailler. */
  activity?: ClaudeActivity | null
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
  /** Vrai son analysé et silencieux (Windows) : personne ne hoche la tête, donc pas de notes. */
  musicSilent?: boolean
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
  /** Vitesse de croisière visée (px/s). */
  speed: number
  /** Personnage principal : vitesse courante (px/s), qui accélère et freine vers la vitesse visée. */
  vel: number
  /** Temps avant la prochaine vitesse de croisière (s). */
  cruiseT: number
  /** Freine avant une pause. */
  stopping: boolean
  /** Pause de travail (session qui travaille) : il s'est posé pour faire ce que fait sa session. */
  busy: boolean
  /** Temps de marche avant de pouvoir se poser à nouveau (s) : il change d'endroit entre deux pauses. */
  roam: number
  /** Phase des pattes (rad, une demi-période par pas) et amplitude du pas (0 : pattes posées, 1 : il marche). */
  gait: number
  stepAmp: number
  /** Position à l'image précédente (NaN : pas encore mesurée), pour la cadence des pas. */
  px: number
  /** Plan de profondeur attitré (0 devant) et profondeur courante (glisse vers le plan visé). */
  plane: number
  depth: number
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
  /** Sieste : 0 debout, 1 posé sur le ventre (pattes repliées). */
  rest: number
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
  /** Tombe parce que le sol est descendu (île ouverte) : chute libre forte, rebond à l'arrivée. */
  falling: boolean
  dead: boolean
  /** Session partie ou sous-agent fini : retiré à la fin de son fondu ou de son retour. */
  retiring: boolean
}

export type FxKind = 'say' | 'heart' | 'steam' | 'star' | 'cloud' | 'paper' | 'z' | 'note' | 'spark' | 'ask'

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

/** Pose d'une patte : levée (px, vers le haut) et avancée (px, dans le sens de la marche). */
export interface LegPose {
  lift: number
  shift: number
}

/** Bande verticale visible (px depuis la gauche du contenu) : le dessin est coupé hors de [min, max]. */
export interface ClipRange {
  min: number
  max: number
}

/** Comment dessiner un personnage à cette image. */
export interface WalkerVisual {
  /** Translation du sprite (coin haut gauche, px), rotation (deg), échelle. */
  left: number
  /**
   * Portail : position du jumeau quand le sprite dépasse un bord de l'île (même image décalée d'une largeur :
   * la partie qui sort d'un côté rentre de l'autre) ou chevauche l'encoche du Mac (décalée de la largeur de
   * l'encoche) ; null quand il est entier d'un côté.
   */
  twinLeft: number | null
  /** Encoche : bande visible du sprite et de son jumeau (coupés au bord de l'encoche) ; null : rien à couper. */
  clip: ClipRange | null
  twinClip: ClipRange | null
  top: number
  rot: number
  scaleX: number
  scaleY: number
  /** Token de couleur du corps (sans var()). */
  colorToken: string
  opacity: number
  /** Hauteur des paupières (% du sprite). */
  lid: number
  /** Yeux fermés (sieste, clignement) : dessinés en traits. */
  closed: boolean
  bubble: BubbleKind | null
  /** Accessoire de son activité quand il s'est posé pour travailler ; null en marchant ou hors du travail. */
  prop: GardenProp | null
  /** Profondeur courante (0 devant, GARDEN.depth.planes - 1 au fond) : assombrissement (--garden-depth). */
  depth: number
  /** Ordre d'affichage : profondeur d'abord (devant par-dessus), puis sous-agents, puis ceux qui sont perchés. */
  zIndex: number
  /** Pattes des colonnes 3, 5, 10, 12 du masque (paires 3 + 10 et 5 + 12 en alternance). */
  legs: readonly [LegPose, LegPose, LegPose, LegPose]
  /** Haut du corps (corps, yeux, paupières) : montée (px, négatif : il descend) et inclinaison (deg). */
  bodyLift: number
  nod: number
  /** Ombre de contact au sol : haut de sa boîte (même boîte que le sprite posé au sol), échelle, opacité. */
  shadowTop: number
  shadowScale: number
  shadowOpacity: number
}

export const BUBBLE_TEXT: Record<BubbleKind, string> = { wait: '!', done: '✓', err: '?' }

const MAIN_TOP_RATIO = GARDEN.size.main * GARDEN.headRatio

function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0
}

export function groundOffset(platform: IslandPlatform): number {
  return GARDEN.groundOffset[platform]
}

/** Bords de l'encoche de la caméra (px depuis la gauche du contenu). */
export interface NotchSpan {
  left: number
  right: number
}

/**
 * Encoche de la caméra quand elle compte : Mac, île au repos (la tête d'un Claude posé au sol est à hauteur de
 * l'encoche). Île ouverte, le sol est bien plus bas et l'encoche ne gêne personne : null, comme sous Windows.
 */
export function notchSpan(platform: IslandPlatform, width: number, height: number): NotchSpan | null {
  if (platform !== 'mac' || width <= GARDEN.notch.width) return null
  const head = height - groundOffset(platform) - GARDEN.size.main * GARDEN.headRatio
  if (head >= GARDEN.notch.height) return null
  return { left: (width - GARDEN.notch.width) / 2, right: (width + GARDEN.notch.width) / 2 }
}

/**
 * Coordonnée repliée : l'encoche n'a plus de largeur, ses deux bords sont collés (un portail, comme les bords
 * de l'île). Une position sous l'encoche (impossible en marche) compte comme posée sur le portail.
 */
export function foldX(x: number, notch: NotchSpan | null): number {
  if (!notch || x <= notch.left) return x
  if (x >= notch.right) return x - (notch.right - notch.left)
  return notch.left
}

/** Position à l'écran d'une coordonnée repliée : jamais sous l'encoche. */
export function unfoldX(u: number, notch: NotchSpan | null): number {
  if (!notch || u <= notch.left) return u
  return u + (notch.right - notch.left)
}

/** Sessions représentées : les 5 premières (comme les lignes de multiOpen). */
export function gardenSessions<T extends GardenSession>(sessions: readonly T[]): T[] {
  return sessions.slice(0, GARDEN.maxSessions)
}

/**
 * Animations réduites : les sous-agents sont montrés tant que leur parent travaille, ou patiente pendant
 * qu'ils tournent en arrière-plan (demande de Maël, 25/11).
 */
function subsVisible(status: ClaudeSessionStatus): boolean {
  return status === 'working' || status === 'background'
}

export class GardenSim {
  private list: Walker[] = []
  private ias: Interaction[] = []
  private effects: Fx[] = []
  private readonly sessions = new Map<string, GardenSession>()
  private nextId = 1
  private nextFxId = 1
  /** Largeur courante de la forme (px) : bords en portail et encoche. */
  private width = 0
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

  /** Activité de la session d'un personnage (outil en cours) ; null si inconnue. */
  activityOf(w: Walker): ClaudeActivity | null {
    return this.sessions.get(w.sessionId)?.activity ?? null
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
    const plane = parent ? parent.plane : this.freePlane()
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
      vel: 0,
      cruiseT: this.rnd(GARDEN.walk.cruiseEvery),
      stopping: false,
      busy: false,
      roam: sub ? 0 : this.rnd(GARDEN.work.firstRoam),
      gait: 0,
      stepAmp: 0,
      px: NaN,
      plane,
      depth: parent ? parent.depth : plane,
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
      rest: 0,
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
      falling: false,
      dead: false,
      retiring: false,
    }
  }

  private freeColorSlot(): number {
    const used = new Set(this.list.filter((w) => !w.sub && !w.dead).map((w) => w.colorSlot))
    for (let i = 0; i < GARDEN_COLOR_TOKENS.length; i++) if (!used.has(i)) return i
    return this.list.filter((w) => !w.sub).length % GARDEN_COLOR_TOKENS.length
  }

  /** Plan le moins occupé par les personnages principaux (le plus en avant à égalité : seul, il est devant). */
  private freePlane(): number {
    const count = Array.from({ length: GARDEN.depth.planes }, () => 0)
    for (const w of this.list) {
      if (!w.sub && !w.dead && !w.retiring) count[w.plane] = (count[w.plane] ?? 0) + 1
    }
    let best = 0
    count.forEach((c, i) => {
      if (c < (count[best] ?? 0)) best = i
    })
    return best
  }

  private settleStill(w: Walker): void {
    w.delay = 0
    w.op = 1
    w.sc = 1
    w.y = 0
    w.vy = 0
    w.vel = 0
    w.stopping = false
    w.stepAmp = 0
    w.px = NaN
    w.depth = w.parent ? w.parent.plane : w.plane
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
    this.width = opts.width
    this.height = opts.height
    this.platform = opts.platform
    const shown = gardenSessions(sessions)
    const n = Math.max(1, shown.length)
    const mains = shown.map((s, i) => {
      this.sessions.set(s.id, { ...s })
      const w = this.makeWalker(s.id, null, i)
      w.x = this.startX(i, n)
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
    this.place(w, this.fold(parent.x) + this.rnd([-GARDEN.subSpawnSpread, GARDEN.subSpawnSpread]))
    if (parentIndex !== null) {
      w.delay = GARDEN.appearDelay.sub + k * GARDEN.appearDelay.subStep + parentIndex * GARDEN.appearDelay.subParentStep
    }
    if (opts.reduced) {
      this.settleStill(w)
      this.placeReducedSub(w, parent, k)
      if (!subsVisible(this.statusOf(parent))) w.op = 0
    }
    this.list.push(w)
    return w
  }

  /** Animations réduites : sous-agent rangé à droite du parent, immobile, jamais à cheval sur l'encoche. */
  private placeReducedSub(w: Walker, parent: Walker, k: number): void {
    const u = this.fold(parent.x) + GARDEN.reducedSubOffset + k * GARDEN.reducedSubGap
    this.place(w, this.clearOfNotch(u, w.size / 2))
  }

  /** Place de départ de la session i sur n : réparties sur la largeur (repliée), hors du portail de l'encoche. */
  private startX(i: number, n: number): number {
    const span = this.foldedWidth()
    const u = ((i + 0.5) * span) / Math.max(1, n) + this.rnd([-GARDEN.startJitter, GARDEN.startJitter])
    return this.unfold(this.clearOfNotch(u, GARDEN.size.main / 2))
  }

  // --- Sessions réelles ---------------------------------------------------------------------------------------

  /**
   * Accorde le jardin aux sessions reçues : arrivées, départs, changements de statut, sous-agents, conflits.
   * Les effets visibles (fête, réveil, accueil) ne se jouent que si le jardin est à l'écran et animé.
   */
  sync(sessions: readonly GardenSession[], opts: GardenSyncOptions): void {
    // Largeur : celle de la dernière image (ressort en cours) ; avant la première, celle de la forme visée.
    if (this.width <= 0) this.width = opts.width
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
      w.x = this.randomX(GARDEN.hello.margin)
      w.y = GARDEN.hello.y
      w.sc = GARDEN.hello.scale
      for (const o of this.mains()) {
        if (o !== w && this.isFree(o)) {
          o.cheer = GARDEN.hello.cheer
          o.cheerAt = w
        }
      }
    } else {
      w.x = this.startX(i, n)
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
      // Immobiles : personne ne reste à cheval sur le portail de l'encoche.
      parent.x = this.unfold(this.clearOfNotch(this.fold(parent.x), parent.size / 2))
      const shown = subsVisible(this.statusOf(parent))
      this.subsOf(parent).forEach((sub, k) => {
        this.placeReducedSub(sub, parent, k)
        sub.op = shown ? 1 : 0
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

  // --- Encoche du Mac : portail -------------------------------------------------------------------------------
  //
  // Mac, île au repos : l'encoche de la caméra cache le milieu du bord haut. Ses deux bords sont une paire de
  // portails, comme les bords de l'île : la partie d'un Claude qui franchit le bord gauche de l'encoche
  // apparaît aussitôt au bord droit (et inversement), il traverse à sa vitesse de marche, sans saut ni
  // disparition. On raisonne en coordonnée repliée (foldX : l'encoche n'a plus de largeur, son portail est à
  // `notch.left`) ; `w.x` reste la position à l'écran, jamais sous l'encoche. Le dessin coupe le personnage au
  // bord de l'encoche des deux côtés (walkerVisual : clip, jumeau). Île ouverte ou Windows : aucun effet.

  /** Encoche active à cette image (Mac, île au repos), sinon null. */
  private notch(): NotchSpan | null {
    return notchSpan(this.platform, this.width, this.height)
  }

  private fold(x: number): number {
    return foldX(x, this.notch())
  }

  private unfold(u: number): number {
    return unfoldX(u, this.notch())
  }

  /** Largeur repliée : celle de la forme moins l'encoche. */
  private foldedWidth(): number {
    const n = this.notch()
    return n ? this.width - (n.right - n.left) : this.width
  }

  /** Pose un personnage à la position repliée `u`. */
  private place(w: Walker, u: number): void {
    w.x = this.unfold(u)
  }

  /** Écart de w à o (positif : o est à droite), à travers le portail de l'encoche. */
  private gapTo(w: Walker, o: Walker): number {
    return this.fold(o.x) - this.fold(w.x)
  }

  /** Position au hasard sur la largeur, à `margin` px des bords de l'île (jamais sous l'encoche). */
  private randomX(margin: number): number {
    return this.unfold(this.rnd([margin, Math.max(margin, this.foldedWidth() - margin)]))
  }

  /**
   * Position repliée `u` d'un corps de demi-largeur `half` écartée du portail de l'encoche : à au moins
   * GARDEN.notch.gap px de chaque bord, du côté où est la plus grande partie du corps.
   */
  private clearOfNotch(u: number, half: number): number {
    const n = this.notch()
    if (!n) return u
    const reach = half + GARDEN.notch.gap
    if (Math.abs(u - n.left) >= reach) return u
    return u < n.left ? n.left - reach : n.left + reach
  }

  /** À cheval sur le portail de l'encoche, ou à moins de GARDEN.notch.gap px d'un de ses bords. */
  private nearNotch(w: Walker): boolean {
    const n = this.notch()
    return !!n && Math.abs(this.fold(w.x) - n.left) < w.size / 2 + GARDEN.notch.gap
  }

  /**
   * Après les déplacements de l'image : celui dont le centre vient d'entrer sous l'encoche continue de l'autre
   * côté, du même pas (sa coordonnée repliée ne saute pas). Un personnage principal arrêté à cheval sur le
   * portail (session qui ne travaille plus, fête, fin de rendez-vous) s'en écarte à pied, du côté où est la plus
   * grande partie de son corps, jusqu'à GARDEN.notch.gap px du bord.
   */
  private throughNotch(dt: number): void {
    const n = this.notch()
    if (!n) return
    const cut = n.right - n.left
    for (const w of this.list) {
      if (w.dead) continue
      if (w.x > n.left && w.x < n.right) {
        let dx = Number.isNaN(w.px) ? 0 : w.x - w.px
        if (Math.abs(dx) > this.width / 2) dx -= Math.sign(dx) * this.width
        if (dx > 0 && w.px <= n.left) w.x += cut
        else if (dx < 0 && w.px >= n.right) w.x -= cut
        // Posé dessous sans y être entré (la forme vient de changer de largeur) : sur le portail.
        else w.x = w.x - n.left < n.right - w.x ? n.left : n.right
        this.wrap(w, this.width)
      }
      if (!w.sub && w.mode !== 'interact' && w.vel === 0 && w.y === 0 && this.nearNotch(w)) {
        const u = this.fold(w.x)
        const out = u < n.left ? -1 : u > n.left ? 1 : w.dir >= 0 ? 1 : -1
        const edge = n.left + out * (w.size / 2 + GARDEN.notch.gap)
        const step = GARDEN.notch.exitSpeed * dt
        w.dir = out
        this.place(w, out < 0 ? Math.max(edge, u - step) : Math.min(edge, u + step))
      }
    }
  }

  /**
   * Point de rencontre (replié) d'une interaction : décalé au plus près pour qu'aucun des deux ne reste à cheval
   * sur le portail de l'encoche (à moins de GARDEN.notch.gap px), avec l'écart du début comme avec celui de la
   * fin (bagarre, énervement). Les deux le rejoignent en traversant le portail si besoin.
   */
  private meetingPoint(mid: number, type: InteractionType, a: Walker, b: Walker): number {
    const n = this.notch()
    if (!n || type === 'race') return mid
    const reach = Math.max(a.size, b.size) / 2 + GARDEN.notch.gap
    const later: Partial<Record<InteractionType, number>> = GARDEN.gapLater
    const gaps = [GARDEN.gap[type], later[type] ?? GARDEN.gap[type]]
    // Points de rencontre interdits : ceux où l'un des deux corps chevauche le portail.
    const banned = gaps.flatMap((g) => [-1, 1].map((s) => [n.left - (s * g) / 2 - reach, n.left - (s * g) / 2 + reach] as const))
    const allowed = (m: number) => banned.every(([lo, hi]) => m <= lo || m >= hi)
    let best = mid
    let bestD = allowed(mid) ? 0 : Infinity
    for (const [lo, hi] of banned) {
      for (const m of [lo, hi]) {
        const d = Math.abs(m - mid)
        if (d < bestD && allowed(m)) {
          best = m
          bestD = d
        }
      }
    }
    return best
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
      const d = Math.abs(this.gapTo(w, o))
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
    for (const w of [a, b]) {
      w.mode = 'interact'
      w.vy = 0
      w.vel = 0
      w.stopping = false
    }
    // Écart et point de rencontre en coordonnée repliée : à travers le portail de l'encoche.
    const d = this.gapTo(a, b)
    a.dir = sign(d) || 1
    b.dir = -a.dir
    const sa = d > 0 ? -1 : 1
    this.ias.push({
      a,
      b,
      sa,
      sb: -sa,
      type,
      t: 0,
      mid: this.meetingPoint((this.fold(a.x) + this.fold(b.x)) / 2, type, a, b),
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
      // Il repart doucement ; après une course, il garde son allure de croisière.
      w.vel = ia.type === 'race' ? w.speed : 0
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
      if (dh > 0) w.falling = true
    }
  }

  /** Avance la simulation (prototype : updateGarden). */
  step(dtSeconds: number, frame: GardenFrame): void {
    const dt = Math.min(Math.max(0, dtSeconds), GARDEN.maxDt)
    const width = frame.width
    this.width = width
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
          w.x = this.randomX(GARDEN.sub.blinkMargin)
          w.sc = GARDEN.appearScale
          w.mode = 'walk'
        }
      }
      if (w.mode !== 'blink') w.op = Math.min(1, w.op + dt * GARDEN.fadeInRate)
      w.sc += (1 - w.sc) * Math.min(1, dt * GARDEN.growRate)
      if (w.sub) this.subStep(w, dt, width)
      else if (st === 'working' || w.conflictWith) this.mainStep(w, dt, width)
      else if (w.mode !== 'interact') {
        w.mode = 'stand'
        w.vel = 0
        w.stopping = false
      }
      // Sieste : il se pose sur le ventre, pattes repliées, et des « z » s'envolent ; sinon il se relève
      if (!w.sub) {
        if (st === 'sleep' && w.mode !== 'interact') {
          w.rest += (1 - w.rest) * Math.min(1, dt * GARDEN.sleep.rate)
          if (this.coin(dt * GARDEN.sleep.zRate)) this.addFx('z', 'z', w.x - 8, this.headY(w) + 2, GARDEN.fxLife.z)
        } else if (w.rest > 0) {
          w.rest += -w.rest * Math.min(1, dt * GARDEN.sleep.standRate)
          if (w.rest < 0.02) w.rest = 0
        }
        // Question en attente (demande ou question à choix) : des « ? » sortent de sa tête
        if (st === 'waiting' && this.coin(dt * GARDEN.question.rate)) {
          const dx = this.rnd(GARDEN.question.spread)
          this.addFx('ask', '?', w.x - 3 + dx, this.headY(w) - 6, GARDEN.fxLife.ask)
        }
        if (w.mode !== 'interact' && w.rot) {
          w.rot += -w.rot * Math.min(1, dt * GARDEN.sleep.standRate)
          if (Math.abs(w.rot) < 0.5) w.rot = 0
        }
      }
      if (w.mode !== 'ride' && (w.y > 0 || w.vy > 0)) {
        const gravity = w.falling ? GARDEN.fall.gravity : w.sub ? GARDEN.gravity.sub : GARDEN.gravity.main
        w.vy -= gravity * dt
        w.y += w.vy * dt
        if (w.y <= 0) {
          // Fin de chute : petit rebond seulement après une vraie chute (pas pendant que le sol finit de
          // descendre), puis gravité normale.
          const impact = -w.vy
          w.y = 0
          w.vy = w.falling && impact > GARDEN.fall.bounceAbove ? GARDEN.fall.bounce : 0
          w.falling = false
        }
      }
    }
    this.updateInteractions(dt, width)
    this.throughNotch(dt)
    this.prune()
    this.updateDepths(dt)
    for (const w of this.list) this.updateGait(w, dt)

    // Événements spontanés : relais ou file d'attente (le prototype les déclenche par des boutons)
    if (!this.mood.call) {
      this.ambient -= dt
      if (this.ambient <= 0) {
        this.ambient = this.rnd(GARDEN.ambientEvery)
        this.trigger(this.coin(0.5) ? 'handoff' : 'queue')
      }
    }
    // Notes de musique : seulement de ceux qui hochent la tête (session qui travaille, au sol, visible).
    // Celui qui dort fait des « z » (plus haut), ceux qui ont fini ou sont en pause ne font rien.
    if (this.mood.music && !frame.musicSilent && this.coin(dt * GARDEN.noteRate)) {
      const nodding = this.mains().filter((w) => this.nodsToMusic(w))
      const nw = nodding[Math.floor(this.rng() * nodding.length)]
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
      w.vel = 0
      w.stopping = false
      return
    }
    // Fête ou accueil : il se tourne vers l'autre et saute
    if (w.cheer > 0) {
      w.cheer -= dt
      w.mode = 'walk'
      w.vel = 0
      w.stopping = false
      if (w.cheerAt) w.dir = sign(this.gapTo(w, w.cheerAt)) || w.dir
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
        const d = this.gapTo(w, o)
        w.dir = sign(d) || 1
        w.stopping = false
        this.accelerate(w, GARDEN.meetSpeed, dt)
        w.x += w.dir * w.vel * dt
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
        const d = this.gapTo(w, o)
        w.dir = sign(d) || 1
        w.stopping = false
        this.accelerate(w, GARDEN.conflictSpeed, dt)
        w.x += w.dir * w.vel * dt
        w.mode = 'walk'
        if (Math.abs(d) < GARDEN.conflictDistance && w.y === 0 && o.y === 0) this.startInteraction(w, o, 'conflict')
      }
      return
    }
    if (w.mode === 'check' || w.mode === 'pause') {
      w.t -= dt
      if (w.t <= 0) {
        if (w.mode === 'check' || this.coin(w.busy ? GARDEN.work.turnChance : GARDEN.pauseTurnChance)) w.dir *= -1
        // Fin d'une pause de travail : il marche un moment pour aller se poser ailleurs.
        if (w.busy) w.roam = this.rnd(GARDEN.work.roam)
        w.busy = false
        w.mode = 'walk'
      }
      return
    }
    // Marche vivante : il accélère en repartant, change un peu d'allure, freine avant de s'arrêter, et pousse
    // un peu plus à chaque pas.
    w.mode = 'walk'
    w.cruiseT -= dt
    if (w.cruiseT <= 0) {
      w.speed = this.rnd(GARDEN.walkSpeed.main)
      w.cruiseT = this.rnd(GARDEN.walk.cruiseEvery)
    }
    this.accelerate(w, w.stopping ? 0 : w.speed * spd, dt)
    const surge = 1 + GARDEN.walk.stepSurge * w.stepAmp * Math.cos(2 * w.gait)
    w.x += w.dir * w.vel * surge * dt
    w.cool -= dt
    w.roam -= dt
    if (w.stopping) {
      // Pas d'arrêt contre l'encoche : il repart et s'arrêtera plus loin, de l'autre côté.
      if (w.vel <= GARDEN.walk.stopBelow && this.nearNotch(w)) {
        w.stopping = false
      } else if (w.vel <= GARDEN.walk.stopBelow) {
        // Posé : il fait ce que fait sa session (réfléchit, lit, écrit…) avant d'aller ailleurs.
        w.vel = 0
        w.stopping = false
        w.mode = 'pause'
        w.busy = true
        w.t = this.rnd(GARDEN.work.duration)
      }
    } else if (w.roam <= 0 && this.coin(dt * GARDEN.work.rate)) {
      w.stopping = true
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
      const dx = this.gapTo(w, o)
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
      const ahead = this.gapTo(w, o) * w.dir
      if (ahead > min && ahead < max && this.coin(dt * GARDEN.followRate)) {
        // Saute-mouton seulement sur le même plan (sinon il sauterait par-dessus quelqu'un devant ou derrière lui).
        if (this.coin(GARDEN.leapChance) && o.plane === w.plane) {
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

  /** Hoche la tête en musique, donc peut faire des notes : même règle que walkerVisual (sans la réduction). */
  private nodsToMusic(w: Walker): boolean {
    return (
      this.statusOf(w) === 'working' &&
      w.mode !== 'interact' &&
      w.delay <= 0 &&
      !w.hidden &&
      w.op > 0 &&
      (w.y === 0 || w.mode === 'ride')
    )
  }

  /** Vitesse courante vers `target` : accélération au départ, freinage plus franc. */
  private accelerate(w: Walker, target: number, dt: number): void {
    if (target > w.vel) w.vel = Math.min(target, w.vel + GARDEN.walk.accel * dt)
    else w.vel = Math.max(target, w.vel - GARDEN.walk.decel * dt)
  }

  /**
   * Profondeur : chaque personnage principal glisse vers son plan, ou vers le plan le plus en avant des deux
   * quand il interagit (rencontre, rendez-vous, conflit) ; les sous-agents suivent leur parent.
   */
  private updateDepths(dt: number): void {
    const target = new Map<Walker, number>()
    const mains = this.list.filter((w) => !w.sub && !w.dead)
    for (const w of mains) target.set(w, w.plane)
    const share = (a: Walker, b: Walker) => {
      const p = Math.min(a.plane, b.plane)
      target.set(a, Math.min(target.get(a) ?? a.plane, p))
      target.set(b, Math.min(target.get(b) ?? b.plane, p))
    }
    for (const ia of this.ias) share(ia.a, ia.b)
    for (const w of mains) {
      if (w.meet) share(w, w.meet.to)
      if (w.conflictWith) share(w, w.conflictWith)
    }
    const k = GARDEN.depth.rate * dt
    for (const w of mains) {
      const t = target.get(w) ?? w.plane
      w.depth = w.depth < t ? Math.min(t, w.depth + k) : Math.max(t, w.depth - k)
    }
    for (const w of this.list) if (w.sub && w.parent) w.depth = w.parent.depth
  }

  /**
   * Pattes : la phase avance avec le chemin parcouru (cadence proportionnelle à la vitesse, plafonnée) ; à
   * l'arrêt ou en l'air, l'amplitude retombe et les pattes se posent. Chemin mesuré en coordonnée repliée :
   * traverser l'encoche ou un bord de l'île n'est pas une téléportation.
   */
  private updateGait(w: Walker, dt: number): void {
    const span = this.foldedWidth()
    let dx = Number.isNaN(w.px) ? 0 : this.fold(w.x) - this.fold(w.px)
    if (span > 0 && Math.abs(dx) > span / 2) dx -= Math.sign(dx) * span
    if (Math.abs(dx) > w.size) dx = 0 // téléportation (réapparition ailleurs)
    w.px = w.x
    if (dt <= 0) return
    const L = w.sub ? GARDEN.legs.sub : GARDEN.legs.main
    const speed = Math.abs(dx) / dt
    const moving = w.y === 0 && w.mode !== 'ride' && !w.dead && speed > L.minSpeed
    if (moving) {
      w.gait = (w.gait + Math.min(speed / L.stepLength, L.maxSteps) * Math.PI * dt) % (2 * Math.PI)
    }
    w.stepAmp += ((moving ? 1 : 0) - w.stepAmp) * Math.min(1, dt * GARDEN.legs.settleRate)
    if (!moving && w.stepAmp < 0.01) w.stepAmp = 0
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
      const dh = this.gapTo(w, p)
      w.dir = sign(dh) || 1
      w.x += w.dir * S.homeSpeed * dt
      if (Math.abs(dh) < S.homeDistance && w.y === 0) {
        w.vy = S.homeJump
        w.mode = 'homeJump'
      }
      return
    }
    if (w.mode === 'homeJump') {
      const u = this.fold(w.x)
      this.place(w, u + (this.fold(p.x) - u) * Math.min(1, dt * S.homeFollow))
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
        w.x = this.randomX(S.blinkMargin)
        w.mode = 'walk'
      }
      return
    }
    if (w.mode === 'ride') {
      this.place(w, this.fold(tg.x) + 1)
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
      const dx = this.gapTo(w, tg)
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
      const u = this.fold(w.x)
      this.place(w, u + (this.fold(tg.x) - u) * Math.min(1, dt * S.jumpOnFollow))
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
      // Point de rencontre : replié pour les placer (à travers le portail de l'encoche), à l'écran pour les effets.
      const mid = ia.mid
      const mx = this.unfold(mid)
      ia.t += dt
      // Se placer face à face
      if (!ia.noPlace) {
        const ua = this.fold(a.x)
        const ub = this.fold(b.x)
        this.place(a, ua + (mid + (ia.sa * gap) / 2 - ua) * k6)
        this.place(b, ub + (mid + (ia.sb * gap) / 2 - ub) * k6)
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
            const ua = this.fold(a.x)
            ia.paper.x = this.unfold(ua + (this.fold(b.x) - ua) * u) - 3
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
            ia.gap = GARDEN.gapLater.fight
            this.place(a, mid + ia.sa * 6)
            this.place(b, mid + ia.sb * 6)
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
            ia.gap = GARDEN.gapLater.annoyed
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
  /** Temps (s) : hochement de tête sur le tempo fixe de la musique (sans vrai temps). */
  now: number
  /**
   * Phase 0..1 du vrai temps de la musique (Windows, analyse du son ; 0 = sur le temps). Absente : tempo fixe
   * GARDEN.musicTempoBpm à partir de `now`.
   */
  beatPhase?: number
  /** Vrai son analysé et silencieux : pas de hochement, même si le lecteur dit « en lecture ». */
  musicSilent?: boolean
}

/**
 * Hochement à la phase `phase` d'un temps (0 à 1) : coup sec au début du temps (montée pendant
 * GARDEN.nod.attack), puis retour doux jusqu'au temps suivant.
 */
export function nodPulseAt(phase: number): number {
  const p = ((phase % 1) + 1) % 1
  const a = GARDEN.nod.attack
  if (p < a) return Math.sin(((p / a) * Math.PI) / 2)
  return 0.5 * (1 + Math.cos((Math.PI * (p - a)) / (1 - a)))
}

/** Hochement au temps `now` (s) sur le tempo fixe GARDEN.musicTempoBpm. */
export function nodPulse(now: number): number {
  return nodPulseAt(now / (60 / GARDEN.musicTempoBpm))
}

/** Pattes posées. */
const LEGS_DOWN: WalkerVisual['legs'] = [
  { lift: 0, shift: 0 },
  { lift: 0, shift: 0 },
  { lift: 0, shift: 0 },
  { lift: 0, shift: 0 },
]

/** Comment dessiner un personnage (prototype : renderGarden). */
export function walkerVisual(
  w: Walker,
  status: ClaudeSessionStatus,
  ctx: VisualContext,
  activity: ClaudeActivity | null = null,
): WalkerVisual {
  const ground = ctx.height - groundOffset(ctx.platform)
  const D = GARDEN.depth
  // Profondeur : au fond, un peu plus petit, pieds un peu plus haut (et assombri par le CSS).
  const depth = Math.max(0, Math.min(D.planes - 1, w.depth))
  const depthScale = 1 - depth * D.shrink
  const groundTop = ground - depth * D.rise - w.size * GARDEN.footRatio
  const cell = w.size / 16
  // Sieste : posé sur le ventre, le corps descend jusqu'au sol (pattes repliées dessous, voir plus bas).
  const rest = w.sub ? 0 : ctx.reduced ? (status === 'sleep' ? 1 : 0) : w.rest
  const sink = rest * GARDEN.sleep.sink * cell
  // La hauteur en l'air suit l'échelle : un sous-agent perché reste posé sur la tête de son parent au fond.
  const top = groundTop - w.y * depthScale + sink * depthScale

  // Pattes par paires (3 + 10 puis 5 + 12) : la paire levée avance, l'autre recule sous le corps.
  const moving = !ctx.reduced && w.stepAmp > 0
  const s = Math.sin(w.gait)
  const c = Math.cos(w.gait)
  const L = w.sub ? GARDEN.legs.sub : GARDEN.legs.main
  let legs = LEGS_DOWN
  let bodyLift = 0
  if (moving) {
    const amp = w.stepAmp
    const liftA = amp * Math.max(0, s) * GARDEN.legs.lift * cell
    const liftB = amp * Math.max(0, -s) * GARDEN.legs.lift * cell
    const shiftA = -amp * c * GARDEN.legs.reach * cell * w.dir
    const a: LegPose = { lift: liftA, shift: shiftA }
    const b: LegPose = { lift: liftB, shift: -shiftA }
    legs = [a, b, a, b]
    // Balancement du corps avec les pas (le corps monte un peu quand une patte passe), pieds au sol.
    bodyLift = amp * Math.abs(s) * (ctx.mood.call ? L.callSway : L.sway)
  }

  // Musique : ceux qui travaillent hochent la tête sur le tempo (à l'arrêt comme en marchant) ; les autres
  // restent immobiles. Le haut du corps s'incline vers l'avant et descend un peu. Vrais temps quand l'analyse
  // du son les donne, sinon tempo fixe ; silence analysé : pas de hochement.
  let nod = 0
  const nodding =
    ctx.mood.music &&
    !ctx.musicSilent &&
    status === 'working' &&
    !ctx.reduced &&
    w.mode !== 'interact' &&
    w.delay <= 0 &&
    (w.y === 0 || w.mode === 'ride')
  if (nodding) {
    const k = ctx.beatPhase === undefined ? nodPulse(ctx.now) : nodPulseAt(ctx.beatPhase)
    // De bas en haut, sans inclinaison : en arrière entre les temps, devant sur le temps.
    nod = 0
    bodyLift = GARDEN.nod.back * (1 - k) - GARDEN.nod.dip * k
  }

  // Pattes repliées sous le corps pendant la sieste (même couleur que lui : elles disparaissent).
  if (rest > 0) {
    const fold = (pose: LegPose): LegPose => ({ lift: pose.lift + sink, shift: pose.shift * (1 - rest) })
    legs = [fold(legs[0]), fold(legs[1]), fold(legs[2]), fold(legs[3])]
  }

  const low = w.sad || w.sit
  const colorToken = w.angry
    ? GARDEN_ANGRY_TOKEN
    : w.blush
      ? GARDEN_BLUSH_TOKEN
      : (GARDEN_COLOR_TOKENS[w.colorSlot] ?? GARDEN_COLOR_TOKENS[0])
  let opacity = w.op
  if (w.delay > 0 || w.hidden) opacity = 0
  else if (!w.sub && status === 'idle') opacity = Math.min(w.op, GARDEN.idleOpacity)
  if (ctx.reduced && w.sub && !subsVisible(status)) opacity = 0
  opacity = Math.max(0, Math.min(1, opacity))
  const closed = w.blink > 0 || (!w.sub && status === 'sleep')
  const lid =
    !closed && !w.sub && (status === 'done' || status === 'idle' || status === 'background' || w.sad || w.sulk > 0)
      ? GARDEN.lidHalf
      : 0
  // En attente : des « ? » s'envolent de sa tête (effets de la simulation) ; animations réduites, sans
  // effets : la bulle fixe les remplace.
  const bubble: BubbleKind | null = w.sub
    ? null
    : status === 'waiting'
      ? ctx.reduced
        ? 'wait'
        : null
      : status === 'done'
        ? 'done'
        : w.sad
          ? 'err'
          : null
  const left = w.x - w.size / 2 + w.shake
  // Posé pour travailler : l'accessoire de ce que fait sa session (animations réduites, immobile : toujours).
  const working = !w.sub && status === 'working' && w.mode !== 'interact' && !w.sad
  const prop = working && (ctx.reduced || (w.busy && w.mode === 'pause')) ? activityProp(activity) : null

  // Ombre de contact : rétrécit et s'éclaircit quand il quitte le sol ; aucune quand il est perché.
  const air = Math.min(1, w.y / GARDEN.shadow.fadeHeight)
  const shadowScale = depthScale * (1 - air * (1 - GARDEN.shadow.minScale))
  const shadowOpacity = w.mode === 'ride' ? 0 : opacity * (1 - air * (1 - GARDEN.shadow.minOpacity))

  // Devant par-dessus ; à profondeur égale, les sous-agents par-dessus, ceux qui sont perchés encore au-dessus.
  const zIndex = 1 + Math.round((D.planes - 1 - depth) * D.zSteps) * 4 + (w.sub ? 2 : 0) + (w.mode === 'ride' ? 1 : 0)

  const portal = portalOf(w.x, left, w.size, ctx)

  return {
    left,
    ...portal,
    top,
    rot: w.rot,
    scaleX: w.sc * depthScale * (low ? GARDEN.squash.x : 1),
    scaleY: w.sc * depthScale * (low ? GARDEN.squash.y : 1),
    colorToken,
    opacity,
    lid,
    closed,
    bubble,
    prop,
    depth,
    zIndex,
    legs,
    bodyLift,
    nod,
    shadowTop: groundTop,
    shadowScale: w.sc * shadowScale,
    shadowOpacity: Math.max(0, Math.min(1, shadowOpacity)),
  }
}

/**
 * Portails d'un sprite (centre `x`, bord gauche `left`) : jumeau de l'autre bord de l'île (twinLeftOf), ou, sur
 * le Mac au repos, jumeau de l'autre bord de l'encoche quand il la chevauche, chaque morceau coupé au bord de
 * l'encoche (la partie qui entre d'un côté est celle qui sort de l'autre). La marge d'une taille couvre
 * l'écrasement et la rotation : couper un sprite qui ne touche pas le bord ne change rien.
 */
export function portalOf(
  x: number,
  left: number,
  size: number,
  ctx: Pick<VisualContext, 'platform' | 'width' | 'height'>,
): Pick<WalkerVisual, 'twinLeft' | 'clip' | 'twinClip'> {
  const notch = notchSpan(ctx.platform, ctx.width, ctx.height)
  if (notch) {
    const cut = notch.right - notch.left
    const before: ClipRange = { min: -Infinity, max: notch.left }
    const after: ClipRange = { min: notch.right, max: Infinity }
    if (x <= notch.left && x > notch.left - size) return { twinLeft: left + cut, clip: before, twinClip: after }
    if (x >= notch.right && x < notch.right + size) return { twinLeft: left - cut, clip: after, twinClip: before }
    // Centre sous l'encoche (ne devrait pas arriver) : coupé, jamais dessiné dessous.
    if (x > notch.left && x < notch.right) {
      return { twinLeft: null, clip: x - notch.left < notch.right - x ? before : after, twinClip: null }
    }
  }
  return { twinLeft: twinLeftOf(left, size, ctx.width), clip: null, twinClip: null }
}

/** Jumeau du portail : le sprite [left, left + size] chevauche un bord → la même image de l'autre côté. */
export function twinLeftOf(left: number, size: number, width: number): number | null {
  if (width <= 0) return null
  if (left < 0) return left + width
  if (left + size > width) return left - width
  return null
}
