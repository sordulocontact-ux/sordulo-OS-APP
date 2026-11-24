/** Un dessin en pixel art (pixelArt.ts) en SVG, pour React (Claude de l'île). */
import type { Ref } from 'react'
import { artClassNames } from './artClasses'
import { rectClass, type PixelArt } from './pixelArt'

const CLS = artClassNames()

export interface PixelArtSvgProps {
  art: PixelArt
  /** Place (et éventuelle animation) de l'accessoire, dans le module de celui qui le dessine. */
  className: string
  ref?: Ref<SVGSVGElement>
}

export function PixelArtSvg({ art, className, ref }: PixelArtSvgProps) {
  return (
    <svg
      ref={ref}
      className={`${CLS.art} ${className}`}
      viewBox={`0 0 ${art.w} ${art.h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {art.rects.map((rect, i) => (
        <rect key={i} x={rect.x} y={rect.y} width={rect.w} height={rect.h} className={rectClass(rect, CLS)} />
      ))}
    </svg>
  )
}
