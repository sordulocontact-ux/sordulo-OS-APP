/**
 * Moteur d'animation de l'île (prototype : sp, bsp, shared, retarget, retargetShared, render, renderShared,
 * renderBubble, flyGhost). Il écrit les styles directement sur les éléments : aucun rendu React par image.
 */
import type { IslandRect } from '../../../shared/desktop-contract'
import {
  BUBBLE_GAP,
  BUBBLE_HIDDEN,
  BUBBLE_MIN_OPACITY,
  BUBBLE_SIZES,
  GHOST,
  islandSize,
  SHARED_ELEMENTS,
  SHARED_ELEMENT_IDS,
  SHARED_ICON_DEFAULT_SIZE,
  SIZED_SHARED_ELEMENTS,
  SPRING,
  hitRectsFor,
  opacitySpring,
  shapeGeometry,
  sharedPosition,
  type SharedElementId,
} from '../geometry'
import type { IslandPlatform, IslandSizeKey } from '../types'
import { createSpring, isSpringAtRest, snapSpring, stepSpring, substeps, type Spring } from './spring'

export interface EngineElements {
  island: HTMLElement
  svg: SVGSVGElement
  path: SVGPathElement
  content: HTMLElement
  bubble: HTMLElement
  bubbleSvg: SVGSVGElement
  bubblePath: SVGPathElement
  bubbleContent: HTMLElement
  /** Éléments partagés montés (les pastilles vont et viennent avec le nombre de sessions). */
  shared: Map<SharedElementId, HTMLElement>
}

export interface EngineTarget {
  key: IslandSizeKey
  platform: IslandPlatform
  reduced: boolean
  hasGarden: boolean
  sessionCount: number
  /** Lignes « aussi en cours » sous l'appel (hauteur de meetOpen). */
  meetRows: number
  /** Progression de la musique connue (hauteur de musicOpen). */
  musicProgress: boolean
  /** Boutons de la musique affichés (faux : Spotify sur un autre appareil sans Premium). */
  musicControls: boolean
}

interface SharedItem {
  id: SharedElementId
  anchor: 'left' | 'right'
  present: boolean
  x: Spring
  y: Spring
  s: Spring
  o: Spring
}

const px = (v: number) => `${v.toFixed(2)}px`

export class IslandEngine {
  private target: EngineTarget
  private readonly w: Spring
  private readonly h: Spring
  private readonly r: Spring
  private readonly bw: Spring
  private readonly bh: Spring
  private readonly bo: Spring
  private readonly items: SharedItem[]
  private dirty = true
  private bubbleVisible = false
  private bubbleShown = false
  /** Largeur de la racine (px CSS), pour les zones cliquables et le fantôme. */
  rootWidth = 0

  constructor(
    private readonly els: EngineElements,
    target: EngineTarget,
  ) {
    this.target = target
    const size = islandSize(target.platform, target.key, target.meetRows, target.musicProgress, target.musicControls)
    this.w = createSpring(size.w)
    this.h = createSpring(size.h)
    this.r = createSpring(size.r)
    this.bw = createSpring(BUBBLE_HIDDEN.w)
    this.bh = createSpring(BUBBLE_HIDDEN.h)
    this.bo = createSpring(0)
    this.items = SHARED_ELEMENT_IDS.map((id) => ({
      id,
      anchor: SHARED_ELEMENTS[id].anchor,
      present: false,
      x: createSpring(0),
      y: createSpring(0),
      s: createSpring(SHARED_ICON_DEFAULT_SIZE),
      o: createSpring(0),
    }))
    this.retargetShared()
  }

  /** Nouvelle cible (prototype : retarget). Sous prefers-reduced-motion, tout se cale sans animation. */
  retarget(target: EngineTarget): void {
    const platformChanged = target.platform !== this.target.platform
    this.target = target
    const t = islandSize(target.platform, target.key, target.meetRows, target.musicProgress, target.musicControls)
    this.w.t = t.w
    this.h.t = t.h
    this.r.t = t.r
    if (target.reduced) [this.w, this.h, this.r].forEach(snapSpring)
    if (platformChanged) this.applyBubbleTarget()
    this.retargetShared()
    this.dirty = true
  }

  /** Bulle secondaire visible ou cachée (prototype : updateBubble). */
  setBubble(visible: boolean): void {
    this.bubbleVisible = visible
    this.applyBubbleTarget()
    this.dirty = true
  }

  private applyBubbleTarget(): void {
    const dims = BUBBLE_SIZES[this.target.platform]
    this.bw.t = this.bubbleVisible ? dims.w : BUBBLE_HIDDEN.w
    this.bh.t = this.bubbleVisible ? dims.h : BUBBLE_HIDDEN.h
    this.bo.t = this.bubbleVisible ? 1 : 0
    if (this.target.reduced) [this.bw, this.bh, this.bo].forEach(snapSpring)
  }

  /** Un élément partagé vient d'être monté ou démonté : à réécrire à la prochaine image. */
  markDirty(): void {
    this.dirty = true
  }

  private retargetShared(): void {
    const { platform, key, reduced, hasGarden, sessionCount } = this.target
    for (const it of this.items) {
      const spec = sharedPosition(it.id, platform, key, { hasGarden, sessionCount })
      if (!spec) {
        it.present = false
        it.o.t = 0
        if (reduced) snapSpring(it.o)
        continue
      }
      const snap = !it.present || reduced
      it.x.t = spec.x
      it.y.t = spec.y
      it.s.t = spec.s ?? it.s.t
      if (snap) [it.x, it.y, it.s].forEach(snapSpring)
      it.o.t = spec.o ?? 1
      if (reduced) snapSpring(it.o)
      it.present = true
    }
  }

  /** Avance d'une image (s). Renvoie vrai tant qu'un ressort bouge encore. */
  step(dtSeconds: number): boolean {
    const { count, h } = substeps(dtSeconds)
    const k = SPRING.stiffness
    const c = SPRING.damping
    const op = opacitySpring(k)
    const all = this.springs()
    for (let i = 0; i < count; i++) {
      stepSpring(this.w, h, k, c)
      stepSpring(this.h, h, k, c)
      stepSpring(this.r, h, k, c)
      stepSpring(this.bw, h, k, c)
      stepSpring(this.bh, h, k, c)
      stepSpring(this.bo, h, op.stiffness, op.damping)
      for (const it of this.items) {
        stepSpring(it.x, h, k, c)
        stepSpring(it.y, h, k, c)
        stepSpring(it.s, h, k, c)
        stepSpring(it.o, h, op.stiffness, op.damping)
      }
    }
    if (all.every((s) => isSpringAtRest(s))) {
      if (all.some((s) => s.x !== s.t || s.v !== 0)) {
        all.forEach(snapSpring)
        this.dirty = true
      }
      return false
    }
    this.dirty = true
    return true
  }

  private springs(): Spring[] {
    const list = [this.w, this.h, this.r, this.bw, this.bh, this.bo]
    for (const it of this.items) list.push(it.x, it.y, it.s, it.o)
    return list
  }

  /** Écrit les styles si quelque chose a changé depuis la dernière image. */
  render(): void {
    if (!this.dirty) return
    this.dirty = false
    const { platform } = this.target
    const g = shapeGeometry(this.w.x, this.h.x, this.r.x, platform)
    const { island, svg, path, content } = this.els
    island.style.width = px(g.width)
    island.style.height = px(g.height)
    svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`)
    svg.setAttribute('width', String(g.width))
    svg.setAttribute('height', String(g.height))
    path.setAttribute('d', g.d)
    content.style.left = px(g.edge)
    content.style.width = px(g.innerWidth)
    content.style.height = px(g.height)
    content.style.borderRadius = `0 0 ${px(g.radius)} ${px(g.radius)}`
    this.renderBubble(g.width)
    this.renderShared()
  }

  private renderBubble(islandWidth: number): void {
    const { bubble, bubbleSvg, bubblePath, bubbleContent } = this.els
    const o = Math.max(0, Math.min(1, this.bo.x))
    if (o < BUBBLE_MIN_OPACITY && this.bo.t === 0) {
      bubble.style.display = 'none'
      this.bubbleShown = false
      return
    }
    this.bubbleShown = true
    const b = shapeGeometry(this.bw.x, this.bh.x, BUBBLE_SIZES[this.target.platform].r, this.target.platform)
    const st = bubble.style
    st.display = 'block'
    st.transform = `translateX(${px(islandWidth / 2 + BUBBLE_GAP)})`
    st.width = px(b.width)
    st.height = px(b.height)
    st.opacity = o.toFixed(3)
    bubbleSvg.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`)
    bubbleSvg.setAttribute('width', String(b.width))
    bubbleSvg.setAttribute('height', String(b.height))
    bubblePath.setAttribute('d', b.d)
    bubbleContent.style.left = px(b.edge)
    bubbleContent.style.width = px(b.innerWidth)
    bubbleContent.style.height = px(b.height)
  }

  private renderShared(): void {
    for (const it of this.items) {
      const el = this.els.shared.get(it.id)
      if (!el) continue
      const st = el.style
      st[it.anchor] = px(it.x.x)
      st.top = px(it.y.x)
      st.opacity = Math.max(0, Math.min(1, it.o.x)).toFixed(3)
      if (SIZED_SHARED_ELEMENTS.has(it.id)) {
        st.width = px(it.s.x)
        st.height = px(it.s.x)
      }
    }
  }

  /** Taille courante du ressort (prototype : sp.w.x, sp.h.x) : largeur de la zone de contenu et hauteur de la forme. */
  size(): { width: number; height: number } {
    return { width: this.w.x, height: Math.max(1, this.h.x) }
  }

  /** Zones cliquables : union de la taille courante et de la cible, forme et bulle. */
  hitRects(): IslandRect[] {
    const { platform, key, meetRows, musicProgress, musicControls } = this.target
    return hitRectsFor({
      rootWidth: this.rootWidth,
      platform,
      island: {
        current: { w: this.w.x, h: this.h.x, r: this.r.x },
        target: islandSize(platform, key, meetRows, musicProgress, musicControls),
      },
      bubble: this.bubbleShown
        ? { current: { w: this.bw.x, h: this.bh.x }, target: { w: this.bw.t, h: this.bh.t } }
        : null,
    })
  }

  /**
   * Placement du fantôme qui glisse de la bulle vers l'île (prototype : flyGhost), px relatifs à la racine ;
   * null si la bulle n'est pas affichée.
   */
  ghostPlacement(): { left: number; width: number; height: number; dx: number } | null {
    if (!this.bubbleShown || this.rootWidth <= 0) return null
    const { platform, key, meetRows, musicProgress, musicControls } = this.target
    const cx = this.rootWidth / 2
    const island = shapeGeometry(this.w.x, this.h.x, this.r.x, platform)
    const b = shapeGeometry(this.bw.x, this.bh.x, BUBBLE_SIZES[platform].r, platform)
    const left = cx + island.width / 2 + BUBBLE_GAP + b.edge
    const arrival = cx - islandSize(platform, key, meetRows, musicProgress, musicControls).w / 2 + GHOST.inset
    const dx = arrival - (left + (b.innerWidth - GHOST.iconSize) / 2)
    return { left, width: b.innerWidth, height: b.height, dx }
  }
}
