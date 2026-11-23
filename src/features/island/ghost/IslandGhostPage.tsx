/**
 * Fenêtre d'aperçu de l'île (route /desktop/ile-apercu, seulement dans Tauri) : transparente, elle ignore la
 * souris et montre pendant un glisser où l'île se poserait (événement island-ghost, null = rien).
 */
import { useEffect, useLayoutEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { isDesktop, onIslandGhost } from '../../../lib/desktop'
import { ISLAND_WINDOW_SIZE, type IslandGhost } from '../../../shared/desktop-contract'
import { islandOutline } from '../geometry'
import styles from './IslandGhostPage.module.css'

/** Taille de la fenêtre d'aperçu : celle de la fenêtre de l'île au bord visé. */
function rootSize(edge: IslandGhost['edge']): { width: number; height: number } {
  const size = edge === 'left' || edge === 'right' ? ISLAND_WINDOW_SIZE.vertical : ISLAND_WINDOW_SIZE.horizontal
  const width = window.innerWidth > 0 ? window.innerWidth : size.width
  const height = window.innerHeight > 0 ? window.innerHeight : size.height
  return { width, height }
}

/** Rend le document transparent tant que la route est affichée. */
function useTransparentWindow(): void {
  useLayoutEffect(() => {
    const windowClass = styles.ghostWindow
    if (!windowClass) return
    const html = document.documentElement
    html.classList.add(windowClass)
    return () => html.classList.remove(windowClass)
  }, [])
}

export function IslandGhostView({ ghost }: { ghost: IslandGhost | null }) {
  if (!ghost) return null
  const root = rootSize(ghost.edge)
  const outline = islandOutline({
    edge: ghost.edge,
    along: ghost.along,
    depth: ghost.depth,
    root,
    platform: ghost.notch ? 'mac' : 'win',
  })
  return (
    <svg
      key={`${ghost.edge}-${ghost.notch}`}
      className={styles.outline}
      style={{ left: outline.x, top: outline.y }}
      width={outline.width}
      height={outline.height}
      viewBox={`0 0 ${outline.width} ${outline.height}`}
      aria-hidden="true"
    >
      <path d={outline.d} className={styles.path} />
    </svg>
  )
}

function IslandGhostWindow() {
  useTransparentWindow()
  const [ghost, setGhost] = useState<IslandGhost | null>(null)

  useEffect(() => {
    let active = true
    let off: (() => void) | null = null
    onIslandGhost((next) => {
      if (active) setGhost(next)
    })
      .then((unlisten) => {
        if (active) off = unlisten
        else unlisten()
      })
      .catch((e: unknown) => console.warn('[île] aperçu :', e))
    return () => {
      active = false
      off?.()
    }
  }, [])

  return <IslandGhostView ghost={ghost} />
}

/** /desktop/ile-apercu : seulement dans Tauri, sans garde d'authentification. */
export function IslandGhostRoute() {
  if (!isDesktop()) return <Navigate to="/" replace />
  return <IslandGhostWindow />
}
