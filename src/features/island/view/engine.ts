/**
 * Moteur d'animation de l'île (prototype : sp, bsp, shared, retarget, retargetShared, render, renderShared,
 * renderBubble, flyGhost). Il écrit les styles directement sur les éléments : aucun rendu React par image.
 *
 * Bords (île déplaçable) : les ressorts de la forme travaillent dans le repère du bord (w le long du bord,
 * h en profondeur, voir edgeFrameSize) ; la forme est reportée dans le repère de l'écran (edgeShapeGeometry).
 * La boîte est placée au milieu du bord par la CSS (data-edge) : elle suit la taille écrite à chaque image.
 *
 * Glisser : la goutte se décale de ISLAND_DRAG_INSET vers l'intérieur de la fenêtre (--drag-x / --drag-y de la
 * boîte), s'étire avec la vitesse reçue de Rust et tremble (jelly.ts), en proportion du détachement du bord.
 */
import {
  ISLAND_DRAG_BLOB,
  ISLAND_DRAG_INSET,
  type IslandDragStart,
  type IslandMotion,
  type IslandRect,
} from '../../../shared/desktop-contract'
import {
  BUBBLE_GAP,
  BUBBLE_HIDDEN,
  BUBBLE_MIN_OPACITY,
  BUBBLE_SIZES,
  GHOST,
  dragStartSize,
  edgeFrameSize,
  edgePlatform,
  edgeShapeGeometry,
  islandSize,
  isSideEdge,
  isVerticalLayout,
  SHARED_ELEMENTS,
  SHARED_ELEMENT_IDS,
  SHARED_ICON_DEFAULT_SIZE,
  SIZED_SHARED_ELEMENTS,
  SPRING,
  hitRectsFor,
  shapeSpringFor,
  opacitySpring,
  shapeGeometry,
  sharedPlacement,
  type IslandShapeSize,
  type SharedElementId,
  type SpringSettings,
} from '../geometry'
import type { IslandEdge, IslandPlatform, IslandSizeKey } from '../types'
import { createJelly, jellySprings, jellyTransform, resetJelly, setJellyVelocity, stepJelly } from './jelly'
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
  /** Bord de l'écran où l'île est collée ('mac' n'est dessiné qu'en haut). */
  edge: IslandEdge
  reduced: boolean
  hasGarden: boolean
  sessionCount: number
  /** Lignes « aussi en cours » sous l'appel (hauteur de meetOpen). */
  meetRows: number
  /** Progression de la musique connue (hauteur de musicOpen). */
  musicProgress: boolean
  /** Boutons de la musique affichés (faux : Spotify sur un autre appareil sans Premium). */
  musicControls: boolean
  /** Glisser en cours : l'île devient une goutte ronde détachée du bord (ISLAND_DRAG_BLOB). */
  dragging?: boolean
}

interface SharedItem {
  id: SharedElementId
  present: boolean
  /** Côtés de la zone de contenu depuis lesquels x et y sont mesurés (ils changent avec le bord et l'état). */
  h: 'left' | 'right'
  v: 'top' | 'bottom'
  x: Spring
  y: Spring
  s: Spring
  o: Spring
  /** Opacité cible du placement (o, 1 par défaut), avant le masquage par minAlong. */
  opacity: number
  /** Largeur de forme sous laquelle l'élément reste masqué (SharedPosition.minAlong) ; null : jamais. */
  minAlong: number | null
}

const px = (v: number) => `${v.toFixed(2)}px`

const OPPOSITE = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const

/** Direction de l'intérieur de la fenêtre depuis le bord (décalage de la goutte). */
const INWARD: Record<IslandEdge, { x: number; y: number }> = {
  top: { x: 0, y: 1 },
  bottom: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
}

/** Coins arrondis de la zone de contenu : ceux du côté opposé au bord (ordre CSS : haut gauche, haut droit, bas droit, bas gauche). */
function contentRadius(edge: IslandEdge, r: number): string {
  const v = px(r)
  if (edge === 'bottom') return `${v} ${v} 0 0`
  if (edge === 'left') return `0 ${v} ${v} 0`
  if (edge === 'right') return `${v} 0 0 ${v}`
  return `0 0 ${v} ${v}`
}

/** Taille d'un état (repère du bord) pour une cible ; pendant un glisser, la goutte. */
function frameSize(t: EngineTarget): IslandShapeSize {
  if (t.dragging) return { w: ISLAND_DRAG_BLOB, h: ISLAND_DRAG_BLOB, r: ISLAND_DRAG_BLOB / 2 }
  const platform = edgePlatform(t.platform, t.edge)
  return edgeFrameSize(islandSize(platform, t.key, t.meetRows, t.musicProgress, t.musicControls), t.edge, t.key)
}

export class IslandEngine {
  private target: EngineTarget
  /** Repère du bord : w le long du bord (zone de contenu), h en profondeur, r coins opposés au bord. */
  private readonly w: Spring
  private readonly h: Spring
  private readonly r: Spring
  /** Détachement du bord : 0 collée, 1 goutte du glisser (forme liquide, voir shapeGeometry). */
  private readonly detach: Spring
  /** Goutte liquide du glisser : étirement et retard d'après la vitesse de la fenêtre. */
  private readonly jelly = createJelly()
  private readonly bw: Spring
  private readonly bh: Spring
  private readonly bo: Spring
  private readonly items: SharedItem[]
  /**
   * Ressort de la forme (w, h, r), choisi à chaque changement de clé par shapeSpringFor : élastique à l'entrée
   * de l'île Mac élargie du déploiement, SPRING sinon. Gardé tant que la clé ne change pas (le rebond continue).
   */
  private shapeSpring: SpringSettings = SPRING
  private dirty = true
  private bubbleVisible = false
  private bubbleShown = false
  /** Taille de la racine (px CSS), pour les zones cliquables et le fantôme. */
  rootWidth = 0
  rootHeight = 0

  constructor(
    private readonly els: EngineElements,
    target: EngineTarget,
  ) {
    this.target = target
    const size = frameSize(target)
    this.w = createSpring(size.w)
    this.h = createSpring(size.h)
    this.r = createSpring(size.r)
    this.detach = createSpring(target.dragging ? 1 : 0)
    this.bw = createSpring(BUBBLE_HIDDEN.w)
    this.bh = createSpring(BUBBLE_HIDDEN.h)
    this.bo = createSpring(0)
    this.items = SHARED_ELEMENT_IDS.map((id) => ({
      id,
      present: false,
      h: SHARED_ELEMENTS[id].anchor,
      v: 'top',
      x: createSpring(0),
      y: createSpring(0),
      s: createSpring(SHARED_ICON_DEFAULT_SIZE),
      o: createSpring(0),
      opacity: 1,
      minAlong: null,
    }))
    this.retargetShared(true)
  }

  private platform(): IslandPlatform {
    return edgePlatform(this.target.platform, this.target.edge)
  }

  /** Nouvelle cible (prototype : retarget). Sous prefers-reduced-motion, tout se cale sans animation. */
  retarget(target: EngineTarget): void {
    const platformChanged = edgePlatform(target.platform, target.edge) !== this.platform()
    const edgeChanged = target.edge !== this.target.edge
    const prev = this.target
    if (target.key !== prev.key || Boolean(target.dragging) !== Boolean(prev.dragging) || platformChanged || edgeChanged) {
      this.shapeSpring = shapeSpringFor(
        prev.key,
        target.key,
        edgePlatform(target.platform, target.edge),
        target.reduced || Boolean(target.dragging) || Boolean(prev.dragging),
      )
    }
    this.target = target
    const t = frameSize(target)
    this.w.t = t.w
    this.h.t = t.h
    this.r.t = t.r
    this.detach.t = target.dragging ? 1 : 0
    if (target.reduced) {
      ;[this.w, this.h, this.r, this.detach].forEach(snapSpring)
      resetJelly(this.jelly)
    }
    if (platformChanged || edgeChanged) this.applyBubbleTarget()
    // Changement de bord : les éléments partagés se posent directement à leur place (la fenêtre a changé).
    this.retargetShared(edgeChanged)
    this.dirty = true
  }

  /** Bulle secondaire visible ou cachée (prototype : updateBubble). Seulement en haut. */
  setBubble(visible: boolean): void {
    this.bubbleVisible = visible
    this.applyBubbleTarget()
    this.dirty = true
  }

  private applyBubbleTarget(): void {
    const dims = BUBBLE_SIZES[this.platform()]
    const visible = this.bubbleVisible && this.target.edge === 'top'
    this.bw.t = visible ? dims.w : BUBBLE_HIDDEN.w
    this.bh.t = visible ? dims.h : BUBBLE_HIDDEN.h
    this.bo.t = visible ? 1 : 0
    if (this.target.reduced) [this.bw, this.bh, this.bo].forEach(snapSpring)
  }

  /** Vitesse de la fenêtre (px CSS / s) pendant un glisser et son lancer ; null : immobile. */
  setMotion(motion: IslandMotion | null): void {
    if (this.target.reduced) resetJelly(this.jelly)
    else setJellyVelocity(this.jelly, motion)
  }

  /** Un élément partagé vient d'être monté ou démonté : à réécrire à la prochaine image. */
  markDirty(): void {
    this.dirty = true
  }

  /** Taille courante de la zone de contenu à l'écran. */
  private contentSize(): { width: number; height: number } {
    const along = this.w.x
    const depth = Math.max(1, this.h.x)
    return isSideEdge(this.target.edge) ? { width: depth, height: along } : { width: along, height: depth }
  }

  /** Taille de l'élément partagé à l'écran : `s` pour l'icône et la pochette, sinon mesurée (hors de l'image). */
  private measure(it: SharedItem): { width: number; height: number } {
    if (SIZED_SHARED_ELEMENTS.has(it.id)) return { width: it.s.x, height: it.s.x }
    const el = this.els.shared.get(it.id)
    return el ? { width: el.offsetWidth, height: el.offsetHeight } : { width: 0, height: 0 }
  }

  private retargetShared(forceSnap = false): void {
    const { key, edge, reduced, hasGarden, sessionCount } = this.target
    const platform = this.platform()
    const content = this.contentSize()
    // Tailles utiles seulement sur les côtés (centrage dans la pilule, changement de côté de mesure)
    const needSize = isSideEdge(edge)
    for (const it of this.items) {
      const size = needSize ? this.measure(it) : { width: 0, height: 0 }
      const spec = sharedPlacement(it.id, platform, key, { hasGarden, sessionCount }, edge, size.width)
      if (!spec) {
        it.present = false
        it.o.t = 0
        if (reduced) snapSpring(it.o)
        continue
      }
      const snap = !it.present || reduced || forceSnap
      // Côté de mesure qui change (pilule verticale ↔ carte) : même position à l'écran, mesurée de l'autre côté.
      if (!snap && spec.h !== it.h) {
        it.x.x = content.width - it.x.x - size.width
        it.x.v = -it.x.v
      }
      if (!snap && spec.v !== it.v) {
        it.y.x = content.height - it.y.x - size.height
        it.y.v = -it.y.v
      }
      it.h = spec.h
      it.v = spec.v
      it.x.t = spec.x
      it.y.t = spec.y
      it.s.t = spec.s ?? it.s.t
      if (snap) [it.x, it.y, it.s].forEach(snapSpring)
      it.opacity = spec.o ?? 1
      it.minAlong = spec.minAlong ?? null
      it.o.t = this.gatedOpacity(it)
      if (reduced) snapSpring(it.o)
      it.present = true
    }
  }

  /** Opacité cible d'un élément partagé : masqué tant que la forme est plus étroite que son minAlong. */
  private gatedOpacity(it: SharedItem): number {
    return it.minAlong !== null && this.w.x < it.minAlong ? 0 : it.opacity
  }

  /** Avance d'une image (s). Renvoie vrai tant qu'un ressort bouge encore. */
  step(dtSeconds: number): boolean {
    const { count, h } = substeps(dtSeconds)
    const k = SPRING.stiffness
    const c = SPRING.damping
    const sk = this.shapeSpring.stiffness
    const sc = this.shapeSpring.damping
    const op = opacitySpring(k)
    const all = this.springs()
    // Éléments qui attendent que la forme soit assez large (nom de l'île Mac élargie) : fondu à partir de là.
    for (const it of this.items) {
      if (!it.present || it.minAlong === null) continue
      it.o.t = this.gatedOpacity(it)
      if (this.target.reduced) snapSpring(it.o)
    }
    for (let i = 0; i < count; i++) {
      stepSpring(this.w, h, sk, sc)
      stepSpring(this.h, h, sk, sc)
      stepSpring(this.r, h, sk, sc)
      stepSpring(this.detach, h, k, c)
      stepJelly(this.jelly, h)
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
    const list = [this.w, this.h, this.r, this.detach, ...jellySprings(this.jelly), this.bw, this.bh, this.bo]
    for (const it of this.items) list.push(it.x, it.y, it.s, it.o)
    return list
  }

  /** Écrit les styles si quelque chose a changé depuis la dernière image. */
  render(): void {
    if (!this.dirty) return
    this.dirty = false
    const { edge } = this.target
    const g = edgeShapeGeometry(this.w.x, this.h.x, this.r.x, this.platform(), edge, this.detach.x)
    const { island, svg, path, content } = this.els
    island.style.width = px(g.width)
    island.style.height = px(g.height)
    svg.setAttribute('viewBox', `0 0 ${g.width} ${g.height}`)
    svg.setAttribute('width', String(g.width))
    svg.setAttribute('height', String(g.height))
    path.setAttribute('d', g.d)
    const cs = content.style
    cs.left = px(g.content.x)
    cs.top = px(g.content.y)
    cs.width = px(g.content.width)
    cs.height = px(g.content.height)
    cs.borderRadius = contentRadius(edge, g.radius)
    // Repère du bord, pour le jardin tourné de la pilule verticale (Island.module.css)
    cs.setProperty('--edge-along', px(g.along))
    cs.setProperty('--edge-depth', px(g.depth))
    this.renderDrop()
    this.renderBubble(g.width)
    this.renderShared()
  }

  /** Goutte du glisser : décalage vers l'intérieur + retard (boîte), étirement (forme). Rien une fois collée. */
  private renderDrop(): void {
    const amount = Math.max(0, Math.min(1, this.detach.x))
    const inward = INWARD[this.target.edge]
    const j = jellyTransform(this.jelly, amount)
    const { island, svg } = this.els
    island.style.setProperty('--drag-x', px(inward.x * ISLAND_DRAG_INSET * amount + j.dx))
    island.style.setProperty('--drag-y', px(inward.y * ISLAND_DRAG_INSET * amount + j.dy))
    const flat = j.m11 === 1 && j.m12 === 0 && j.m22 === 1
    const m = [j.m11, j.m12, j.m12, j.m22].map((v) => v.toFixed(4)).join(', ')
    svg.style.transform = flat ? '' : `matrix(${m}, 0, 0)`
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
    const platform = this.platform()
    const b = shapeGeometry(this.bw.x, this.bh.x, BUBBLE_SIZES[platform].r, platform)
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
      st[it.h] = px(it.x.x)
      st[OPPOSITE[it.h]] = 'auto'
      st[it.v] = px(it.y.x)
      st[OPPOSITE[it.v]] = 'auto'
      st.opacity = Math.max(0, Math.min(1, it.o.x)).toFixed(3)
      if (SIZED_SHARED_ELEMENTS.has(it.id)) {
        st.width = px(it.s.x)
        st.height = px(it.s.x)
      }
    }
  }

  /**
   * Taille courante de la scène du jardin (px) : repère du bord en haut, en bas et dans la pilule verticale
   * (le jardin y est tourné), zone de contenu à l'écran pour la carte ouverte des côtés.
   */
  size(): { width: number; height: number } {
    const { edge, key } = this.target
    const along = this.w.x
    const depth = Math.max(1, this.h.x)
    if (!isSideEdge(edge) || isVerticalLayout(edge, key)) return { width: along, height: depth }
    return { width: depth, height: along }
  }

  /** Taille cible actuelle dans le repère du bord, envoyée au début d'un glisser. */
  dragSize(key: IslandSizeKey = this.target.key): IslandDragStart {
    return dragStartSize(frameSize({ ...this.target, key, dragging: false }))
  }

  /** Zones cliquables : union de la taille courante et de la cible, forme et bulle. */
  hitRects(): IslandRect[] {
    return hitRectsFor({
      rootWidth: this.rootWidth,
      rootHeight: this.rootHeight,
      edge: this.target.edge,
      platform: this.platform(),
      island: {
        current: { w: this.w.x, h: this.h.x, r: this.r.x },
        target: frameSize(this.target),
      },
      bubble: this.bubbleShown
        ? { current: { w: this.bw.x, h: this.bh.x }, target: { w: this.bw.t, h: this.bh.t } }
        : null,
    })
  }

  /**
   * Placement du fantôme qui glisse de la bulle vers l'île (prototype : flyGhost), px relatifs à la racine ;
   * null si la bulle n'est pas affichée (jamais hors du bord haut).
   */
  ghostPlacement(): { left: number; width: number; height: number; dx: number } | null {
    if (!this.bubbleShown || this.rootWidth <= 0 || this.target.edge !== 'top') return null
    const { key, meetRows, musicProgress, musicControls } = this.target
    const platform = this.platform()
    const cx = this.rootWidth / 2
    const island = shapeGeometry(this.w.x, this.h.x, this.r.x, platform)
    const b = shapeGeometry(this.bw.x, this.bh.x, BUBBLE_SIZES[platform].r, platform)
    const left = cx + island.width / 2 + BUBBLE_GAP + b.edge
    const arrival = cx - islandSize(platform, key, meetRows, musicProgress, musicControls).w / 2 + GHOST.inset
    const dx = arrival - (left + (b.innerWidth - GHOST.iconSize) / 2)
    return { left, width: b.innerWidth, height: b.height, dx }
  }
}
