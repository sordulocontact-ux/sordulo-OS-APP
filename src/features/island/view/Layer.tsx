import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { ISLAND_SIZES, layerSizeKeyFor } from '../geometry'
import type { IslandPlatform, IslandState } from '../types'
import styles from './Island.module.css'
import { cx } from './cx'

export interface LayerProps {
  /** État que cette couche affiche. */
  state: IslandState
  /** État courant de l'île : la couche est visible quand il est égal à `state`. */
  current: IslandState
  platform: IslandPlatform
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
 * Couche de contenu (prototype : .layer / .layer.on) : centrée, à la taille de l'état ouvert, découpée par la
 * forme animée. Une couche masquée est inerte (ni clic ni clavier, ni lecteur d'écran).
 */
export function Layer({ state, current, platform, withCall, open, className, style, role, label, replayKey, children }: LayerProps) {
  const on = current === state
  const size = ISLAND_SIZES[platform][layerSizeKeyFor(state, withCall)]
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
