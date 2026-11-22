/**
 * Dessin du jardin dans le DOM (prototype : sprite, fx, renderGarden). Les éléments des personnages et des
 * effets sont créés et retirés ici, hors de React, et leurs styles écrits à chaque image seulement s'ils
 * changent. La logique (positions, couleurs, bulles, pattes, hochement, profondeur, ombre) vient de
 * ./simulation.ts.
 *
 * Un personnage : ombre de contact (au sol, sous tous les personnages) + sprite = pattes séparées (colonnes
 * 3, 5, 10, 12 du masque) sous le haut du corps (corps, yeux, paupières), qui se balance et hoche la tête.
 */
import {
  BUBBLE_TEXT,
  walkerVisual,
  type BubbleKind,
  type Fx,
  type GardenSim,
  type VisualContext,
  type WalkerVisual,
} from './simulation'

/** Classes du module CSS (Garden.module.css). */
export interface GardenClassNames {
  crowd: string
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
}

/** Variable CSS de la couleur du corps (lue par Garden.module.css). */
export const BODY_COLOR_VAR = '--garden-color'
/** Variable CSS de la profondeur (0 devant) : assombrit le personnage et son ombre (Garden.module.css). */
export const DEPTH_VAR = '--garden-depth'

/** Un sprite dessiné (styles écrits seulement quand ils changent). */
interface Sprite {
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
  shadowTransform: string
  shadowOpacity: string
}

/** Un personnage : son sprite et son jumeau de l'autre bord (portail, visible seulement à cheval sur un bord). */
interface WalkerNode {
  main: Sprite
  twin: Sprite
}

const fixed = (v: number, digits = 1) => v.toFixed(digits)

export class GardenRenderer {
  private readonly walkers = new Map<number, WalkerNode>()
  private readonly effects = new Map<number, HTMLElement>()
  /** Calque des personnages et de leurs ombres : leur ordre (z-index) reste sous l'encoche et les effets. */
  private readonly crowd: HTMLDivElement
  /** Calque des sous-agents, dans `front` (devant la pochette) ; null : avec les autres dans `crowd`. */
  private readonly frontCrowd: HTMLDivElement | null

  constructor(
    private readonly layer: HTMLElement,
    private readonly cls: GardenClassNames,
    front: HTMLElement | null = null,
  ) {
    this.crowd = document.createElement('div')
    this.crowd.className = cls.crowd
    layer.appendChild(this.crowd)
    this.frontCrowd = front ? document.createElement('div') : null
    if (front && this.frontCrowd) {
      this.frontCrowd.className = cls.crowd
      front.appendChild(this.frontCrowd)
    }
  }

  private createSprite(size: number, sub: boolean): Sprite {
    const { cls } = this
    const crowd = sub && this.frontCrowd ? this.frontCrowd : this.crowd
    const shadow = document.createElement('div')
    shadow.className = cls.shadow
    shadow.style.width = `${size}px`
    shadow.style.height = `${size}px`
    crowd.appendChild(shadow)
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
    crowd.appendChild(el)
    return {
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
      shadowTransform: '',
      shadowOpacity: '',
    }
  }

  private removeSprite(sprite: Sprite): void {
    sprite.el.remove()
    sprite.shadow.remove()
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

  /** Écrit un sprite à la position `left` ; `left` null : sprite caché (jumeau hors bord). */
  private paint(sprite: Sprite, v: WalkerVisual, left: number | null): void {
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
    const z = String(v.zIndex)
    if (z !== sprite.z) {
      sprite.z = z
      st.zIndex = z
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
  }

  /** Écrit l'image courante. */
  render(sim: GardenSim, ctx: VisualContext): void {
    const seen = new Set<number>()
    for (const w of sim.walkers) {
      if (w.dead) continue
      seen.add(w.id)
      let node = this.walkers.get(w.id)
      if (!node) {
        node = { main: this.createSprite(w.size, w.sub), twin: this.createSprite(w.size, w.sub) }
        this.walkers.set(w.id, node)
      }
      const v = walkerVisual(w, sim.statusOf(w), ctx)
      this.paint(node.main, v, v.left)
      this.paint(node.twin, v, v.twinLeft)
    }
    for (const [id, node] of this.walkers) {
      if (!seen.has(id)) {
        this.removeSprite(node.main)
        this.removeSprite(node.twin)
        this.walkers.delete(id)
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
    this.crowd.remove()
    this.frontCrowd?.remove()
    this.walkers.clear()
    this.effects.clear()
  }
}
