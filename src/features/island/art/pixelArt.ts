/**
 * Dessins en pixel art des accessoires des Claude (feuille, carnet, crayon, dossier, clavier et invite, loupe,
 * engrenages), partagés par le Claude de l'île (view/ClaudeMascot) et ceux du jardin (garden/renderer).
 * Une case = un pixel de la grille 16 × 16 du personnage. Les couleurs sont des classes (tons) de
 * pixelArt.module.css, branchées sur les tokens `--island-mascot-*`.
 *
 * Animations en images, comme en pixel art : `frame` alterne deux images (engrenages : dents droites puis dents
 * en diagonale, ce qui fait tourner la roue) ; `blink` clignote (curseur, touches).
 */

export type ArtTone =
  | 'sheet'
  | 'line'
  | 'pencilBody'
  | 'pencilTip'
  | 'eraser'
  | 'folder'
  | 'folderLip'
  | 'folderBack'
  | 'keys'
  | 'key'
  | 'cursor'
  | 'glass'
  | 'pupil'
  | 'ring'
  | 'handle'
  | 'gear'
  | 'gearSmall'

export interface PixelRect {
  x: number
  y: number
  w: number
  h: number
  tone: ArtTone
  /** Image de l'animation à deux images (`a` d'abord, puis `b`) ; absent : toujours visible. */
  frame?: 'a' | 'b'
  /** Clignote (curseur, touche). */
  blink?: boolean
}

export interface PixelArt {
  /** Taille en cases. */
  w: number
  h: number
  rects: readonly PixelRect[]
}

const r = (x: number, y: number, w: number, h: number, tone: ArtTone, extra: Partial<PixelRect> = {}): PixelRect => ({
  x,
  y,
  w,
  h,
  tone,
  ...extra,
})

/** Cases isolées d'un même ton. */
const cells = (tone: ArtTone, list: ReadonlyArray<readonly [number, number]>, extra: Partial<PixelRect> = {}) =>
  list.map(([x, y]) => r(x, y, 1, 1, tone, extra))

/**
 * Grande roue (7 × 7) : moyeu rond percé au centre, quatre dents ; image `a` dents droites, `b` en diagonale.
 */
function bigGear(tone: ArtTone, phase: 'a' | 'b'): PixelRect[] {
  const other = phase === 'a' ? 'b' : 'a'
  return [
    r(2, 1, 3, 1, tone),
    r(1, 2, 5, 1, tone),
    r(1, 3, 2, 1, tone),
    r(4, 3, 2, 1, tone),
    r(1, 4, 5, 1, tone),
    r(2, 5, 3, 1, tone),
    ...cells(tone, [[3, 0], [3, 6], [0, 3], [6, 3]], { frame: phase }),
    // Dents en diagonale sur deux cases (coin du moyeu et case au-delà) : elles dépassent, la roue ne se lit
    // pas comme un carré.
    ...cells(tone, [[1, 1], [5, 1], [1, 5], [5, 5], [0, 0], [6, 0], [0, 6], [6, 6]], { frame: other }),
  ]
}

/** Petite roue (5 × 5), même principe. */
function smallGear(tone: ArtTone, phase: 'a' | 'b'): PixelRect[] {
  const other = phase === 'a' ? 'b' : 'a'
  return [
    r(1, 1, 3, 1, tone),
    r(1, 2, 1, 1, tone),
    r(3, 2, 1, 1, tone),
    r(1, 3, 3, 1, tone),
    ...cells(tone, [[2, 0], [2, 4], [0, 2], [4, 2]], { frame: phase }),
    ...cells(tone, [[0, 0], [4, 0], [0, 4], [4, 4]], { frame: other }),
  ]
}

export const ART = {
  /** Feuille tenue à deux mains (lit). */
  paper: {
    w: 8,
    h: 6,
    rects: [r(0, 0, 8, 6, 'sheet'), r(1, 1.25, 6, 0.5, 'line'), r(1, 2.75, 5, 0.5, 'line'), r(1, 4.25, 6, 0.5, 'line')],
  },
  /** Carnet (écrit). */
  notepad: {
    w: 8,
    h: 4,
    rects: [r(0, 0, 8, 4, 'sheet'), r(1, 1.25, 6, 0.5, 'line'), r(1, 2.5, 4, 0.5, 'line')],
  },
  /** Crayon en diagonale : pointe en bas à gauche, gomme en haut à droite. */
  pencil: {
    w: 5,
    h: 5,
    rects: [r(0, 4, 1, 1, 'pencilTip'), ...cells('pencilBody', [[1, 3], [2, 2], [3, 1]]), r(4, 0, 1, 1, 'eraser')],
  },
  /** Fond du dossier avec son onglet (derrière le personnage). */
  folderBack: { w: 12, h: 4, rects: [r(0, 0, 4, 1, 'folderBack'), r(0, 1, 12, 3, 'folderBack')] },
  /** Devant du dossier (devant le personnage). */
  folderFront: { w: 14, h: 6, rects: [r(0, 0, 14, 6, 'folder'), r(0, 0, 14, 1, 'folderLip')] },
  /** Clavier : touches qui s'allument tour à tour, barre d'espace. */
  keyboard: {
    w: 10,
    h: 2,
    rects: [
      r(0, 0, 10, 2, 'keys'),
      ...cells('key', [[1, 0], [5, 0]], { blink: true }),
      ...cells('key', [[3, 0], [7, 0]]),
      r(3, 1, 4, 1, 'key'),
    ],
  },
  /** Invite de commande « >_ », le curseur clignote. */
  prompt: {
    w: 5,
    h: 3,
    rects: [...cells('cursor', [[0, 0], [1, 1], [0, 2]]), r(2, 2, 2, 1, 'cursor', { blink: true })],
  },
  /** Loupe : verre teinté avec l'œil grossi, anneau, manche. */
  lens: {
    w: 9,
    h: 9,
    rects: [
      r(2, 1, 3, 1, 'glass'),
      r(1, 2, 5, 3, 'glass'),
      r(2, 5, 3, 1, 'glass'),
      r(3, 2, 2, 3, 'pupil'),
      r(2, 0, 3, 1, 'ring'),
      ...cells('ring', [[1, 1], [5, 1], [1, 5], [5, 5]]),
      r(0, 2, 1, 3, 'ring'),
      r(6, 2, 1, 3, 'ring'),
      r(2, 6, 3, 1, 'ring'),
      ...cells('handle', [[6, 6], [7, 7], [8, 8]]),
    ],
  },
  /**
   * Engrenages de la réflexion (11 × 7) : grande roue à gauche, petite roue engrenée à droite, en phase opposée
   * (quand l'une a les dents droites, l'autre les a en diagonale : elles tournent l'une contre l'autre).
   */
  gears: {
    w: 11,
    h: 7,
    rects: [...bigGear('gear', 'a'), ...smallGear('gearSmall', 'b').map((p) => ({ ...p, x: p.x + 6, y: p.y + 1 }))],
  },
} as const satisfies Record<string, PixelArt>

export type ArtName = keyof typeof ART

/** Classes de pixelArt.module.css dont a besoin le dessin dans le DOM (jardin). */
export type ArtClassNames = Record<ArtTone | 'art' | 'frameA' | 'frameB' | 'blink', string>

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Classe d'une case : son ton, et son image ou son clignotement. */
export function rectClass(rect: PixelRect, cls: ArtClassNames): string {
  const names = [cls[rect.tone]]
  if (rect.frame === 'a') names.push(cls.frameA)
  if (rect.frame === 'b') names.push(cls.frameB)
  if (rect.blink) names.push(cls.blink)
  return names.join(' ')
}

/** Dessin en SVG pour le DOM (jardin) ; `className` : place et animation de l'accessoire. */
export function createArtSvg(art: PixelArt, cls: ArtClassNames, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${art.w} ${art.h}`)
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', `${cls.art} ${className}`)
  for (const rect of art.rects) {
    const el = document.createElementNS(SVG_NS, 'rect')
    el.setAttribute('x', String(rect.x))
    el.setAttribute('y', String(rect.y))
    el.setAttribute('width', String(rect.w))
    el.setAttribute('height', String(rect.h))
    el.setAttribute('class', rectClass(rect, cls))
    svg.appendChild(el)
  }
  return svg
}
