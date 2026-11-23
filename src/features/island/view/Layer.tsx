import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { DEFAULT_EDGE, ISLAND_SIZES, edgePlatform, isVerticalLayout, layerSizeKeyFor } from '../geometry'
import type { IslandEdge, IslandPlatform, IslandState } from '../types'
import styles from './Island.module.css'
import { cx } from './cx'

export interface LayerProps {
  /** État que cette couche affiche. */
  state: IslandState
  /** État courant de l'île : la couche est visible quand il est égal à `state`. */
  current: IslandState
  platform: IslandPlatform
  /** Bord de l'écran ('top' par défaut) : sur les côtés, une couche compacte est transposée (pilule verticale). */
  edge?: IslandEdge
  withCall: boolean
  /** Détail ouvert (survol) : agent, meet, multi. */
  open?: boolean
  className?: string
  style?: CSSProperties
  role?: 'dialog' | 'region'
  label?: string
  /** Quand cette clé change alors que la couche est déjà visible, le fondu d'entrée est rejoué. */
  replayKey?: string | null
  children?: ReactNode
}

/**
 * Couche de contenu (prototype : .layer / .layer.on) : à la taille de l'état ouvert, découpée par la forme
 * animée, collée au bord de l'écran et centrée le long de lui (Island.module.css, data-edge). Sur les côtés,
 * une couche d'état compact (progression, dragWake) prend la taille transposée de la pilule verticale.
 * Une couche masquée est inerte (ni clic ni clavier, ni lecteur d'écran).
 */
export function Layer({
  state,
  current,
  platform,
  edge = DEFAULT_EDGE,
  withCall,
  open,
  className,
  style,
  role,
  label,
  replayKey,
  children,
}: LayerProps) {
  const on = current === state
  const key = layerSizeKeyFor(state, withCall)
  const box = ISLAND_SIZES[edgePlatform(platform, edge)][key]
  const size = isVerticalLayout(edge, key) ? { w: box.h, h: box.w } : box
  const ref = useRef<HTMLDivElement>(null)
  const prev = useRef({ key: replayKey, on })

  useLayoutEffect(() => {
    const p = prev.current
    prev.current = { key: replayKey, on }
    const el = ref.current
    const onClass = styles.on
    if (!el || !onClass || p.key === replayKey || !p.on || !on) return
    // Comme le prototype : retirer .on, forcer le calcul, remettre .on.
    el.classList.remove(onClass)
    el.getBoundingClientRect()
    el.classList.add(onClass)
  })

  return (
    <div
      ref={ref}
      className={cx(styles.layer, on && styles.on, open && styles.open, className)}
      style={{ width: size.w, height: size.h, ...style }}
      inert={!on}
      role={role}
      aria-label={label}
    >
      {children}
    </div>
  )
}
