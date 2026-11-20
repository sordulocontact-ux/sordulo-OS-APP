/**
 * Géométrie de l'île : SEUL endroit des cibles d'animation (tailles par état, ressort, bord concave,
 * positions des éléments partagés, bulle secondaire, anneau, onde).
 * Source : design/prototypes/ile-sordulo-os.html (objets S et SH, fonctions render, renderBubble, frame).
 * Couleurs, police et tailles de texte : section « Île » de src/styles/tokens.css, jamais ici.
 * Ce fichier est pur (ni React ni DOM) : il est lu par le rendu (view/), le labo et le jardin.
 */
import type { IslandRect } from '../../shared/desktop-contract'
import type { IslandPlatform, IslandSizeKey, IslandState } from './types'

/** Plateforme active. 'mac' (variante autour de l'encoche) est déclarée pour le lot macOS, pas encore utilisée. */
export const ACTIVE_PLATFORM: IslandPlatform = 'win'

// ---------------------------------------------------------------------------
// Tailles par état (prototype : objet S)
// ---------------------------------------------------------------------------

/** Taille de la forme : largeur et hauteur du corps (sans les petits arrondis concaves du haut), rayon des coins bas. */
export interface IslandShapeSize {
  w: number
  h: number
  r: number
}

/**
 * Dimensions par clé de taille, en px CSS. Copie exacte de S.
 * `meetOpen` (survol de l'enregistrement, absent du prototype) reprend les dimensions de `agentOpen`.
 * Mac : largeurs calculées depuis l'encoche (186 px dans le prototype).
 */
export const ISLAND_SIZES: Record<IslandPlatform, Record<IslandSizeKey, IslandShapeSize>> = {
  win: {
    repos: { w: 120, h: 8, r: 4 },
    peek: { w: 150, h: 14, r: 7 },
    appel: { w: 384, h: 116, r: 24 },
    meet: { w: 193, h: 40, r: 14 },
    meetOpen: { w: 360, h: 96, r: 24 },
    music: { w: 193, h: 40, r: 14 },
    progress: { w: 193, h: 40, r: 14 },
    agent: { w: 193, h: 40, r: 14 },
    agentOpen: { w: 360, h: 96, r: 24 },
    agentAsk: { w: 380, h: 156, r: 26 },
    agentAskCall: { w: 380, h: 196, r: 26 },
    multi: { w: 193, h: 40, r: 14 },
    multiOpen: { w: 400, h: 220, r: 26 },
    dragWake: { w: 170, h: 44, r: 16 },
    dragOver: { w: 440, h: 150, r: 26 },
    notif: { w: 340, h: 64, r: 22 },
    notifCall: { w: 340, h: 100, r: 24 },
  },
  mac: {
    repos: { w: 186, h: 32, r: 9 },
    peek: { w: 202, h: 36, r: 11 },
    appel: { w: 400, h: 148, r: 26 },
    meet: { w: 370, h: 32, r: 10 },
    meetOpen: { w: 380, h: 124, r: 26 },
    music: { w: 274, h: 32, r: 10 },
    progress: { w: 274, h: 32, r: 10 },
    agent: { w: 274, h: 32, r: 10 },
    agentOpen: { w: 380, h: 124, r: 26 },
    agentAsk: { w: 400, h: 184, r: 26 },
    agentAskCall: { w: 400, h: 184, r: 26 },
    multi: { w: 370, h: 32, r: 10 },
    multiOpen: { w: 420, h: 250, r: 26 },
    dragWake: { w: 240, h: 64, r: 20 },
    dragOver: { w: 460, h: 178, r: 26 },
    notif: { w: 360, h: 96, r: 24 },
    notifCall: { w: 370, h: 96, r: 24 },
  },
}

/**
 * Clé de taille d'un état (prototype : currentKey et keyFor).
 * Survol : repos → peek, meet → meetOpen, agent → agentOpen, multi → multiOpen.
 * Pendant un appel : notif → notifCall, agentAsk → agentAskCall.
 */
export function sizeKeyFor(state: IslandState, hover: boolean, withCall: boolean): IslandSizeKey {
  if (hover) {
    if (state === 'repos') return 'peek'
    if (state === 'meet') return 'meetOpen'
    if (state === 'agent') return 'agentOpen'
    if (state === 'multi') return 'multiOpen'
  }
  if (state === 'notif' && withCall) return 'notifCall'
  if (state === 'agentAsk' && withCall) return 'agentAskCall'
  return state
}

/**
 * Taille d'une couche de contenu (prototype : sizeLayers) : la couche a la taille de l'état ouvert,
 * la forme animée la découpe. meet → meetOpen, agent → agentOpen, multi → multiOpen.
 */
export function layerSizeKeyFor(state: IslandState, withCall: boolean): IslandSizeKey {
  if (state === 'meet') return 'meetOpen'
  if (state === 'agent') return 'agentOpen'
  if (state === 'multi') return 'multiOpen'
  return sizeKeyFor(state, false, withCall)
}

// ---------------------------------------------------------------------------
// Ressort (prototype : K, C, frame, stepSpring)
// ---------------------------------------------------------------------------

/** Ressort de la forme, de la bulle et des éléments partagés : raideur 380, amortissement 26. */
export const SPRING = { stiffness: 380, damping: 26 } as const

/** Opacité des éléments partagés et de la bulle : raideur K × 1,4, amortissement critique 2√(K × 1,4). */
export const OPACITY_SPRING_STIFFNESS_FACTOR = 1.4

export function opacitySpring(stiffness: number = SPRING.stiffness): { stiffness: number; damping: number } {
  const k = stiffness * OPACITY_SPRING_STIFFNESS_FACTOR
  return { stiffness: k, damping: 2 * Math.sqrt(k) }
}

/** Sous-pas d'intégration (s) : 1/240 s. */
export const SPRING_SUBSTEP_S = 1 / 240

/** Pas de temps maximal d'une image (s) : au-delà (onglet en arrière-plan, gel), on plafonne. */
export const SPRING_MAX_DT_S = 0.034

/**
 * Seuil de repos (ajout : le prototype tourne sans fin). En dessous, la valeur est calée sur la cible,
 * ce qui permet de ne plus écrire le DOM et de rapporter les zones cliquables une dernière fois.
 */
export const SPRING_REST_EPSILON = 0.01

// ---------------------------------------------------------------------------
// Forme (prototype : render)
// ---------------------------------------------------------------------------

/** Rayon maximal des petits arrondis concaves du haut (bord e) : 10 px Windows, 8 px Mac. */
export const EDGE_RADIUS: Record<IslandPlatform, number> = { win: 10, mac: 8 }

/** Bord e = min(10 win / 8 mac, h / 2). */
export function edgeFor(platform: IslandPlatform, h: number): number {
  return Math.min(EDGE_RADIUS[platform], h * 0.5)
}

export interface IslandShapeGeometry {
  /** Chemin SVG de la forme (attribut d). */
  d: string
  /** Largeur totale, arrondis concaves compris : w + 2e. */
  width: number
  /** Hauteur (au moins 1 px). */
  height: number
  /** Bord e : décalage gauche de la zone de contenu. */
  edge: number
  /** Rayon bas effectivement appliqué. */
  radius: number
  /** Largeur de la zone de contenu (w). */
  innerWidth: number
}

function n(v: number): string {
  return String(+v.toFixed(3))
}

/**
 * Forme de l'île ou de la bulle (prototype : render, renderBubble) : bord haut droit sur toute la largeur,
 * arrondis concaves de rayon e en haut à gauche et à droite, côtés droits, coins bas de rayon r.
 */
export function shapeGeometry(w: number, h: number, r: number, platform: IslandPlatform): IslandShapeGeometry {
  const width0 = Math.max(0, w)
  const height = Math.max(1, h)
  const e = edgeFor(platform, height)
  const radius = Math.max(0, Math.min(r, height - e, width0 / 2))
  const W = width0 + 2 * e
  const d =
    `M0 0H${n(W)}A${n(e)} ${n(e)} 0 0 0 ${n(W - e)} ${n(e)}V${n(height - radius)}` +
    `A${n(radius)} ${n(radius)} 0 0 1 ${n(W - e - radius)} ${n(height)}H${n(e + radius)}` +
    `A${n(radius)} ${n(radius)} 0 0 1 ${n(e)} ${n(height - radius)}V${n(e)}A${n(e)} ${n(e)} 0 0 0 0 0Z`
  return { d, width: W, height, edge: e, radius, innerWidth: width0 }
}

// ---------------------------------------------------------------------------
// Éléments partagés (prototype : SH) : ils glissent d'un état à l'autre au lieu de disparaître
// ---------------------------------------------------------------------------

export type SharedElementId =
  | 'meetGroup'
  | 'timer'
  | 'agentIcon'
  | 'dots'
  | 'elapsed'
  | 'count'
  | 'seg0'
  | 'seg1'
  | 'seg2'
  | 'seg3'
  | 'seg4'
  | 'dropIcon'

/** Position depuis le bord d'ancrage de la zone de contenu (x) et le haut (y), taille (s, icône Claude), opacité (o). */
export interface SharedPosition {
  x: number
  y: number
  /** Taille de l'icône Claude (px). */
  s?: number
  /** Opacité cible, 1 par défaut. */
  o?: number
}

export interface SharedElementSpec {
  /** Bord de la zone de contenu depuis lequel x est mesuré. */
  anchor: 'left' | 'right'
  win: Partial<Record<IslandSizeKey, SharedPosition>>
  mac: Partial<Record<IslandSizeKey, SharedPosition>>
}

/** Nombre de lignes de sessions (et de pastilles) affichées dans multiOpen : 5, comme le prototype. */
export const MAX_SESSION_ROWS = 5

/** Taille de départ de l'icône Claude partagée (px). */
export const SHARED_ICON_DEFAULT_SIZE = 22

function segSpec(i: number): SharedElementSpec {
  // Les pastilles de statut descendent devant chaque ligne au survol (une ligne = 30 px).
  return { anchor: 'left', win: { multiOpen: { x: 16, y: 68 + i * 30 } }, mac: { multiOpen: { x: 16, y: 98 + i * 30 } } }
}

/**
 * Copie de SH. Ajouts pour `meetOpen` (absent du prototype, composé comme agentOpen) : le minuteur monte
 * en haut à droite à la place du temps écoulé de agentOpen, l'icône et l'onde descendent sur la ligne
 * du bouton « Arrêter » (Windows : contenu 14 px, en-tête 34 px, écart 10 px, ligne de 28 px).
 */
export const SHARED_ELEMENTS: Record<SharedElementId, SharedElementSpec> = {
  meetGroup: {
    anchor: 'left',
    win: { meet: { x: 13, y: 12 }, notifCall: { x: 14, y: 12 }, agentAskCall: { x: 14, y: 12 }, meetOpen: { x: 16, y: 64 } },
    mac: { meet: { x: 13, y: 8 }, notifCall: { x: 14, y: 8 }, agentAskCall: { x: 14, y: 8 }, meetOpen: { x: 16, y: 94 } },
  },
  timer: {
    anchor: 'right',
    win: { meet: { x: 13, y: 13 }, notifCall: { x: 14, y: 13 }, agentAskCall: { x: 14, y: 13 }, meetOpen: { x: 16, y: 24 } },
    mac: { meet: { x: 13, y: 9 }, notifCall: { x: 14, y: 9 }, agentAskCall: { x: 14, y: 9 }, meetOpen: { x: 16, y: 54 } },
  },
  agentIcon: {
    anchor: 'left',
    win: {
      agent: { x: 13, y: 9, s: 22 },
      agentOpen: { x: 16, y: 17, s: 28 },
      agentAsk: { x: 16, y: 17, s: 28 },
      agentAskCall: { x: 16, y: 57, s: 28 },
      multiOpen: { x: 16, y: 17, s: 28 },
    },
    mac: {
      agent: { x: 13, y: 6, s: 20 },
      agentOpen: { x: 16, y: 47, s: 28 },
      agentAsk: { x: 16, y: 47, s: 28 },
      agentAskCall: { x: 16, y: 47, s: 28 },
      multiOpen: { x: 16, y: 47, s: 28 },
    },
  },
  dots: {
    anchor: 'right',
    win: { agent: { x: 13, y: 18 }, agentOpen: { x: 23, y: 29, o: 0 } },
    mac: { agent: { x: 13, y: 14 }, agentOpen: { x: 23, y: 59, o: 0 } },
  },
  elapsed: {
    anchor: 'right',
    win: { agent: { x: 13, y: 13, o: 0 }, agentOpen: { x: 16, y: 24 }, agentAsk: { x: 16, y: 24 }, agentAskCall: { x: 16, y: 64 } },
    mac: { agent: { x: 13, y: 9, o: 0 }, agentOpen: { x: 16, y: 54 }, agentAsk: { x: 16, y: 54 }, agentAskCall: { x: 16, y: 54 } },
  },
  // Le prototype ne place jamais le compte (le jardin occupe multi au repos) : voir sharedPosition sans jardin.
  count: { anchor: 'left', win: {}, mac: {} },
  seg0: segSpec(0),
  seg1: segSpec(1),
  seg2: segSpec(2),
  seg3: segSpec(3),
  seg4: segSpec(4),
  dropIcon: {
    anchor: 'left',
    win: { dragWake: { x: 16, y: 13 }, dragOver: { x: 16, y: 13 } },
    mac: { dragWake: { x: 16, y: 39 }, dragOver: { x: 16, y: 41 } },
  },
}

export const SHARED_ELEMENT_IDS = Object.keys(SHARED_ELEMENTS) as SharedElementId[]

/**
 * Repli de `multi` au repos tant que le jardin n'est pas branché (ajout) : icône Claude comme dans `agent`,
 * compte juste après, pastilles alignées à droite (le commentaire du prototype : « alignées à droite en compact »).
 */
const NO_GARDEN = {
  win: { icon: { x: 13, y: 9, s: 22 }, count: { x: 41, y: 13 } },
  mac: { icon: { x: 13, y: 6, s: 20 }, count: { x: 39, y: 9 } },
  /** Pastille : 6 px, 4 px d'écart, 13 px du bord droit. */
  seg: { size: 6, gap: 4, inset: 13 },
} as const

export interface SharedContext {
  /** Le jardin occupe `multi` au repos (sinon : repli compte + pastilles). */
  hasGarden: boolean
  /** Nombre de sessions Claude Code affichées (pastilles). */
  sessionCount: number
}

function segIndex(id: SharedElementId): number | null {
  if (id === 'seg0') return 0
  if (id === 'seg1') return 1
  if (id === 'seg2') return 2
  if (id === 'seg3') return 3
  if (id === 'seg4') return 4
  return null
}

/** Position cible d'un élément partagé pour une clé de taille ; null : absent (il s'efface). */
export function sharedPosition(
  id: SharedElementId,
  platform: IslandPlatform,
  key: IslandSizeKey,
  ctx: SharedContext,
): SharedPosition | null {
  const seg = segIndex(id)
  const segs = Math.min(ctx.sessionCount, MAX_SESSION_ROWS)
  if (seg !== null && seg >= segs) return null
  if (key === 'multi' && !ctx.hasGarden) {
    if (id === 'agentIcon') return NO_GARDEN[platform].icon
    if (id === 'count') return NO_GARDEN[platform].count
    if (seg !== null) {
      const size = ISLAND_SIZES[platform].multi
      const { size: dot, gap, inset } = NO_GARDEN.seg
      return { x: size.w - inset - dot - (segs - 1 - seg) * (dot + gap), y: (size.h - dot) / 2 }
    }
  }
  return SHARED_ELEMENTS[id][platform][key] ?? null
}

// ---------------------------------------------------------------------------
// Bulle de l'activité secondaire (prototype : updateBubble, renderBubble, flyGhost)
// ---------------------------------------------------------------------------

/** Bulle visible : Windows 44 × 40 rayon 14, Mac 44 × 32 rayon 10. */
export const BUBBLE_SIZES: Record<IslandPlatform, IslandShapeSize> = {
  win: { w: 44, h: 40, r: 14 },
  mac: { w: 44, h: 32, r: 10 },
}

/** Bulle cachée : elle rétrécit vers 14 × 10 en s'effaçant. */
export const BUBBLE_HIDDEN = { w: 14, h: 10 } as const

/** Écart entre l'île et la bulle (px). */
export const BUBBLE_GAP = 4

/** Sous ce seuil d'opacité, la bulle cachée sort du rendu. */
export const BUBBLE_MIN_OPACITY = 0.02

/** Icône qui glisse de la bulle vers l'île quand l'activité secondaire devient principale. */
export const GHOST = {
  /** Position d'arrivée : bord gauche de la zone de contenu + 13 px. */
  inset: 13,
  /** Largeur de l'icône dans la bulle (anneau de 22 px). */
  iconSize: 22,
  /** Agrandissement à l'arrivée. */
  scale: 1.1,
  /** Retrait du fantôme (ms), après sa transition de 0,45 s. */
  lifetimeMs: 520,
} as const

// ---------------------------------------------------------------------------
// Anneau de progression, onde de l'appel
// ---------------------------------------------------------------------------

export const RING = {
  /** Périmètre du cercle de rayon 7 : stroke-dasharray. */
  circumference: 43.98,
  /** Avancement estimé adouci : 1 - (1 - p)^2,2. */
  easePower: 2.2,
  /**
   * Plafond de l'estimation (ajout) : sans avancement réel, l'anneau s'arrête à 95 % au lieu de paraître
   * fini alors que l'étape continue.
   */
  estimateCap: 0.95,
} as const

/** Avancement affiché 0..1 : réel quand `fraction` est connu, sinon estimé depuis le début et la durée prévue. */
export function progressRatio(
  p: { fraction: number | null; startedAt: number; estimatedMs: number },
  now: number,
): number {
  if (p.fraction !== null) return Math.max(0, Math.min(1, p.fraction))
  const t = p.estimatedMs > 0 ? Math.max(0, Math.min(1, (now - p.startedAt) / p.estimatedMs)) : 1
  return Math.min(RING.estimateCap, 1 - Math.pow(1 - t, RING.easePower))
}

/** stroke-dashoffset de l'anneau pour un avancement 0..1. */
export function ringDashOffset(ratio: number): number {
  return RING.circumference * (1 - Math.max(0, Math.min(1, ratio)))
}

export const WAVE = {
  /** 26 barres de 2 px, 1 px d'écart. */
  bars: 26,
  minHeight: 1,
  maxHeight: 14,
  /** L'onde défile d'une barre toutes les 90 ms. */
  scrollMs: 90,
  /** Motif de départ de la maquette. */
  initial: [1, 1, 3, 12, 3, 14, 12, 10, 12, 14, 10, 6, 6, 10, 14, 6, 1, 1, 1, 8, 1, 6, 6, 14, 1, 1],
} as const

/** Hauteur d'une barre (px) pour un niveau sonore 0..1 déjà mis à l'échelle. */
export function waveBarHeight(level: number): number {
  const l = Math.max(0, Math.min(1, level))
  return Math.max(WAVE.minHeight, Math.min(WAVE.maxHeight, Math.round(WAVE.minHeight + l * (WAVE.maxHeight - WAVE.minHeight))))
}

// ---------------------------------------------------------------------------
// Zones cliquables
// ---------------------------------------------------------------------------

export interface HitRectsInput {
  /** Largeur de la racine (la fenêtre transparente) : l'île est centrée, collée en haut. */
  rootWidth: number
  platform: IslandPlatform
  island: { current: IslandShapeSize; target: IslandShapeSize }
  /** null : bulle sortie du rendu. */
  bubble: { current: { w: number; h: number }; target: { w: number; h: number } } | null
}

function outward(x: number, y: number, right: number, bottom: number): IslandRect {
  const fx = Math.floor(x)
  const fy = Math.floor(y)
  return { x: fx, y: fy, width: Math.ceil(right) - fx, height: Math.ceil(bottom) - fy }
}

/**
 * Rectangles de la forme et de la bulle (px CSS, relatifs à la racine), arrondis vers l'extérieur.
 * Union de la taille courante et de la cible : le survol n'est pas perdu pendant une transition.
 */
export function hitRectsFor(input: HitRectsInput): IslandRect[] {
  const { platform, island, bubble } = input
  const cx = input.rootWidth / 2
  const cur = shapeGeometry(island.current.w, island.current.h, island.current.r, platform)
  const tgt = shapeGeometry(island.target.w, island.target.h, island.target.r, platform)
  const W = Math.max(cur.width, tgt.width)
  const H = Math.max(cur.height, tgt.height)
  const rects = [outward(cx - W / 2, 0, cx + W / 2, H)]
  if (bubble) {
    const r = BUBBLE_SIZES[platform].r
    const bc = shapeGeometry(bubble.current.w, bubble.current.h, r, platform)
    const bt = shapeGeometry(bubble.target.w, bubble.target.h, r, platform)
    const left = cx + Math.min(cur.width, tgt.width) / 2 + BUBBLE_GAP
    const right = cx + W / 2 + BUBBLE_GAP + Math.max(bc.width, bt.width)
    rects.push(outward(left, 0, right, Math.max(bc.height, bt.height)))
  }
  return rects
}
