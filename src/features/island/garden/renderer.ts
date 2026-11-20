/**
 * Dessin du jardin dans le DOM (prototype : sprite, fx, renderGarden). Les éléments des personnages et des
 * effets sont créés et retirés ici, hors de React, et leurs styles écrits à chaque image seulement s'ils
 * changent. La logique (positions, couleurs, bulles) vient de ./simulation.ts.
 */
import { BUBBLE_TEXT, walkerVisual, type BubbleKind, type Fx, type GardenSim, type VisualContext } from './simulation'

/** Classes du module CSS (Garden.module.css). */
export interface GardenClassNames {
  mascot: string
  fig: string
  body: string
  eye: string
  lid: string
  left: string
  right: string
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

interface WalkerNode {
  el: HTMLDivElement
  lids: HTMLElement[]
  bubble: HTMLElement
  transform: string
  color: string
  opacity: string
  lid: number
  bubbleKind: BubbleKind | null | undefined
}

const fixed = (v: number, digits = 1) => v.toFixed(digits)

export class GardenRenderer {
  private readonly walkers = new Map<number, WalkerNode>()
  private readonly effects = new Map<number, HTMLElement>()

  constructor(
    private readonly layer: HTMLElement,
    private readonly cls: GardenClassNames,
  ) {}

  private createWalker(size: number): WalkerNode {
    const { cls } = this
    const el = document.createElement('div')
    el.className = cls.mascot
    el.style.width = `${size}px`
    el.style.height = `${size}px`
    const fig = document.createElement('div')
    fig.className = cls.fig
    const body = document.createElement('div')
    body.className = cls.body
    fig.appendChild(body)
    const lids: HTMLElement[] = []
    for (const side of [cls.left, cls.right]) {
      const eye = document.createElement('i')
      eye.className = `${cls.eye} ${side}`
      fig.appendChild(eye)
    }
    for (const side of [cls.left, cls.right]) {
      const lid = document.createElement('i')
      lid.className = `${cls.lid} ${side}`
      fig.appendChild(lid)
      lids.push(lid)
    }
    el.appendChild(fig)
    const bubble = document.createElement('span')
    bubble.className = cls.bubble
    el.appendChild(bubble)
    this.layer.appendChild(el)
    return { el, lids, bubble, transform: '', color: '', opacity: '', lid: -1, bubbleKind: undefined }
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

  /** Écrit l'image courante. */
  render(sim: GardenSim, ctx: VisualContext): void {
    const seen = new Set<number>()
    for (const w of sim.walkers) {
      if (w.dead) continue
      seen.add(w.id)
      let node = this.walkers.get(w.id)
      if (!node) {
        node = this.createWalker(w.size)
        this.walkers.set(w.id, node)
      }
      const v = walkerVisual(w, sim.statusOf(w), ctx)
      const st = node.el.style
      const opacity = fixed(v.opacity, 3)
      if (opacity !== node.opacity) {
        node.opacity = opacity
        st.opacity = opacity
      }
      if (v.opacity > 0) {
        const transform = `translate(${fixed(v.left)}px,${fixed(v.top)}px) rotate(${fixed(v.rot)}deg) scale(${fixed(v.scaleX, 3)},${fixed(v.scaleY, 3)})`
        if (transform !== node.transform) {
          node.transform = transform
          st.transform = transform
        }
      }
      const color = `var(${v.colorToken})`
      if (color !== node.color) {
        node.color = color
        st.setProperty(BODY_COLOR_VAR, color)
      }
      if (v.lid !== node.lid) {
        node.lid = v.lid
        for (const lid of node.lids) lid.style.height = `${v.lid}%`
      }
      if (v.bubble !== node.bubbleKind) {
        node.bubbleKind = v.bubble
        node.bubble.className = v.bubble ? `${this.cls.bubble} ${this.cls[v.bubble]}` : this.cls.bubble
        node.bubble.textContent = v.bubble ? BUBBLE_TEXT[v.bubble] : ''
      }
    }
    for (const [id, node] of this.walkers) {
      if (!seen.has(id)) {
        node.el.remove()
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
    for (const node of this.walkers.values()) node.el.remove()
    for (const el of this.effects.values()) el.remove()
    this.walkers.clear()
    this.effects.clear()
  }
}
