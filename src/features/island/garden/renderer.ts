/**
 * Dessin du jardin dans le DOM (prototype : sprite, fx, renderGarden). Les éléments des personnages et des
 * effets sont créés et retirés ici, hors de React, et leurs styles écrits à chaque image seulement s'ils
 * changent. La logique (positions, couleurs, bulles, pattes, hochement, profondeur, ombre) vient de
 * ./simulation.ts.
 *
 * Un personnage : ombre de contact (au sol, sous tous les personnages) + sprite = pattes séparées (colonnes
 * 3, 5, 10, 12 du masque) sous le haut du corps (corps, yeux, paupières), qui se balance et hoche la tête.
 * Sprite et ombre sont chacun dans une boîte de découpe (`clip`, toute la surface du jardin) : sur le Mac au
 * repos, le personnage qui traverse l'encoche est coupé à son bord, sans transformation (rotation, échelle)
 * à défaire.
 *
 * Portails de l'encoche (Mac au repos) : un devant chaque bord pour le Claude qui la traverse, de sa couleur, qui
 * s'ouvrent l'un après l'autre (dessin portalArt.ts, animations Garden.module.css) ; la phase (ouverture,
 * présence, fermeture) vient de la simulation (sim.portals), le moteur de rendu ne fait que les poser sous les
 * Claude et relancer l'animation quand elle change.
 */
import { ART, createArtSvg, type ArtClassNames } from '../art/pixelArt'
import type { GardenProp } from '../art/props'
import { PORTAL_CORE, PORTAL_FLOW, PORTAL_GRID, PORTAL_RIM, PORTAL_SPARKS, type PortalCell } from './portalArt'
import {
  BUBBLE_TEXT,
  portalVisual,
  walkerVisual,
  type BubbleKind,
  type ClipRange,
  type Fx,
  type GardenSim,
  type NotchPortal,
  type VisualContext,
  type Walker,
  type WalkerVisual,
} from './simulation'

/** Classes du module CSS (Garden.module.css). */
export interface GardenClassNames {
  crowd: string
  clip: string
  mascot: string
  fig: string
  upper: string
  body: string
  leg: string
  leg1: string
  leg2: string
  leg3: string
  leg4: string
  eye: string
  lid: string
  closed: string
  left: string
  right: string
  shadow: string
  bubble: string
  wait: string
  done: string
  err: string
  fx: string
  say: string
  red: string
  grey: string
  small: string
  heart: string
  steam: string
  star: string
  cloud: string
  paper: string
  z: string
  note: string
  spark: string
  ask: string
  /** Accessoires des pauses de travail : classe commune, place et animation de chacun. */
  prop: string
  propPaper: string
  propFolderBack: string
  propFolderFront: string
  propSheet: string
  propSheet2: string
  propNotepad: string
  propPencil: string
  propKeyboard: string
  propPrompt: string
  propLens: string
  propGears: string
  /** Portails de l'encoche : boîte posée, corps animé, dessin, phases. */
  portal: string
  portalBody: string
  portalArt: string
  portalHalo: string
  portalRim: string
  portalCore: string
  portalFlow: string
  portalSpark: string
  portalOpen: string
  portalClose: string
  portalBusy: string
  /** Tons et animations en images des dessins (../art/pixelArt.module.css). */
  art: ArtClassNames
}

/** Variable CSS de la couleur du corps (lue par Garden.module.css). */
export const BODY_COLOR_VAR = '--garden-color'
/** Variable CSS de la profondeur (0 devant) : assombrit le personnage et son ombre (Garden.module.css). */
export const DEPTH_VAR = '--garden-depth'

const fixed = (v: number, digits = 1) => v.toFixed(digits)

/**
 * Coupe à l'encoche : bande visible en polygone (le côté ouvert va assez loin pour ne rien couper d'autre,
 * bulles et sauts compris).
 */
const CLIP_FAR = 10000

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Le portail repose un peu sous la ligne des pieds (en cases) : il paraît posé au sol, pas suspendu. */
const PORTAL_SINK = 0.45

/** Un portail (un côté de l'encoche, pour un Claude) et ce qui en est déjà écrit. */
interface PortalNode {
  side: HTMLDivElement
  body: HTMLDivElement
  phase: NotchPortal['phase'] | null
  busy: boolean
  color: string
  depth: string
  geometry: string
  /** z-index écrit (celui du Claude qui traverse). */
  z: string
}

function clipPath(clip: ClipRange | null): string {
  if (!clip) return 'none'
  const min = Math.max(clip.min, -CLIP_FAR)
  const max = Math.min(clip.max, CLIP_FAR)
  return `polygon(${fixed(min)}px ${-CLIP_FAR}px,${fixed(max)}px ${-CLIP_FAR}px,${fixed(max)}px ${CLIP_FAR}px,${fixed(min)}px ${CLIP_FAR}px)`
}

/** Un sprite dessiné (styles écrits seulement quand ils changent). */
interface Sprite {
  /** Boîtes de découpe du sprite et de son ombre (ordre d'affichage sur celle du sprite). */
  box: HTMLDivElement
  shadowBox: HTMLDivElement
  el: HTMLDivElement
  upper: HTMLElement
  legs: HTMLElement[]
  lids: HTMLElement[]
  bubble: HTMLElement
  shadow: HTMLElement
  transform: string
  upperTransform: string
  legTransforms: string[]
  color: string
  depth: string
  z: string
  opacity: string
  lid: number
  closed: boolean
  bubbleKind: BubbleKind | null | undefined
  /** Accessoire affiché ; les dessins sont créés au premier besoin. */
  prop: GardenProp | null
  propsBuilt: boolean
  shadowTransform: string
  shadowOpacity: string
  clip: string
}

/**
 * Un personnage : son sprite et son jumeau de l'autre bord (portail, visible seulement à cheval sur un bord de
 * l'île ou de l'encoche du Mac).
 */
interface WalkerNode {
  main: Sprite
  twin: Sprite
}

export class GardenRenderer {
  private readonly walkers = new Map<number, WalkerNode>()
  private readonly effects = new Map<number, HTMLElement>()
  private readonly portals = new Map<number, PortalNode>()
  /** Calque des personnages et de leurs ombres : leur ordre (z-index) reste sous l'encoche et les effets. */
  private readonly crowd: HTMLDivElement
  /** Calque des sous-agents, dans `front` (devant la pochette) ; null : avec les autres dans `crowd`. */
  private readonly frontCrowd: HTMLDivElement | null
  /** Calque du fond, dans `back` (derrière le titre de la musique) ; null : pas de passage derrière. */
  private readonly backCrowd: HTMLDivElement | null

  constructor(
    private readonly layer: HTMLElement,
    private readonly cls: GardenClassNames,
    front: HTMLElement | null = null,
    back: HTMLElement | null = null,
  ) {
    this.crowd = document.createElement('div')
    this.crowd.className = cls.crowd
    layer.appendChild(this.crowd)
    this.frontCrowd = this.crowdIn(front)
    this.backCrowd = this.crowdIn(back)
  }

  private crowdIn(parent: HTMLElement | null): HTMLDivElement | null {
    if (!parent) return null
    const crowd = document.createElement('div')
    crowd.className = this.cls.crowd
    parent.appendChild(crowd)
    return crowd
  }

  /**
   * Calque d'un personnage. Avec la musique (`behind`), ceux des plans du fond (et leurs sous-agents) passent
   * derrière le titre et la pochette, ceux du premier plan devant la pochette (calque de devant) ; tous passent
   * devant l'égaliseur. Sinon les sous-agents vont devant la pochette, les autres dans le jardin.
   */
  private crowdFor(w: Walker, behind: boolean): HTMLDivElement {
    const plane = w.parent ? w.parent.plane : w.plane
    if (behind && this.backCrowd && plane > 0) return this.backCrowd
    if (behind && this.frontCrowd) return this.frontCrowd
    return w.sub && this.frontCrowd ? this.frontCrowd : this.crowd
  }

  /** Déplace le sprite (et son ombre) dans `crowd` s'il n'y est pas déjà. */
  private moveTo(sprite: Sprite, crowd: HTMLDivElement): void {
    if (sprite.box.parentElement === crowd) return
    crowd.appendChild(sprite.shadowBox)
    crowd.appendChild(sprite.box)
  }

  private createBox(crowd: HTMLDivElement): HTMLDivElement {
    const box = document.createElement('div')
    box.className = this.cls.clip
    crowd.appendChild(box)
    return box
  }

  private createSprite(size: number, crowd: HTMLDivElement): Sprite {
    const { cls } = this
    const shadowBox = this.createBox(crowd)
    const shadow = document.createElement('div')
    shadow.className = cls.shadow
    shadow.style.width = `${size}px`
    shadow.style.height = `${size}px`
    shadowBox.appendChild(shadow)
    const box = this.createBox(crowd)
    const el = document.createElement('div')
    el.className = cls.mascot
    el.style.width = `${size}px`
    el.style.height = `${size}px`
    const fig = document.createElement('div')
    fig.className = cls.fig
    // Pattes (colonnes 3, 5, 10, 12 du masque) sous le haut du corps, qui les recouvre en haut.
    const legs: HTMLElement[] = []
    for (const col of [cls.leg1, cls.leg2, cls.leg3, cls.leg4]) {
      const leg = document.createElement('i')
      leg.className = `${cls.leg} ${col}`
      fig.appendChild(leg)
      legs.push(leg)
    }
    const upper = document.createElement('div')
    upper.className = cls.upper
    const body = document.createElement('div')
    body.className = cls.body
    upper.appendChild(body)
    const lids: HTMLElement[] = []
    for (const side of [cls.left, cls.right]) {
      const eye = document.createElement('i')
      eye.className = `${cls.eye} ${side}`
      upper.appendChild(eye)
    }
    for (const side of [cls.left, cls.right]) {
      const lid = document.createElement('i')
      lid.className = `${cls.lid} ${side}`
      upper.appendChild(lid)
      lids.push(lid)
    }
    fig.appendChild(upper)
    el.appendChild(fig)
    const bubble = document.createElement('span')
    bubble.className = cls.bubble
    el.appendChild(bubble)
    box.appendChild(el)
    return {
      box,
      shadowBox,
      el,
      upper,
      legs,
      lids,
      bubble,
      shadow,
      transform: '',
      upperTransform: '',
      legTransforms: legs.map(() => ''),
      color: '',
      depth: '',
      z: '',
      opacity: '',
      lid: -1,
      closed: false,
      bubbleKind: undefined,
      prop: null,
      propsBuilt: false,
      shadowTransform: '',
      shadowOpacity: '',
      clip: '',
    }
  }

  /**
   * Accessoires d'un personnage, créés une fois (cachés ; `data-prop` du sprite montre celui de son activité) :
   * fond du dossier derrière le corps, devant du dossier, feuilles qui en sortent et clavier devant ; feuille,
   * carnet, crayon, loupe, invite et engrenages avec le haut du corps (ils suivent son balancement).
   */
  private buildProps(sprite: Sprite): void {
    const { cls } = this
    const art = (name: keyof typeof ART, place: string) => createArtSvg(ART[name], cls.art, `${cls.prop} ${place}`)
    const sheet = (place: string) => {
      const el = document.createElement('i')
      el.className = `${cls.prop} ${cls.propSheet} ${place}`
      return el
    }
    const fig = sprite.upper.parentElement
    if (fig) {
      fig.insertBefore(art('folderBack', cls.propFolderBack), sprite.upper)
      fig.appendChild(sheet(''))
      fig.appendChild(sheet(cls.propSheet2))
      fig.appendChild(art('folderFront', cls.propFolderFront))
      fig.appendChild(art('keyboard', cls.propKeyboard))
    }
    for (const [name, place] of [
      ['paper', cls.propPaper],
      ['notepad', cls.propNotepad],
      ['pencil', cls.propPencil],
      ['lens', cls.propLens],
      ['prompt', cls.propPrompt],
      ['gears', cls.propGears],
    ] as const) {
      sprite.upper.appendChild(art(name, place))
    }
    sprite.propsBuilt = true
  }

  /** Un portail : boîte posée par le moteur, corps animé (dessin 8 × 14 et éclats). `out` : côté des éclats. */
  private createPortal(out: -1 | 1): PortalNode {
    const { cls } = this
    const side = document.createElement('div')
    side.className = cls.portal
    side.style.setProperty('--portal-out', String(out))
    const body = document.createElement('div')
    body.className = cls.portalBody
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('class', cls.portalArt)
    svg.setAttribute('viewBox', `0 0 ${PORTAL_GRID.w} ${PORTAL_GRID.h}`)
    svg.setAttribute('shape-rendering', 'crispEdges')
    svg.setAttribute('preserveAspectRatio', 'none')
    const halo = document.createElementNS(SVG_NS, 'g')
    halo.setAttribute('class', cls.portalHalo)
    const rects = (parent: SVGElement, cells: readonly PortalCell[], className: string) => {
      for (const [x, y, w, h] of cells) {
        const rect = document.createElementNS(SVG_NS, 'rect')
        rect.setAttribute('x', String(x))
        rect.setAttribute('y', String(y))
        rect.setAttribute('width', String(w))
        rect.setAttribute('height', String(h))
        if (className) rect.setAttribute('class', className)
        parent.appendChild(rect)
      }
    }
    rects(halo, PORTAL_CORE, cls.portalCore)
    PORTAL_FLOW.forEach((cells, k) => {
      const frame = document.createElementNS(SVG_NS, 'g')
      frame.setAttribute('class', cls.portalFlow)
      // Image k : visible au k-ième quart du cycle.
      frame.style.animationDelay = `calc(var(--island-garden-duration-portal-flow) * ${-k} / ${PORTAL_FLOW.length})`
      rects(frame, cells, '')
      halo.appendChild(frame)
    })
    rects(halo, PORTAL_RIM, cls.portalRim)
    svg.appendChild(halo)
    body.appendChild(svg)
    for (let i = 0; i < PORTAL_SPARKS; i += 1) {
      const spark = document.createElement('i')
      spark.className = cls.portalSpark
      body.appendChild(spark)
    }
    side.appendChild(body)
    this.crowd.appendChild(side)
    return { side, body, phase: null, busy: false, color: '', depth: '', geometry: '', z: '' }
  }

  /**
   * Range le portail dans le calque de son Claude, juste avant lui et au même z-index : le Claude passe toujours
   * devant son portail, quel que soit son calque (jardin, devant la pochette, ou derrière le titre de la musique
   * pour les plans du fond : avant, le portail restait dans le calque du jardin et ceux-là passaient derrière).
   */
  private stackPortal(node: PortalNode, walker: WalkerNode | undefined): void {
    const anchor = walker?.main.shadowBox
    const crowd = anchor?.parentElement ?? this.crowd
    if (anchor && node.side.nextSibling !== anchor) crowd.insertBefore(node.side, anchor)
    else if (!anchor && node.side.parentElement !== crowd) crowd.appendChild(node.side)
    const z = walker?.main.z || '0'
    if (z !== node.z) {
      node.z = z
      node.side.style.zIndex = z
    }
  }

  /** Pose un portail et relance son animation quand la phase change. */
  private paintPortal(node: PortalNode, p: NotchPortal, ctx: VisualContext): void {
    const v = portalVisual(p, ctx)
    const { cls } = this
    const cell = (p.size / 16) * (v?.scale ?? 1)
    const w = PORTAL_GRID.w * cell
    const h = PORTAL_GRID.h * cell
    const top = (v?.feetY ?? 0) + PORTAL_SINK * cell - h
    const geometry = v ? `${fixed(v.x)} ${fixed(top)} ${fixed(w, 2)} ${fixed(h, 2)}` : 'none'
    const { side, body } = node
    if (geometry !== node.geometry) {
      node.geometry = geometry
      side.style.display = v ? '' : 'none'
      if (v) {
        side.style.width = `${fixed(w, 2)}px`
        side.style.height = `${fixed(h, 2)}px`
        side.style.transform = `translate(${fixed(v.x - w / 2, 2)}px,${fixed(top, 2)}px)`
      }
    }
    const color = `var(${p.colorToken})`
    if (color !== node.color) {
      node.color = color
      side.style.setProperty(BODY_COLOR_VAR, color)
    }
    const depth = fixed(p.depth, 2)
    if (depth !== node.depth) {
      node.depth = depth
      side.style.setProperty(DEPTH_VAR, depth)
    }
    if (p.phase !== node.phase) {
      node.phase = p.phase
      side.classList.remove(cls.portalOpen, cls.portalClose)
      // Relance l'animation (la même classe peut revenir), décalée de l'âge de la phase : une ouverture reprise
      // pendant la fermeture repart d'où elle en était.
      void body.offsetWidth
      body.style.animationDelay = `${fixed(-p.age, 3)}s`
      side.classList.add(p.phase === 'open' ? cls.portalOpen : cls.portalClose)
    }
    const busy = p.phase === 'open' && p.busy
    if (busy !== node.busy) {
      node.busy = busy
      side.classList.toggle(cls.portalBusy, busy)
    }
  }

  private removePortal(node: PortalNode): void {
    node.side.remove()
  }

  private removeSprite(sprite: Sprite): void {
    sprite.box.remove()
    sprite.shadowBox.remove()
  }

  private fxClass(e: Fx): string {
    const { cls } = this
    const names = [cls.fx, cls[e.kind]]
    if (e.red) names.push(cls.red)
    if (e.grey) names.push(cls.grey)
    if (e.small) names.push(cls.small)
    return names.join(' ')
  }

  private createFx(e: Fx): HTMLElement {
    const el = document.createElement('span')
    el.className = this.fxClass(e)
    el.textContent = e.text
    el.style.left = `${fixed(e.x)}px`
    el.style.top = `${fixed(e.y)}px`
    if (e.kind === 'star') {
      el.style.setProperty('--garden-dx', `${e.dx}px`)
      el.style.setProperty('--garden-dy', `${e.dy}px`)
    }
    this.layer.appendChild(el)
    return el
  }

  /**
   * Écrit un sprite à la position `left`, coupé hors de `clip` (encoche) ; `left` null : sprite caché (jumeau
   * hors bord).
   */
  private paint(sprite: Sprite, v: WalkerVisual, left: number | null, clip: ClipRange | null): void {
    const st = sprite.el.style
    const opacity = left === null ? fixed(0, 3) : fixed(v.opacity, 3)
    if (opacity !== sprite.opacity) {
      sprite.opacity = opacity
      st.opacity = opacity
    }
    const shadowOpacity = left === null ? fixed(0, 3) : fixed(v.shadowOpacity, 3)
    if (shadowOpacity !== sprite.shadowOpacity) {
      sprite.shadowOpacity = shadowOpacity
      sprite.shadow.style.opacity = shadowOpacity
    }
    if (left === null || v.opacity <= 0) return
    const path = clipPath(clip)
    if (path !== sprite.clip) {
      sprite.clip = path
      sprite.box.style.clipPath = path
      sprite.shadowBox.style.clipPath = path
    }
    const transform = `translate(${fixed(left)}px,${fixed(v.top)}px) rotate(${fixed(v.rot)}deg) scale(${fixed(v.scaleX, 3)},${fixed(v.scaleY, 3)})`
    if (transform !== sprite.transform) {
      sprite.transform = transform
      st.transform = transform
    }
    const shadowTransform = `translate(${fixed(left)}px,${fixed(v.shadowTop)}px) scale(${fixed(v.shadowScale, 3)})`
    if (shadowTransform !== sprite.shadowTransform) {
      sprite.shadowTransform = shadowTransform
      sprite.shadow.style.transform = shadowTransform
    }
    const upperTransform = `translateY(${fixed(-v.bodyLift, 2)}px) rotate(${fixed(v.nod)}deg)`
    if (upperTransform !== sprite.upperTransform) {
      sprite.upperTransform = upperTransform
      sprite.upper.style.transform = upperTransform
    }
    v.legs.forEach((pose, i) => {
      const legTransform = `translate(${fixed(pose.shift, 2)}px,${fixed(-pose.lift, 2)}px)`
      if (legTransform !== sprite.legTransforms[i]) {
        sprite.legTransforms[i] = legTransform
        const leg = sprite.legs[i]
        if (leg) leg.style.transform = legTransform
      }
    })
    // Ordre d'affichage sur la boîte : découpée, elle forme son propre contexte d'empilement.
    const z = String(v.zIndex)
    if (z !== sprite.z) {
      sprite.z = z
      sprite.box.style.zIndex = z
    }
    const color = `var(${v.colorToken})`
    if (color !== sprite.color) {
      sprite.color = color
      st.setProperty(BODY_COLOR_VAR, color)
      sprite.shadow.style.setProperty(BODY_COLOR_VAR, color)
    }
    const depth = fixed(v.depth, 2)
    if (depth !== sprite.depth) {
      sprite.depth = depth
      st.setProperty(DEPTH_VAR, depth)
      sprite.shadow.style.setProperty(DEPTH_VAR, depth)
    }
    if (v.lid !== sprite.lid) {
      sprite.lid = v.lid
      for (const lid of sprite.lids) lid.style.height = `${v.lid}%`
    }
    if (v.closed !== sprite.closed) {
      sprite.closed = v.closed
      sprite.upper.classList.toggle(this.cls.closed, v.closed)
    }
    if (v.bubble !== sprite.bubbleKind) {
      sprite.bubbleKind = v.bubble
      sprite.bubble.className = v.bubble ? `${this.cls.bubble} ${this.cls[v.bubble]}` : this.cls.bubble
      sprite.bubble.textContent = v.bubble ? BUBBLE_TEXT[v.bubble] : ''
    }
    if (v.prop !== sprite.prop) {
      sprite.prop = v.prop
      if (v.prop && !sprite.propsBuilt) this.buildProps(sprite)
      if (sprite.propsBuilt) sprite.el.dataset.prop = v.prop ?? ''
    }
  }

  /**
   * Écrit l'image courante. `behind` (jardin dans la musique) : les personnages des plans du fond passent
   * derrière le titre (calque `back`).
   */
  render(sim: GardenSim, ctx: VisualContext, behind = false): void {
    const seen = new Set<number>()
    for (const w of sim.walkers) {
      if (w.dead) continue
      seen.add(w.id)
      const crowd = this.crowdFor(w, behind)
      let node = this.walkers.get(w.id)
      if (!node) {
        node = { main: this.createSprite(w.size, crowd), twin: this.createSprite(w.size, crowd) }
        this.walkers.set(w.id, node)
      } else {
        this.moveTo(node.main, crowd)
        this.moveTo(node.twin, crowd)
      }
      const v = walkerVisual(w, sim.statusOf(w), ctx, sim.activityOf(w))
      this.paint(node.main, v, v.left, v.clip)
      this.paint(node.twin, v, v.twinLeft, v.twinClip)
    }
    for (const [id, node] of this.walkers) {
      if (!seen.has(id)) {
        this.removeSprite(node.main)
        this.removeSprite(node.twin)
        this.walkers.delete(id)
      }
    }

    const open = new Set<number>()
    for (const p of sim.portals) {
      open.add(p.key)
      let node = this.portals.get(p.key)
      if (!node) {
        node = this.createPortal(p.side === 'left' ? -1 : 1)
        this.portals.set(p.key, node)
      }
      this.stackPortal(node, this.walkers.get(p.id))
      this.paintPortal(node, p, ctx)
    }
    for (const [id, node] of this.portals) {
      if (!open.has(id)) {
        this.removePortal(node)
        this.portals.delete(id)
      }
    }

    const live = new Set<number>()
    for (const e of sim.fx) {
      live.add(e.id)
      let el = this.effects.get(e.id)
      if (!el) {
        el = this.createFx(e)
        this.effects.set(e.id, el)
      }
      // La feuille passe d'une main à l'autre, le nuage de bagarre tremble.
      if (e.kind === 'paper') {
        el.style.left = `${fixed(e.x)}px`
        el.style.top = `${fixed(e.y)}px`
      } else if (e.kind === 'cloud') {
        el.style.transform = `translate(${fixed(e.jx)}px,${fixed(e.jy)}px)`
      }
    }
    for (const [id, el] of this.effects) {
      if (!live.has(id)) {
        el.remove()
        this.effects.delete(id)
      }
    }
  }

  /** Retire tout ce que le moteur de rendu a créé. */
  dispose(): void {
    for (const node of this.walkers.values()) {
      this.removeSprite(node.main)
      this.removeSprite(node.twin)
    }
    for (const el of this.effects.values()) el.remove()
    for (const node of this.portals.values()) this.removePortal(node)
    this.portals.clear()
    this.crowd.remove()
    this.frontCrowd?.remove()
    this.backCrowd?.remove()
    this.walkers.clear()
    this.effects.clear()
  }
}
