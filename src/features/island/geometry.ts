/**
 * Géométrie de l'île : SEUL endroit des cibles d'animation (tailles par état, ressort, bord concave,
 * positions des éléments partagés, bulle secondaire, anneau, onde).
 * Source : design/prototypes/ile-sordulo-os.html (objets S et SH, fonctions render, renderBubble, frame).
 * Couleurs, police et tailles de texte : section « Île » de src/styles/tokens.css, jamais ici.
 * Ce fichier est pur (ni React ni DOM) : il est lu par le rendu (view/), le labo et le jardin.
 */
import type { IslandDragStart, IslandRect } from '../../shared/desktop-contract'
import type { IslandEdge, IslandPlatform, IslandSizeKey, IslandState } from './types'

/** Plateforme par défaut. L'app de bureau choisit la vraie dans l'URL de l'île (`?platform=mac` sur un Mac à encoche). */
export const ACTIVE_PLATFORM: IslandPlatform = 'win'

/** Variante demandée par l'app de bureau dans l'URL de la fenêtre de l'île ; ACTIVE_PLATFORM sinon. */
export function platformFromSearch(search: string): IslandPlatform {
  return new URLSearchParams(search).get('platform') === 'mac' ? 'mac' : ACTIVE_PLATFORM
}

// ---------------------------------------------------------------------------
// Bords de l'écran (île déplaçable)
// ---------------------------------------------------------------------------

/** Bord par défaut : en haut au centre, comme avant l'île déplaçable. */
export const DEFAULT_EDGE: IslandEdge = 'top'

/** Déplacement (px CSS) au-delà duquel un appui sur l'île devient un glisser (le clic est alors annulé). */
export const DRAG_THRESHOLD_PX = 6

/** Le déplacement depuis l'appui dépasse le seuil du glisser (distance strictement supérieure). */
export function isDragMove(dx: number, dy: number): boolean {
  return dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
}

/** Bord gauche ou droit (île verticale au repos). */
export function isSideEdge(edge: IslandEdge): boolean {
  return edge === 'left' || edge === 'right'
}

/**
 * Variante de forme réellement dessinée : l'encoche n'existe qu'en haut de l'écran. En bas et sur les côtés,
 * l'île prend les tailles et positions `win`, même sur Mac.
 */
export function edgePlatform(platform: IslandPlatform, edge: IslandEdge): IslandPlatform {
  return edge === 'top' ? platform : 'win'
}

/**
 * Clés de taille compactes : sur les bords gauche et droit, elles deviennent une pilule verticale (la boîte de
 * l'état, transposée). Toutes les autres clés (états ouverts) restent une carte horizontale qui sort du bord.
 */
export const COMPACT_SIZE_KEYS: ReadonlySet<IslandSizeKey> = new Set<IslandSizeKey>([
  'repos',
  'peek',
  'meet',
  'music',
  'musicGarden',
  'progress',
  'agent',
  'multi',
  'dragWake',
])

/** Pilule verticale : bord gauche ou droit et clé compacte. */
export function isVerticalLayout(edge: IslandEdge, key: IslandSizeKey): boolean {
  return isSideEdge(edge) && COMPACT_SIZE_KEYS.has(key)
}

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
 * `musicOpen` (survol de la musique, absent du prototype) : pochette de 56 px, progression, boutons du lecteur
 * (Windows : 16 + 56 + 12 + 14 + 6 + 32 + 14 ; Mac : 44 sous l'encoche au lieu de 16). Sans progression
 * connue, la forme perd MUSIC_OPEN.progressRow (voir islandSize).
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
    musicOpen: { w: 380, h: 150, r: 26 },
    musicGarden: { w: 193, h: 40, r: 14 },
    progress: { w: 193, h: 40, r: 14 },
    agent: { w: 193, h: 40, r: 14 },
    agentOpen: { w: 360, h: 96, r: 24 },
    agentAsk: { w: 380, h: 156, r: 26 },
    agentAskCall: { w: 380, h: 196, r: 26 },
    agentQuestion: { w: 380, h: 196, r: 26 },
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
    musicOpen: { w: 400, h: 178, r: 26 },
    musicGarden: { w: 274, h: 32, r: 10 },
    progress: { w: 274, h: 32, r: 10 },
    agent: { w: 274, h: 32, r: 10 },
    agentOpen: { w: 380, h: 124, r: 26 },
    agentAsk: { w: 400, h: 184, r: 26 },
    agentAskCall: { w: 400, h: 184, r: 26 },
    agentQuestion: { w: 400, h: 184, r: 26 },
    multi: { w: 370, h: 32, r: 10 },
    multiOpen: { w: 420, h: 250, r: 26 },
    dragWake: { w: 240, h: 64, r: 20 },
    dragOver: { w: 460, h: 178, r: 26 },
    notif: { w: 360, h: 96, r: 24 },
    notifCall: { w: 370, h: 96, r: 24 },
  },
}

/**
 * Lignes « aussi en cours » sous l'appel dans meetOpen (ajout, absent du prototype) : une par activité ou
 * session Claude, 3 au plus. Chaque ligne ajoute `rowH`, plus `gap` une fois (filet au-dessus des lignes).
 */
export const MEET_BACKGROUND = {
  maxRows: 3,
  win: { rowH: 30, gap: 8 },
  mac: { rowH: 30, gap: 8 },
} as const

/**
 * Vue ouverte de la musique (musicOpen) : taille de la pochette, hauteur de la ligne de progression
 * (écart 12 + ligne 14), retirée de la forme quand le lecteur ne donne ni position ni durée, et de la ligne
 * des boutons (écart 6 + boutons 32), retirée quand l'île ne peut pas commander le lecteur (Spotify sur un
 * autre appareil sans Premium).
 */
export const MUSIC_OPEN = {
  coverSize: 56,
  progressRow: 26,
  controlsRow: 38,
} as const

/**
 * Dimensions d'une clé de taille ; meetOpen grandit avec les lignes « aussi en cours », musicOpen perd la
 * ligne de progression quand elle n'est pas connue (`musicProgress` faux).
 */
export function islandSize(
  platform: IslandPlatform,
  key: IslandSizeKey,
  meetRows = 0,
  musicProgress = true,
  musicControls = true,
): IslandShapeSize {
  const size = ISLAND_SIZES[platform][key]
  let h = size.h
  if (key === 'musicOpen' && !musicProgress) h -= MUSIC_OPEN.progressRow
  if (key === 'musicOpen' && !musicControls) h -= MUSIC_OPEN.controlsRow
  // Lignes « aussi en cours » : sous l'appel (meetOpen) et sous la musique (sessions Claude, musicOpen).
  const rows = Math.min(Math.max(0, meetRows), MEET_BACKGROUND.maxRows)
  if ((key === 'meetOpen' || key === 'musicOpen') && rows > 0) {
    const { rowH, gap } = MEET_BACKGROUND[platform]
    h += gap + rows * rowH
  }
  return h === size.h ? size : { ...size, h }
}

/**
 * Clé de taille d'un état (prototype : currentKey et keyFor).
 * Survol : repos → peek, meet → meetOpen, music → musicOpen, agent → agentOpen, multi → multiOpen.
 * Pendant un appel : notif → notifCall, agentAsk → agentAskCall.
 * Musique avec des sessions Claude (`musicGarden` vrai) : music → musicGarden (les Claude marchent en bas).
 */
export function sizeKeyFor(state: IslandState, hover: boolean, withCall: boolean, musicGarden = false): IslandSizeKey {
  if (hover) {
    if (state === 'repos') return 'peek'
    if (state === 'meet') return 'meetOpen'
    if (state === 'music') return 'musicOpen'
    if (state === 'agent') return 'agentOpen'
    if (state === 'multi') return 'multiOpen'
  }
  if (state === 'notif' && withCall) return 'notifCall'
  if (state === 'agentAsk' && withCall) return 'agentAskCall'
  if (state === 'music' && musicGarden) return 'musicGarden'
  return state
}

/**
 * Taille d'une couche de contenu (prototype : sizeLayers) : la couche a la taille de l'état ouvert,
 * la forme animée la découpe. meet → meetOpen, music → musicOpen, agent → agentOpen, multi → multiOpen.
 */
export function layerSizeKeyFor(state: IslandState, withCall: boolean): IslandSizeKey {
  if (state === 'meet') return 'meetOpen'
  if (state === 'music') return 'musicOpen'
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
  /** Rayon des coins côté bord quand la forme s'en détache (goutte du glisser) ; 0 collée au bord. */
  cap: number
}

function n(v: number): string {
  return String(+v.toFixed(3))
}

/**
 * Forme de l'île ou de la bulle (prototype : render, renderBubble) : bord haut droit sur toute la largeur,
 * arrondis concaves de rayon e en haut à gauche et à droite, côtés droits, coins bas de rayon r.
 */
export function shapeGeometry(
  w: number,
  h: number,
  r: number,
  platform: IslandPlatform,
  detach = 0,
): IslandShapeGeometry {
  const width0 = Math.max(0, w)
  const height = Math.max(1, h)
  const { e, radius, cap } = detachedCorners(width0, height, r, edgeFor(platform, height), detach)
  const W = width0 + 2 * e
  const top = Math.max(e, cap)
  const right = cap > 0 ? `A${n(cap)} ${n(cap)} 0 0 1 ${n(W)} ${n(cap)}` : `A${n(e)} ${n(e)} 0 0 0 ${n(W - e)} ${n(e)}`
  const left = cap > 0 ? `A${n(cap)} ${n(cap)} 0 0 1 ${n(cap)} 0` : `A${n(e)} ${n(e)} 0 0 0 0 0`
  const d =
    `M${n(cap)} 0H${n(W - cap)}${right}V${n(height - radius)}` +
    `A${n(radius)} ${n(radius)} 0 0 1 ${n(W - e - radius)} ${n(height)}H${n(e + radius)}` +
    `A${n(radius)} ${n(radius)} 0 0 1 ${n(e)} ${n(height - radius)}V${n(top)}${left}Z`
  return { d, width: W, height, edge: e, radius, innerWidth: width0, cap }
}

/**
 * Coins de la forme selon `detach` (0 collée au bord, 1 détachée : goutte du glisser). Première moitié : les
 * arrondis concaves qui la relient au bord rentrent ; seconde moitié : les coins côté bord s'arrondissent,
 * jusqu'à une pilule (un rond si la forme est carrée). Le chemin reste continu, d'où l'effet liquide.
 */
function detachedCorners(
  width: number,
  height: number,
  r: number,
  edge: number,
  detach: number,
): { e: number; radius: number; cap: number } {
  const t = Math.max(0, Math.min(1, detach))
  const e = t < 0.5 ? edge * (1 - 2 * t) : 0
  const radius = Math.max(0, Math.min(r, height - e, width / 2))
  const cap = t > 0.5 ? Math.max(0, Math.min(radius, height - radius, width / 2)) * (2 * t - 1) : 0
  return { e, radius, cap }
}

/**
 * Taille d'un état dans le repère du bord : `w` le long du bord, `h` en profondeur (vers l'intérieur de
 * l'écran), `r` le rayon des coins du côté opposé au bord.
 * - En haut et en bas : la taille de l'état telle quelle.
 * - À gauche et à droite, états compacts : la même chose (la pilule horizontale tournée devient verticale).
 * - À gauche et à droite, états ouverts : transposée (la carte reste horizontale : sa largeur est la
 *   profondeur, sa hauteur court le long du bord).
 */
export function edgeFrameSize(size: IslandShapeSize, edge: IslandEdge, key: IslandSizeKey): IslandShapeSize {
  if (!isSideEdge(edge)) return size
  if (COMPACT_SIZE_KEYS.has(key)) return { ...size, w: VERTICAL_PILL_LENGTH[key] ?? size.w }
  return { w: size.h, h: size.w, r: size.r }
}

/**
 * Longueur de la pilule verticale (états compacts à gauche et à droite), plus courte que la pilule horizontale
 * (193 px) : sur le côté, une île haute gêne (demande de Maël, 23/11). Les cartes ouvertes gardent leur taille.
 * Les éléments ancrés à droite en horizontal sont mesurés depuis le bas : ils suivent la longueur.
 */
export const VERTICAL_PILL_LENGTH: Partial<Record<IslandSizeKey, number>> = {
  repos: 84,
  peek: 104,
  meet: 132,
  music: 132,
  musicGarden: 132,
  progress: 132,
  agent: 132,
  multi: 132,
  dragWake: 120,
}

/** Rectangle en px CSS (x, y : coin haut gauche). */
export interface BoxRect {
  x: number
  y: number
  width: number
  height: number
}

export interface EdgeShapeGeometry {
  /** Chemin SVG dans la boîte de l'île (attribut d), repère de l'écran. */
  d: string
  /** Taille de la boîte à l'écran (arrondis concaves compris). */
  width: number
  height: number
  /** Bord e (arrondis concaves côté écran). */
  edge: number
  /** Rayon des coins opposés au bord, effectivement appliqué. */
  radius: number
  /** Longueur de la zone de contenu le long du bord et profondeur (repère du bord). */
  along: number
  depth: number
  /** Zone de contenu dans la boîte, repère de l'écran. */
  content: BoxRect
}

/** Point du repère du bord (u le long du bord, v en profondeur) → repère de l'écran, dans la boîte. */
function edgePoint(edge: IslandEdge, u: number, v: number, depth: number): [number, number] {
  if (edge === 'bottom') return [u, depth - v]
  if (edge === 'left') return [v, u]
  if (edge === 'right') return [depth - v, u]
  return [u, v]
}

/**
 * Forme de l'île collée à un bord : calculée dans le repère du bord (celui de `shapeGeometry`, bord droit sur
 * l'écran, arrondis concaves côté écran, coins arrondis de rayon r de l'autre côté), puis chaque point est
 * reporté dans le repère de l'écran. Bas et gauche sont des symétries : le sens des arcs (sweep) s'inverse ;
 * droite est une rotation : il reste le même. En haut, le chemin est exactement celui de `shapeGeometry`.
 * `along` : longueur de la zone de contenu le long du bord ; `depth` : profondeur (voir edgeFrameSize).
 */
export function edgeShapeGeometry(
  along: number,
  depth: number,
  r: number,
  platform: IslandPlatform,
  edge: IslandEdge,
  detach = 0,
): EdgeShapeGeometry {
  const g = shapeGeometry(along, depth, r, edgePlatform(platform, edge), detach)
  const { edge: e, radius, height: D, innerWidth: L, cap } = g
  const W = g.width
  const side = isSideEdge(edge)
  const width = side ? D : W
  const height = side ? W : D
  const content: BoxRect = side ? { x: 0, y: e, width: D, height: L } : { x: e, y: 0, width: L, height: D }
  if (edge === 'top') {
    return { d: g.d, width, height, edge: e, radius, along: L, depth: D, content }
  }
  const flip = edge !== 'right'
  const p = (u: number, v: number) => {
    const [x, y] = edgePoint(edge, u, v, D)
    return `${n(x)} ${n(y)}`
  }
  const arc = (rad: number, sweep: 0 | 1, u: number, v: number) =>
    `A${n(rad)} ${n(rad)} 0 0 ${flip ? 1 - sweep : sweep} ${p(u, v)}`
  const top = Math.max(e, cap)
  const right = cap > 0 ? arc(cap, 1, W, cap) : arc(e, 0, W - e, e)
  const left = cap > 0 ? arc(cap, 1, cap, 0) : arc(e, 0, 0, 0)
  const d =
    `M${p(cap, 0)}L${p(W - cap, 0)}${right}L${p(W - e, D - radius)}` +
    `${arc(radius, 1, W - e - radius, D)}L${p(e + radius, D)}` +
    `${arc(radius, 1, e, D - radius)}L${p(e, top)}${left}Z`
  return { d, width, height, edge: e, radius, along: L, depth: D, content }
}

/** Position de la boîte de l'île dans la fenêtre : au milieu du bord, collée à lui. */
export function islandBoxPosition(
  edge: IslandEdge,
  box: { width: number; height: number },
  root: { width: number; height: number },
): { x: number; y: number } {
  if (edge === 'bottom') return { x: (root.width - box.width) / 2, y: root.height - box.height }
  if (edge === 'left') return { x: 0, y: (root.height - box.height) / 2 }
  if (edge === 'right') return { x: root.width - box.width, y: (root.height - box.height) / 2 }
  return { x: (root.width - box.width) / 2, y: 0 }
}

/** Taille envoyée au début d'un glisser (IslandDragStart) : taille d'un état dans le repère du bord. */
export function dragStartSize(size: IslandShapeSize): IslandDragStart {
  return { along: size.w, depth: size.h }
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
  | 'musicCover'
  | 'musicEq'

/** Position depuis le bord d'ancrage de la zone de contenu (x) et le haut (y), taille (s), opacité (o). */
export interface SharedPosition {
  x: number
  y: number
  /** Taille (px) des éléments carrés qui grandissent : icône Claude, pochette (SIZED_SHARED_ELEMENTS). */
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

/** Éléments partagés dont le moteur écrit aussi la largeur et la hauteur (taille `s`). */
export const SIZED_SHARED_ELEMENTS: ReadonlySet<SharedElementId> = new Set<SharedElementId>(['agentIcon', 'musicCover'])

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
      agentQuestion: { x: 16, y: 17, s: 28 },
      agentAskCall: { x: 16, y: 57, s: 28 },
      multiOpen: { x: 16, y: 17, s: 28 },
    },
    mac: {
      agent: { x: 13, y: 6, s: 20 },
      agentOpen: { x: 16, y: 47, s: 28 },
      agentAsk: { x: 16, y: 47, s: 28 },
      agentQuestion: { x: 16, y: 47, s: 28 },
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
    win: { agent: { x: 13, y: 13, o: 0 }, agentOpen: { x: 16, y: 24 }, agentAsk: { x: 16, y: 24 }, agentQuestion: { x: 16, y: 24 }, agentAskCall: { x: 16, y: 64 } },
    mac: { agent: { x: 13, y: 9, o: 0 }, agentOpen: { x: 16, y: 54 }, agentAsk: { x: 16, y: 54 }, agentQuestion: { x: 16, y: 54 }, agentAskCall: { x: 16, y: 54 } },
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
  // Musique (ajout) : la pochette grandit de la gauche de l'île compacte vers le haut gauche de musicOpen,
  // l'égaliseur (23 × 14) reste à droite, centré sur la pochette (Mac : sous l'encoche, comme agentOpen).
  musicCover: {
    anchor: 'left',
    win: {
      // Même marge à gauche et en bas (8 px, Mac 5 px) : la pochette suit l'arrondi de l'île.
      music: { x: 8, y: 8, s: 24 },
      musicGarden: { x: 8, y: 8, s: 24 },
      musicOpen: { x: 16, y: 16, s: MUSIC_OPEN.coverSize },
    },
    mac: {
      music: { x: 5, y: 5, s: 22 },
      musicGarden: { x: 5, y: 5, s: 22 },
      musicOpen: { x: 16, y: 44, s: MUSIC_OPEN.coverSize },
    },
  },
  musicEq: {
    anchor: 'right',
    win: { music: { x: 11, y: 13 }, musicGarden: { x: 11, y: 13 }, musicOpen: { x: 16, y: 37 } },
    mac: { music: { x: 8, y: 9 }, musicGarden: { x: 8, y: 9 }, musicOpen: { x: 16, y: 65 } },
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

/**
 * Pilule verticale (bords gauche et droit, clés compactes) : retouches de la transposition pour les éléments
 * plus larges que la pilule une fois transposés. `cross: 'center'` : centré en travers de la pilule (avec sa
 * largeur mesurée). L'onde de l'appel est masquée en vertical (CSS, data-vertical) : il reste l'icône.
 * Pas de maquette Figma pour la pilule verticale : à valider avec Sacha.
 */
export interface VerticalOverride {
  cross?: number | 'center'
  along?: number
  o?: number
}

export const VERTICAL_SHARED: Partial<Record<SharedElementId, Partial<Record<IslandSizeKey, VerticalOverride>>>> = {
  timer: { meet: { cross: 'center' } },
  dots: { agent: { cross: 'center' } },
  musicEq: { music: { cross: 'center' }, musicGarden: { cross: 'center' } },
  count: { multi: { cross: 'center' } },
}

/**
 * Placement d'un élément partagé dans la zone de contenu, repère de l'écran : distance `x` au côté `h`,
 * distance `y` au côté `v` (le moteur écrit `style[h] = x`, `style[v] = y`).
 */
export interface SharedPlacement {
  h: 'left' | 'right'
  x: number
  v: 'top' | 'bottom'
  y: number
  s?: number
  o?: number
}

/**
 * Placement cible d'un élément partagé à un bord ; null : absent.
 * - Haut : SHARED_ELEMENTS tel quel (x depuis le côté d'ancrage, y depuis le haut).
 * - Bas : miroir, y mesuré depuis le bas (y' = h − y − taille) : même distance au bord de l'écran.
 * - Gauche / droite, états ouverts : comme en haut (la carte horizontale garde sa mise en page).
 * - Gauche / droite, pilule verticale : transposé. Gauche : x' = y (depuis la gauche), y' = x ; droite :
 *   x' = largeur − y − taille (y depuis la droite), y' = x. Un élément ancré à droite en horizontal est
 *   mesuré depuis le bas. Retouches : VERTICAL_SHARED (`crossSize` : largeur mesurée de l'élément).
 */
export function sharedPlacement(
  id: SharedElementId,
  platform: IslandPlatform,
  key: IslandSizeKey,
  ctx: SharedContext,
  edge: IslandEdge = DEFAULT_EDGE,
  crossSize = 0,
): SharedPlacement | null {
  const p = edgePlatform(platform, edge)
  const pos = sharedPosition(id, p, key, ctx)
  if (!pos) return null
  const anchor = SHARED_ELEMENTS[id].anchor
  const extra = { ...(pos.s !== undefined ? { s: pos.s } : {}), ...(pos.o !== undefined ? { o: pos.o } : {}) }
  if (!isVerticalLayout(edge, key)) {
    // En bas : seuls les états compacts sont en miroir (même distance au bord de l'écran) ; une carte ouverte
    // garde l'ordre de lecture de ses couches (pochette en haut, à côté du titre).
    const mirrored = edge === 'bottom' && COMPACT_SIZE_KEYS.has(key)
    return { h: anchor, x: pos.x, v: mirrored ? 'bottom' : 'top', y: pos.y, ...extra }
  }
  const over = VERTICAL_SHARED[id]?.[key]
  const pillWidth = ISLAND_SIZES[p][key].h
  const size = pos.s ?? crossSize
  const cross = over?.cross === 'center' ? (pillWidth - size) / 2 : (over?.cross ?? pos.y)
  const placement: SharedPlacement = {
    h: edge === 'right' ? 'right' : 'left',
    x: cross,
    v: anchor === 'left' ? 'top' : 'bottom',
    y: over?.along ?? pos.x,
    ...extra,
  }
  if (over?.o !== undefined) placement.o = over.o
  return placement
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
  /** Largeur de la racine (la fenêtre transparente). */
  rootWidth: number
  /** Hauteur de la racine (utile en bas et sur les côtés) ; 0 par défaut. */
  rootHeight?: number
  /** Bord où l'île est collée, au milieu ; 'top' par défaut. */
  edge?: IslandEdge
  platform: IslandPlatform
  /** Tailles dans le repère du bord (edgeFrameSize) : w le long du bord, h en profondeur. */
  island: { current: IslandShapeSize; target: IslandShapeSize }
  /** null : bulle sortie du rendu. Seulement en haut (une seule île : la bulle n'est plus utilisée). */
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
  const { island, bubble } = input
  const edge = input.edge ?? DEFAULT_EDGE
  const platform = edgePlatform(input.platform, edge)
  const root = { width: input.rootWidth, height: input.rootHeight ?? 0 }
  const cur = edgeShapeGeometry(island.current.w, island.current.h, island.current.r, platform, edge)
  const tgt = edgeShapeGeometry(island.target.w, island.target.h, island.target.r, platform, edge)
  const box = { width: Math.max(cur.width, tgt.width), height: Math.max(cur.height, tgt.height) }
  const { x, y } = islandBoxPosition(edge, box, root)
  const rects = [outward(x, y, x + box.width, y + box.height)]
  if (bubble && edge === 'top') {
    const cx = input.rootWidth / 2
    const W = box.width
    const r = BUBBLE_SIZES[platform].r
    const bc = shapeGeometry(bubble.current.w, bubble.current.h, r, platform)
    const bt = shapeGeometry(bubble.target.w, bubble.target.h, r, platform)
    const left = cx + Math.min(cur.width, tgt.width) / 2 + BUBBLE_GAP
    const right = cx + W / 2 + BUBBLE_GAP + Math.max(bc.width, bt.width)
    rects.push(outward(left, 0, right, Math.max(bc.height, bt.height)))
  }
  return rects
}
