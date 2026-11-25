/**
 * Dessin en pixel art d'un portail de l'encoche du Mac (grille 8 × 14, même case que le Claude : sa taille / 16),
 * vu de profil : anneau de la couleur du Claude, cœur sombre, reflets clairs qui descendent en quatre images
 * (comme les engrenages des accessoires : une image après l'autre, pas de glissé). Couleurs et animations :
 * Garden.module.css (.portal*), branchées sur les tokens --island-garden-portal-*. Moteur : renderer.ts.
 */

export type PortalCell = readonly [x: number, y: number, w: number, h: number]

/** Taille de la grille (cases) : un ovale vu un peu de biais, assez large pour qu'on voie sa surface. */
export const PORTAL_GRID = { w: 8, h: 14 } as const

/** Case dans l'ovale (centre de la case dans l'ellipse inscrite dans la grille). */
function inOval(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= PORTAL_GRID.w || y >= PORTAL_GRID.h) return false
  const a = PORTAL_GRID.w / 2
  const b = PORTAL_GRID.h / 2
  return ((x + 0.5 - a) / a) ** 2 + ((y + 0.5 - b) / b) ** 2 <= 1
}

/** Case de l'anneau : dans l'ovale, avec un voisin dehors. */
function onRim(x: number, y: number): boolean {
  const around: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  return inOval(x, y) && around.some(([dx, dy]) => !inOval(x + dx, y + dy))
}

/** Cases d'une grille gardées par `keep`, regroupées en segments horizontaux. */
function runs(keep: (x: number, y: number) => boolean): PortalCell[] {
  const out: PortalCell[] = []
  for (let y = 0; y < PORTAL_GRID.h; y += 1) {
    let start = -1
    for (let x = 0; x <= PORTAL_GRID.w; x += 1) {
      const on = x < PORTAL_GRID.w && keep(x, y)
      if (on && start < 0) start = x
      if (!on && start >= 0) {
        out.push([start, y, x - start, 1])
        start = -1
      }
    }
  }
  return out
}

/** Anneau. */
export const PORTAL_RIM: readonly PortalCell[] = runs(onRim)

/** Cœur (l'intérieur de l'anneau : la surface dans laquelle le Claude entre). */
export const PORTAL_CORE: readonly PortalCell[] = runs((x, y) => inOval(x, y) && !onRim(x, y))

/** Nombre d'images des reflets. */
export const PORTAL_FLOW_FRAMES = 4

/**
 * Reflets : des pixels clairs en quinconce au milieu du cœur (colonnes 2 à 5), qui descendent d'une rangée à
 * chaque image.
 */
export const PORTAL_FLOW: readonly (readonly PortalCell[])[] = Array.from({ length: PORTAL_FLOW_FRAMES }, (_, k) =>
  runs((x, y) => {
    if (x < 2 || x > 5 || !inOval(x, y) || onRim(x, y)) return false
    const phase = (((y - k) % PORTAL_FLOW_FRAMES) + PORTAL_FLOW_FRAMES) % PORTAL_FLOW_FRAMES
    return x % 2 === 0 ? phase === 0 : phase === 2
  }),
)

/** Éclats qui s'échappent du portail (et gerbe de la fermeture). */
export const PORTAL_SPARKS = 4
