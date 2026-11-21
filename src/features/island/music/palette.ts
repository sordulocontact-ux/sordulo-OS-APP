/**
 * Couleurs de la pochette pour le dégradé de l'île (barres, pochette de repli). Pur : aucun DOM, les pixels
 * viennent de ./artwork.ts (canvas) dans l'app et de tableaux écrits à la main dans les tests.
 *
 * Méthode
 * - On écarte les pixels transparents, quasi noirs, quasi blancs et gris (peu de chroma) : ils ne disent
 *   rien de la couleur de la pochette et l'île est déjà noire.
 * - Quantification simple par teinte (24 secteurs de 15°). Chaque secteur cumule la chroma de ses pixels
 *   (une couleur vive pèse plus qu'une couleur terne) et leur couleur moyenne pondérée par cette chroma.
 * - Première couleur : le secteur le plus lourd. Seconde : le plus lourd dont la teinte s'écarte d'au moins
 *   MIN_HUE_GAP de la première et qui pèse assez (MIN_SECOND_SHARE) ; sinon une variante plus claire de la
 *   première.
 * - Lisibilité sur le fond noir : saturation relevée jusqu'à MIN_SATURATION et luminosité jusqu'à un
 *   contraste MIN_CONTRAST avec le noir, au minimum nécessaire (une couleur déjà lisible ne bouge pas).
 * - Pochette toute grise, noire ou blanche (moins de MIN_COLORFUL_SHARE de pixels colorés) : null, le rendu
 *   garde les tokens --island-music* par défaut.
 */
import type { MusicPalette } from '../types'

/** Pixel ignoré sous cette opacité (0 à 255). */
export const MIN_ALPHA = 128
/** Pixel quasi noir : composante la plus forte sous ce seuil (0 à 1). */
export const BLACK_MAX = 0.15
/** Pixel quasi blanc : composante la plus faible au-dessus de ce seuil (0 à 1). */
export const WHITE_MIN = 0.9
/** Pixel gris : chroma (plus forte moins plus faible composante, 0 à 1) sous ce seuil. */
export const GREY_CHROMA = 0.12
/** Part minimale de pixels colorés parmi les pixels opaques pour tirer des couleurs. */
export const MIN_COLORFUL_SHARE = 0.02
/** Nombre de secteurs de teinte. */
export const HUE_BINS = 24
/** Écart de teinte minimal entre les deux couleurs, en degrés. */
export const MIN_HUE_GAP = 30
/** Poids minimal de la seconde couleur, en part du poids coloré total. */
export const MIN_SECOND_SHARE = 0.06
/** Saturation HSL minimale des couleurs rendues (0 à 1). */
export const MIN_SATURATION = 0.45
/** Contraste minimal (WCAG) des couleurs rendues avec le noir. */
export const MIN_CONTRAST = 4.5
/** Luminosité HSL ajoutée pour la variante claire, quand la pochette n'a qu'une couleur. */
export const LIGHTER_STEP = 0.15
/** Luminosité HSL maximale des couleurs rendues : au-delà, la couleur tourne au blanc. */
export const MAX_LIGHTNESS = 0.9

interface Rgb {
  r: number
  g: number
  b: number
}

interface Hsl {
  /** Degrés, 0 à 360. */
  h: number
  s: number
  l: number
}

interface Bin {
  weight: number
  r: number
  g: number
  b: number
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return { r: rgb[0] + m, g: rgb[1] + m, b: rgb[2] + m }
}

function channelLuminance(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/** Luminance relative WCAG (0 à 1). */
function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

/** Contraste WCAG d'une couleur avec le noir (1 à 21). */
export function contrastOnBlack(color: Rgb): number {
  return (luminance(color) + 0.05) / 0.05
}

function hueGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % 360
  return gap > 180 ? 360 - gap : gap
}

/** Saturation puis luminosité relevées au minimum pour rester lisible sur le noir de l'île. */
function readable(hsl: Hsl): Hsl {
  const s = Math.max(hsl.s, MIN_SATURATION)
  const start = { h: hsl.h, s, l: hsl.l }
  if (contrastOnBlack(hslToRgb(start)) >= MIN_CONTRAST || hsl.l >= MAX_LIGHTNESS) return start
  // Recherche par dichotomie de la plus petite luminosité qui atteint le contraste voulu.
  let low = hsl.l
  let high = MAX_LIGHTNESS
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2
    if (contrastOnBlack(hslToRgb({ h: hsl.h, s, l: mid })) >= MIN_CONTRAST) high = mid
    else low = mid
  }
  return { h: hsl.h, s, l: high }
}

function toCss(hsl: Hsl): string {
  const { r, g, b } = hslToRgb(hsl)
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255)
  return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`
}

function binColor(bin: Bin): Hsl {
  return rgbToHsl({ r: bin.r / bin.weight, g: bin.g / bin.weight, b: bin.b / bin.weight })
}

/**
 * Deux couleurs vives et représentatives d'une image (pixels RGBA, comme ImageData.data) pour un dégradé
 * lisible sur fond noir ; null si l'image n'a pas de couleur (grise, noire, blanche, transparente).
 */
export function paletteFromPixels(data: Uint8ClampedArray, width: number, height: number): MusicPalette | null {
  const count = Math.min(Math.max(0, Math.floor(width) * Math.floor(height)), Math.floor(data.length / 4))
  const bins: Bin[] = Array.from({ length: HUE_BINS }, () => ({ weight: 0, r: 0, g: 0, b: 0 }))
  let opaque = 0
  let colorful = 0
  let totalWeight = 0

  for (let i = 0; i < count; i++) {
    const o = i * 4
    if ((data[o + 3] ?? 0) < MIN_ALPHA) continue
    opaque++
    const color = { r: (data[o] ?? 0) / 255, g: (data[o + 1] ?? 0) / 255, b: (data[o + 2] ?? 0) / 255 }
    const max = Math.max(color.r, color.g, color.b)
    const min = Math.min(color.r, color.g, color.b)
    const chroma = max - min
    if (max < BLACK_MAX || min > WHITE_MIN || chroma < GREY_CHROMA) continue
    colorful++
    const { h } = rgbToHsl(color)
    const bin = bins[Math.floor(h / (360 / HUE_BINS)) % HUE_BINS]
    if (!bin) continue
    bin.weight += chroma
    bin.r += color.r * chroma
    bin.g += color.g * chroma
    bin.b += color.b * chroma
    totalWeight += chroma
  }

  if (colorful === 0 || colorful < opaque * MIN_COLORFUL_SHARE) return null

  const ranked = bins.filter((bin) => bin.weight > 0).sort((a, b) => b.weight - a.weight)
  const top = ranked[0]
  if (!top) return null
  const first = binColor(top)
  const runnerUp = ranked.find(
    (bin) => bin.weight >= totalWeight * MIN_SECOND_SHARE && hueGap(binColor(bin).h, first.h) >= MIN_HUE_GAP,
  )

  const start = readable(first)
  const end = runnerUp
    ? readable(binColor(runnerUp))
    : readable({ ...start, l: Math.min(MAX_LIGHTNESS, start.l + LIGHTER_STEP) })
  return { start: toCss(start), end: toCss(end) }
}
