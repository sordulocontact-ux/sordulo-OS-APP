import { describe, expect, it } from 'vitest'
import { imageMimeType } from './artwork'
import { contrastOnBlack, MIN_CONTRAST, MIN_HUE_GAP, MUSIC_COLORS, paletteFromPixels } from './palette'

type Rgba = [number, number, number, number?]

const SIZE = 16

/** Image SIZE × SIZE : chaque couleur occupe une part des pixels (dans l'ordre, le reste prend la dernière). */
function image(...parts: [Rgba, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  const total = SIZE * SIZE
  let pixel = 0
  parts.forEach(([color, share], index) => {
    const end = index === parts.length - 1 ? total : Math.min(total, pixel + Math.round(share * total))
    for (; pixel < end; pixel++) {
      data.set([color[0], color[1], color[2], color[3] ?? 255], pixel * 4)
    }
  })
  return data
}

function parse(css: string): { r: number; g: number; b: number } {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(css)
  if (!match) throw new Error(`couleur inattendue : ${css}`)
  return { r: Number(match[1]) / 255, g: Number(match[2]) / 255, b: Number(match[3]) / 255 }
}

function hue(css: string): number {
  const { r, g, b } = parse(css)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return h < 0 ? h + 360 : h
}

function lightness(css: string): number {
  const { r, g, b } = parse(css)
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2
}

function saturation(css: string): number {
  const { r, g, b } = parse(css)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
}

const rgbCss = ({ r, g, b }: { r: number; g: number; b: number }) =>
  `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`

const isWarm = (css: string) => {
  const h = hue(css)
  return h <= 60 || h >= 330
}

describe('paletteFromPixels', () => {
  it('pochette rouge et orange : deux couleurs chaudes', () => {
    const palette = paletteFromPixels(image([[200, 30, 20], 0.5], [[240, 140, 20], 0.5]), SIZE, SIZE)
    expect(palette).not.toBeNull()
    expect(isWarm(palette!.start)).toBe(true)
    expect(isWarm(palette!.end)).toBe(true)
    expect(palette!.start).not.toBe(palette!.end)
  })

  it('pochette noire, grise ou blanche : dégradé gris lisible, pas l’orange par défaut', () => {
    for (const data of [
      image([[0, 0, 0], 1]),
      image([[10, 12, 8], 0.5], [[25, 20, 30], 0.5]),
      image([[128, 128, 128], 0.5], [[90, 95, 100], 0.5]),
      image([[250, 250, 252], 1]),
      // Photo en noir et blanc : surtout du noir, un visage gris
      image([[5, 5, 5], 0.7], [[120, 120, 120], 0.2], [[200, 200, 200], 0.1]),
    ]) {
      const palette = paletteFromPixels(data, SIZE, SIZE)
      expect(palette).not.toBeNull()
      for (const css of [palette!.start, palette!.end]) {
        expect(saturation(css)).toBeLessThan(0.15)
        expect(contrastOnBlack(parse(css))).toBeGreaterThanOrEqual(MIN_CONTRAST - 0.05)
      }
      expect(lightness(palette!.end)).toBeGreaterThan(lightness(palette!.start))
    }
  })

  it('image vide ou transparente : null (tokens par défaut)', () => {
    expect(paletteFromPixels(image([[220, 20, 20, 0], 1]), SIZE, SIZE)).toBeNull()
    expect(paletteFromPixels(new Uint8ClampedArray(0), 0, 0)).toBeNull()
  })

  it('couleur terne de la pochette : gardée terne (saturation jamais relevée)', () => {
    // Peau brune en majorité, petit texte rouge : brun, pas orange vif ; le rouge marginal ne prend pas la fin.
    const brown = { r: 150 / 255, g: 105 / 255, b: 85 / 255 }
    const palette = paletteFromPixels(image([[150, 105, 85], 0.85], [[220, 30, 40], 0.08], [[0, 0, 0], 0.07]), SIZE, SIZE)
    expect(palette).not.toBeNull()
    expect(saturation(palette!.start)).toBeCloseTo(saturation(rgbCss(brown)), 1)
    expect(Math.abs(hue(palette!.start) - hue(rgbCss(brown)))).toBeLessThan(5)
    expect(Math.abs(hue(palette!.end) - hue(palette!.start))).toBeLessThan(5)
  })

  it('deux couleurs dominantes bien distinctes : deux couleurs différentes, dans l’ordre du poids', () => {
    const palette = paletteFromPixels(image([[30, 60, 220], 0.6], [[240, 210, 30], 0.4]), SIZE, SIZE)
    expect(palette).not.toBeNull()
    const start = hue(palette!.start)
    const end = hue(palette!.end)
    expect(start).toBeGreaterThan(200)
    expect(start).toBeLessThan(250)
    expect(end).toBeGreaterThan(40)
    expect(end).toBeLessThan(65)
    const gap = Math.min(Math.abs(start - end), 360 - Math.abs(start - end))
    expect(gap).toBeGreaterThanOrEqual(MIN_HUE_GAP)
  })

  it('une seule couleur : la seconde est une variante plus claire de la première', () => {
    const palette = paletteFromPixels(image([[20, 140, 60], 1]), SIZE, SIZE)
    expect(palette).not.toBeNull()
    expect(palette!.start).not.toBe(palette!.end)
    expect(Math.abs(hue(palette!.start) - hue(palette!.end))).toBeLessThan(3)
    expect(lightness(palette!.end)).toBeGreaterThan(lightness(palette!.start))
  })

  it('le noir, le gris et le blanc ne comptent pas, même en majorité', () => {
    const palette = paletteFromPixels(
      image([[0, 0, 0], 0.5], [[128, 128, 128], 0.2], [[255, 255, 255], 0.2], [[220, 30, 40], 0.1]),
      SIZE,
      SIZE,
    )
    expect(palette).not.toBeNull()
    expect(isWarm(palette!.start)).toBe(true)
  })

  it('une couleur marginale ne devient pas la seconde couleur', () => {
    const palette = paletteFromPixels(image([[230, 40, 40], 0.98], [[40, 80, 230], 0.02]), SIZE, SIZE)
    expect(palette).not.toBeNull()
    expect(isWarm(palette!.end)).toBe(true)
  })

  it('couleurs sombres ou ternes : relevées pour rester lisibles sur le noir', () => {
    const dark = image([[90, 10, 10], 0.5], [[10, 10, 110], 0.5])
    const palette = paletteFromPixels(dark, SIZE, SIZE)
    expect(palette).not.toBeNull()
    for (const css of [palette!.start, palette!.end]) {
      // Arrondi à l'entier : une petite marge sous le seuil.
      expect(contrastOnBlack(parse(css))).toBeGreaterThanOrEqual(MIN_CONTRAST - 0.05)
    }
    // Teintes gardées (rouge et bleu).
    expect([palette!.start, palette!.end].map(isWarm).sort()).toEqual([false, true])
  })

  it('couleur déjà lisible et vive : gardée telle quelle', () => {
    const palette = paletteFromPixels(image([[255, 200, 0], 1]), SIZE, SIZE)
    expect(palette?.start).toBe('rgb(255, 200, 0)')
  })
})

describe('paletteFromPixels : couleurs de l’égaliseur', () => {
  it('quatre couleurs bien distinctes : les quatre, de la plus présente à la moins présente', () => {
    const palette = paletteFromPixels(
      image([[30, 60, 220], 0.4], [[240, 210, 30], 0.3], [[220, 40, 40], 0.2], [[40, 200, 90], 0.1]),
      SIZE,
      SIZE,
    )
    expect(palette?.colors).toHaveLength(MUSIC_COLORS)
    const colors = palette?.colors ?? []
    expect(colors[0]).toBe(palette?.start)
    expect(colors[1]).toBe(palette?.end)
    const hues = colors.map(hue)
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const gap = Math.abs((hues[i] ?? 0) - (hues[j] ?? 0))
        expect(Math.min(gap, 360 - gap)).toBeGreaterThanOrEqual(MIN_HUE_GAP)
      }
    }
  })

  it('seulement les vraies couleurs : une couleur marginale n’entre pas, rien n’est inventé', () => {
    const palette = paletteFromPixels(image([[30, 60, 220], 0.97], [[240, 210, 30], 0.03]), SIZE, SIZE)
    expect(palette?.colors).toHaveLength(1)
    expect(palette?.colors?.[0]).toBe(palette?.start)
    const two = paletteFromPixels(image([[30, 60, 220], 0.6], [[240, 210, 30], 0.4]), SIZE, SIZE)
    expect(two?.colors).toEqual([two?.start, two?.end])
  })

  it('pochette sans couleur : une seule couleur, son gris', () => {
    const palette = paletteFromPixels(image([[128, 128, 128], 1]), SIZE, SIZE)
    expect(palette?.colors).toEqual([palette?.start])
  })
})

describe('imageMimeType', () => {
  it('reconnaît PNG et JPEG, sinon laisse le navigateur deviner', () => {
    expect(imageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]).buffer)).toBe('image/png')
    expect(imageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]).buffer)).toBe('image/jpeg')
    expect(imageMimeType(new Uint8Array([0x47, 0x49, 0x46]).buffer)).toBe('')
    expect(imageMimeType(new ArrayBuffer(0))).toBe('')
  })
})
