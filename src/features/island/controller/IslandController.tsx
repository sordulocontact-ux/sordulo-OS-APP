/**
 * Page React de l'île (fenêtre `prompt`, route /desktop/prompt, seulement dans Tauri) : démarre le runtime
 * du contrôleur (./runtime.ts, sources dans ./sources) et rend <Island />.
 *
 * - Connexion et projets viennent de React (AuthProvider, TanStack Query) et sont poussés dans des magasins
 *   lus par les sources.
 * - Survol : desktop://island-pointer (source de vérité, la fenêtre transparente aux clics ne voit pas
 *   toujours la souris) + survol DOM en complément ; focus clavier dans l'île → la notification reste.
 * - Zones cliquables : envoyées à Rust (islandSetHitRects, marge de 24 px pour le glisser-déposer).
 * - Jardin des Claude (`multi` au repos) : <Garden /> avec les vraies sessions, sauf si une source remplit
 *   `view.garden`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FocusEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  islandDragStart,
  islandSetHitRects,
  onIslandDrag,
  onIslandMotion,
  onIslandPlacement,
  onIslandPointer,
  openMainAt,
} from '../../../lib/desktop'
import { queryKeys } from '../../../lib/queryKeys'
import type { IslandDragStart, IslandRect } from '../../../shared/desktop-contract'
import { useAuth } from '../../auth/useAuth'
import { useCurrentMember } from '../../auth/useCurrentMember'
import { syncSession } from '../../desktop/useSessionSync'
import { Garden } from '../garden'
import { useProjects } from '../../projects/useProjects'
import { Island } from '../view'
import { JELLY } from '../geometry'
import type { DragMotionReader, IslandProjectOption } from '../view/types'
import { placeFromPlacement, placeFromSearch, type IslandPlace } from './placement'
import { startIslandRuntime, type IslandRuntime } from './runtime'
import { SIGNED_OUT, type IslandSessionInfo, type IslandSource } from './source'
import { ISLAND_SOURCES } from './sources'
import { createStore } from './store'
import styles from './IslandController.module.css'

/** Marge autour des zones cliquables où un fichier glissé réveille l'île (ticket : 24 px). */
export const DRAG_MARGIN = 24

const NO_PROJECTS: readonly IslandProjectOption[] = []

/** Connexion complète = session Supabase + membre d'une organisation (sinon l'île reste au repos). */
function useIslandSessionInfo(): IslandSessionInfo {
  const { session, loading } = useAuth()
  const { member, organization, isLoading } = useCurrentMember()
  const userId = session?.user.id ?? null
  const memberId = member?.id ?? null
  const organizationId = organization?.id ?? null
  const status = loading || (userId !== null && isLoading) ? 'loading' : memberId ? 'signedIn' : 'signedOut'
  return useMemo(
    () => (status === 'signedOut' ? SIGNED_OUT : { status, userId, memberId, organizationId }),
    [status, userId, memberId, organizationId],
  )
}

function openUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

export function IslandController({ sources = ISLAND_SOURCES }: { sources?: readonly IslandSource[] }) {
  const sessionInfo = useIslandSessionInfo()
  const projectsQuery = useProjects()
  const queryClient = useQueryClient()
  const [stores] = useState(() => ({
    session: createStore<IslandSessionInfo>(sessionInfo),
    projects: createStore<readonly IslandProjectOption[]>(NO_PROJECTS),
    runtime: createStore<IslandRuntime | null>(null),
  }))

  const signedIn = sessionInfo.status === 'signedIn'
  useEffect(() => {
    stores.session.set(sessionInfo)
  }, [stores, sessionInfo])

  // Les projets lus sans connexion sont vides : on les relit à la connexion.
  useEffect(() => {
    if (signedIn) void queryClient.invalidateQueries({ queryKey: queryKeys.projects() })
  }, [signedIn, queryClient])

  const projectsData = projectsQuery.data
  useEffect(() => {
    const list = signedIn && projectsData ? projectsData.map((p) => ({ id: p.id, name: p.name })) : NO_PROJECTS
    stores.projects.set(list)
  }, [stores, signedIn, projectsData])

  // Un runtime par montage (le mode strict de React monte, démonte puis remonte : rien n'est fait deux fois).
  useEffect(() => {
    const runtime = startIslandRuntime({
      sources,
      session: stores.session,
      projects: stores.projects,
      defaultActions: { openMain: (route) => openMainAt({ route }), openUrl },
      refreshSession: () => syncSession(),
    })
    stores.runtime.set(runtime)
    return () => {
      stores.runtime.set(null)
      runtime.dispose()
    }
  }, [stores, sources])

  const runtime = useSyncExternalStore(stores.runtime.subscribe, stores.runtime.get)
  return runtime ? <IslandSurface runtime={runtime} /> : null
}

function IslandSurface({ runtime }: { runtime: IslandRuntime }) {
  const { coordinator } = runtime
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot)
  const view = useSyncExternalStore(runtime.view.subscribe, runtime.view.get)
  const [pointerHover, setPointerHover] = useState(false)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const lastRectsRef = useRef('')
  // Place de départ lue dans l'URL (Rust), puis mise à jour par island-placement (fin d'un glisser, replacement).
  const [place, setPlace] = useState<IslandPlace>(() => placeFromSearch(window.location.search))
  const [dragging, setDragging] = useState(false)
  const draggingRef = useRef(false)
  // Vitesse de la fenêtre (island-motion, ~60 Hz) lue à chaque image par la boucle de l'île, sans rendu React.
  const motionRef = useRef<{ vx: number; vy: number; at: number } | null>(null)
  const dragMotion = useCallback<DragMotionReader>((nowMs) => {
    const m = motionRef.current
    return m && nowMs - m.at < JELLY.staleMs ? m : null
  }, [])

  /** Survol (Rust ou DOM). En sortant, un focus laissé par un clic de souris est rendu : l'île se referme. */
  const applyHover = useCallback((inside: boolean) => {
    // Pendant le glisser, l'île reste fermée : le survol est ignoré.
    if (inside && draggingRef.current) return
    setPointerHover(inside)
    if (inside) return
    const active = document.activeElement
    if (active instanceof HTMLElement && surfaceRef.current?.contains(active) && !active.matches(':focus-visible')) {
      active.blur()
    }
  }, [])

  useEffect(() => {
    let active = true
    let off: (() => void) | null = null
    onIslandPointer((pointer) => {
      if (active) applyHover(pointer.inside)
    })
      .then((unlisten) => {
        if (active) off = unlisten
        else unlisten()
      })
      .catch((e: unknown) => console.warn('[île] survol :', e))
    return () => {
      active = false
      off?.()
    }
  }, [applyHover])

  useEffect(() => {
    let active = true
    const offs: Array<() => void> = []
    const keep = (promise: Promise<() => void>, label: string) => {
      promise
        .then((unlisten) => {
          if (active) offs.push(unlisten)
          else unlisten()
        })
        .catch((e: unknown) => console.warn(`[île] ${label} :`, e))
    }
    keep(
      onIslandPlacement((placement) => {
        if (active) setPlace(placeFromPlacement(placement))
      }),
      'place',
    )
    keep(
      onIslandDrag((drag) => {
        if (!active) return
        const started = drag.phase === 'start'
        draggingRef.current = started
        setDragging(started)
        // Fin : la goutte se pose, plus de vitesse (elle s'écrase en arrivant).
        if (!started) motionRef.current = null
        if (started) applyHover(false)
      }),
      'glisser',
    )
    keep(
      onIslandMotion((motion) => {
        if (active) motionRef.current = { vx: motion.vx, vy: motion.vy, at: performance.now() }
      }),
      'vitesse du glisser',
    )
    return () => {
      active = false
      draggingRef.current = false
      offs.forEach((off) => off())
    }
  }, [applyHover])

  const onDragStart = useCallback((size: IslandDragStart) => {
    islandDragStart(size).catch((e: unknown) => console.warn('[île] glisser :', e))
  }, [])

  const hover = pointerHover && !dragging

  // Survol ou focus clavier : la notification affichée reste (temps mis en pause).
  useEffect(() => {
    coordinator.setHover(hover || (keyboardFocus && !dragging))
  }, [coordinator, hover, keyboardFocus, dragging])

  const onHitRectsChange = useCallback((rects: IslandRect[]) => {
    const key = JSON.stringify(rects)
    if (key === lastRectsRef.current) return
    lastRectsRef.current = key
    islandSetHitRects({ rects, dragMargin: DRAG_MARGIN }).catch((e: unknown) => console.warn('[île] zones :', e))
  }, [])

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    setKeyboardFocus(e.target instanceof HTMLElement && e.target.matches(':focus-visible'))
  }
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocus(false)
  }

  return (
    <div ref={surfaceRef} className={styles.surface} onFocus={onFocus} onBlur={onBlur}>
      <Island
        snapshot={snapshot}
        platform={place.platform}
        edge={place.edge}
        dragging={dragging}
        dragMotion={dragMotion}
        hover={hover}
        call={view.call}
        audioLevels={view.audioLevels}
        sessions={view.sessions}
        drop={view.drop}
        hotZone={view.hotZone}
        music={view.music}
        musicLevels={view.musicLevels}
        garden={view.garden ?? <Garden sessions={view.sessions} />}
        onHoverChange={applyHover}
        onBubbleClick={() => coordinator.pinSecondary()}
        onNotificationAction={runtime.runAction}
        onNotificationDismiss={(notification) => coordinator.endNotification(notification.id)}
        onAskDecision={runtime.gestures.onAskDecision}
        onCallAccept={runtime.gestures.onCallAccept}
        onCallIgnore={runtime.gestures.onCallIgnore}
        onProjectChange={runtime.gestures.onProjectChange}
        onStopRecording={runtime.gestures.onStopRecording}
        onAnswerSession={runtime.gestures.onAnswerSession}
        onOpenSession={runtime.gestures.onOpenSession}
        onMusicCommand={runtime.gestures.onMusicCommand}
        onDragStart={onDragStart}
        onHitRectsChange={onHitRectsChange}
      />
    </div>
  )
}
