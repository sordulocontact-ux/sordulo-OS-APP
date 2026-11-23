/**
 * Détection du glisser de l'île : appui du bouton gauche sur la forme, puis déplacement au-delà de
 * DRAG_THRESHOLD_PX avec le bouton toujours enfoncé → `onDragStart` (une fois par appui). L'app de bureau
 * prend alors la main (la fenêtre suit le curseur). Le clic qui suit un glisser est annulé (phase de capture) ;
 * un appui sans déplacement reste un clic normal.
 *
 * Pointer events seulement : le glisser-déposer de fichiers (événements HTML5 drag) n'est pas touché. Le
 * glisser natif des images de l'île (dragstart) est empêché sur la forme, sinon il couperait les pointer events.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { IslandDragStart } from '../../../shared/desktop-contract'
import { isDragMove } from '../geometry'

/** Appuis qui ne lancent pas de glisser : champs, listes déroulantes (barre de défilement comprise). */
const NO_DRAG_SELECTOR = 'input, textarea, select, [role="listbox"]'

interface Press {
  id: number
  x: number
  y: number
  fired: boolean
}

export interface IslandDragHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  /** dragstart HTML5 venu du contenu de l'île (image) : empêché. */
  onNativeDragStart: (e: DragEvent<HTMLElement>) => void
}

/**
 * `onDragStart` absent : aucun glisser (les appuis restent de simples clics). `readSize` : taille cible
 * actuelle dans le repère du bord, lue au moment où le seuil est franchi.
 */
export function useIslandDrag(
  onDragStart: ((size: IslandDragStart) => void) | undefined,
  readSize: () => IslandDragStart | null,
): IslandDragHandlers {
  const pressRef = useRef<Press | null>(null)
  const suppressRef = useRef(false)
  const latest = useRef({ onDragStart, readSize })
  useLayoutEffect(() => {
    latest.current = { onDragStart, readSize }
  })

  useEffect(() => {
    let clearTimer = 0
    const onMove = (e: PointerEvent) => {
      const press = pressRef.current
      if (!press || press.fired || e.pointerId !== press.id) return
      if ((e.buttons & 1) === 0) {
        pressRef.current = null
        return
      }
      if (!isDragMove(e.clientX - press.x, e.clientY - press.y)) return
      const { onDragStart: start, readSize: read } = latest.current
      const size = start ? read() : null
      if (!start || !size) {
        pressRef.current = null
        return
      }
      press.fired = true
      suppressRef.current = true
      start(size)
    }
    const onUp = (e: PointerEvent) => {
      const press = pressRef.current
      if (!press || e.pointerId !== press.id) return
      pressRef.current = null
      // Le clic éventuel arrive juste après le relâchement, dans la même tâche : on l'annule, puis plus rien.
      if (press.fired) {
        window.clearTimeout(clearTimer)
        clearTimer = window.setTimeout(() => {
          suppressRef.current = false
        }, 0)
      }
    }
    const onClick = (e: MouseEvent) => {
      if (!suppressRef.current) return
      suppressRef.current = false
      e.preventDefault()
      e.stopPropagation()
    }
    // Un clic au clavier (Entrée, Espace) n'est jamais celui d'un glisser.
    const onKey = () => {
      suppressRef.current = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.clearTimeout(clearTimer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    suppressRef.current = false
    const target = e.target instanceof Element ? e.target : null
    if (e.button !== 0 || !e.isPrimary || !latest.current.onDragStart || target?.closest(NO_DRAG_SELECTOR)) {
      pressRef.current = null
      return
    }
    pressRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, fired: false }
  }, [])

  const onNativeDragStart = useCallback((e: DragEvent<HTMLElement>) => {
    e.preventDefault()
  }, [])

  return { onPointerDown, onNativeDragStart }
}
