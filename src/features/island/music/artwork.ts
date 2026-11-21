/**
 * Pochette côté navigateur : type d'image deviné par la signature des octets, et couleurs tirées d'une URL
 * (blob:) par un petit canvas. Le calcul des couleurs est pur et testé à part (./palette.ts) ; cet adaptateur
 * est injecté dans la source « musique » (controller/sources/music.ts), qui le remplace par un faux en test.
 */
import type { MusicPalette } from '../types'
import { paletteFromPixels } from './palette'

/** Côté du canvas d'échantillonnage : assez pour les couleurs dominantes, très peu de pixels à lire. */
export const ARTWORK_SAMPLE_SIZE = 32

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, i) => bytes[i] === value)
}

/** Type MIME d'une pochette (PNG ou JPEG) d'après ses premiers octets ; '' si inconnu (le navigateur devine). */
export function imageMimeType(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4))
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png'
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg'
  return ''
}

/** Couleurs d'une image (URL blob: de la pochette) : dessinée en petit dans un canvas, puis paletteFromPixels. */
export async function paletteFromImageUrl(url: string): Promise<MusicPalette | null> {
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = ARTWORK_SAMPLE_SIZE
  canvas.height = ARTWORK_SAMPLE_SIZE
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, ARTWORK_SAMPLE_SIZE, ARTWORK_SAMPLE_SIZE)
  const { data } = context.getImageData(0, 0, ARTWORK_SAMPLE_SIZE, ARTWORK_SAMPLE_SIZE)
  return paletteFromPixels(data, ARTWORK_SAMPLE_SIZE, ARTWORK_SAMPLE_SIZE)
}
