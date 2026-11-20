/**
 * L'île (prototype design/prototypes/ile-sordulo-os.html, version Windows) : forme noire collée au bord haut,
 * au centre, qui change de forme selon l'état avec une animation à ressort. Le composant occupe toute la
 * fenêtre transparente ; il ne décide rien (voir IslandProps).
 *
 * Rendu React : couches, textes, boutons. Moteur (engine.ts) + boucle (loop.ts) : forme, éléments partagés,
 * bulle, minuteurs, onde, anneau, écrits directement dans le DOM à chaque image.
 * Jardin (prop `garden`) : il reçoit par GardenEnvContext la scène (taille animée réelle du ressort et images
 * de la boucle), sa visibilité, l'état, la plateforme, la réduction des animations et l'humeur.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { GardenEnvContext, type GardenEnv } from '../garden/context'
import { ACTIVE_PLATFORM, GHOST, sizeKeyFor, type SharedElementId } from '../geometry'
import type { CallService } from '../../../shared/desktop-contract'
import { callToneStyle } from '../brands'
import type { Activity, ClaudeSession } from '../types'
import { BubbleContent } from './BubbleContent'
import { cx } from './cx'
import { IslandEngine, type EngineTarget } from './engine'
import { useLastNonNull, usePrefersReducedMotion } from './hooks'
import styles from './Island.module.css'
import { backgroundRows, islandLabel } from './labels'
import { ActivityLayers } from './layers'
import { createIslandStage, startIslandLoop, type IslandLoop, type LiveData, type LiveElements } from './loop'
import { SharedElements } from './SharedElements'
import { ACTIVITY_NAMES } from './tone'
import type { ActivityOfKind, IslandProps } from './types'

function findActivity<K extends Activity['kind']>(
  kind: K,
  ...candidates: (Activity | null)[]
): ActivityOfKind<K> | null {
  for (const a of candidates) if (a && a.kind === kind) return a as ActivityOfKind<K>
  return null
}

export function Island(props: IslandProps) {
  const {
    snapshot,
    platform = ACTIVE_PLATFORM,
    hover,
    call,
    audioLevels,
    sessions,
    drop,
    hotZone,
    garden,
    reducedMotion,
    onHoverChange,
    onBubbleClick,
    onNotificationAction,
    onNotificationDismiss,
    onAskDecision,
    onCallAccept,
    onCallIgnore,
    onProjectChange,
    onStopRecording,
    onAnswerSession,
    onOpenSession,
    onHitRectsChange,
  } = props

  const prefersReduced = usePrefersReducedMotion()
  const reduced = reducedMotion ?? prefersReduced
  // Le focus clavier ouvre l'île comme le survol : « Arrêter » et « Répondre » restent atteignables au clavier.
  const [focusWithin, setFocusWithin] = useState(false)
  const open = hover || focusWithin
  const { state, withCall, primary, secondary } = snapshot
  const hasGarden = garden !== undefined && garden !== null && garden !== false
  const sessionCount = sessions.length

  const meet = findActivity('meet', primary, secondary)
  const progress = findActivity('progress', primary)
  const bubbleProgress = findActivity('progress', secondary)
  const agentActivity = findActivity('agent', primary, secondary)
  const musicOn = findActivity('music', primary, secondary) !== null
  const agentSession: ClaudeSession | null =
    sessions.find((s) => s.id === agentActivity?.sessionId) ?? sessions[0] ?? null
  const askSession = snapshot.ask ? (sessions.find((s) => s.id === snapshot.ask?.sessionId) ?? null) : null
  const bubbleActivity = useLastNonNull(secondary)
  // Pendant un enregistrement : ce qui tourne aussi, sous l'appel au survol (pas de bulle).
  const meetRows = useMemo(() => backgroundRows(snapshot.background, sessions), [snapshot.background, sessions])

  // Service de l'appel (logo et couleur) : l'enregistrement en cours, sinon la proposition ; gardé le temps
  // du fondu de sortie pour que la couleur ne repasse pas au jaune avant la fin.
  const liveService: CallService | null | undefined = meet ? meet.service : call ? call.service : undefined
  const [keptService, setKeptService] = useState<CallService | null>(null)
  if (liveService !== undefined && liveService !== keptService) setKeptService(liveService)
  const callService = liveService === undefined ? keptService : liveService

  const target: EngineTarget = useMemo(
    () => ({
      key: sizeKeyFor(state, open, withCall),
      platform,
      reduced,
      hasGarden,
      sessionCount,
      meetRows: meetRows.length,
    }),
    [state, open, withCall, platform, reduced, hasGarden, sessionCount, meetRows.length],
  )

  // Éléments du DOM pilotés hors de React
  const rootRef = useRef<HTMLDivElement>(null)
  const islandRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLButtonElement>(null)
  const bubbleSvgRef = useRef<SVGSVGElement>(null)
  const bubblePathRef = useRef<SVGPathElement>(null)
  const bubbleContentRef = useRef<HTMLSpanElement>(null)
  const sharedRef = useRef(new Map<SharedElementId, HTMLElement>())
  const liveRef = useRef<LiveElements>({
    timer: null,
    elapsed: null,
    waveBars: [],
    eqBars: [],
    ring: null,
    bubbleRing: null,
    rowElapsed: new Map(),
  })
  const [stage] = useState(createIslandStage)
  const engineRef = useRef<IslandEngine | null>(null)
  const loopRef = useRef<IslandLoop | null>(null)
  const targetRef = useRef(target)
  const bubbleVisibleRef = useRef(secondary !== null)

  const liveData: LiveData = {
    state,
    withCall,
    reduced,
    callStartedAt: meet?.startedAt ?? null,
    elapsedStartedAt: (state === 'agentAsk' ? askSession : agentSession)?.startedAt ?? null,
    sessions,
    progress,
    bubbleProgress,
    audioLevels,
    onHitRects: onHitRectsChange,
  }
  const liveDataRef = useRef(liveData)

  // Données lues par la boucle à chaque image (après chaque rendu)
  useLayoutEffect(() => {
    liveDataRef.current = liveData
  })

  // Montage : moteur + boucle requestAnimationFrame, arrêtés au démontage
  useLayoutEffect(() => {
    const root = rootRef.current
    const island = islandRef.current
    const svg = svgRef.current
    const path = pathRef.current
    const content = contentRef.current
    const bubble = bubbleRef.current
    const bubbleSvg = bubbleSvgRef.current
    const bubblePath = bubblePathRef.current
    const bubbleContent = bubbleContentRef.current
    if (!root || !island || !svg || !path || !content || !bubble || !bubbleSvg || !bubblePath || !bubbleContent) return
    const engine = new IslandEngine(
      { island, svg, path, content, bubble, bubbleSvg, bubblePath, bubbleContent, shared: sharedRef.current },
      targetRef.current,
    )
    engine.rootWidth = root.clientWidth
    engine.setBubble(bubbleVisibleRef.current)
    engine.render()
    engineRef.current = engine
    stage.setSizeReader(() => engine.size())
    const loop = startIslandLoop(engine, liveRef.current, () => liveDataRef.current, (now, dt) =>
      stage.emit({ now, dt, ...engine.size() }),
    )
    loopRef.current = loop
    let observer: ResizeObserver | null = null
    const onResize = () => {
      engine.rootWidth = root.clientWidth
      loop.requestHitRects()
    }
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(onResize)
      observer.observe(root)
    } else {
      window.addEventListener('resize', onResize)
    }
    return () => {
      loop.stop()
      stage.setSizeReader(null)
      observer?.disconnect()
      window.removeEventListener('resize', onResize)
      engineRef.current = null
      loopRef.current = null
    }
  }, [stage])

  // Contexte du jardin : change avec l'état, le survol, la plateforme, l'humeur, jamais à chaque image
  const gardenVisible = state === 'multi' && !open
  const callOn = meet !== null
  const agentSessionId = agentSession?.id ?? null
  const gardenEnv: GardenEnv = useMemo(
    () => ({
      stage,
      visible: gardenVisible,
      state,
      platform,
      reduced,
      mood: { call: callOn, music: musicOn },
      agentSessionId,
    }),
    [stage, gardenVisible, state, platform, reduced, callOn, musicOn, agentSessionId],
  )

  // Nouvelle cible : état, survol, plateforme, jardin, nombre de sessions
  useLayoutEffect(() => {
    targetRef.current = target
    engineRef.current?.retarget(target)
    loopRef.current?.requestHitRects()
  }, [target])

  // Bulle secondaire
  const bubbleVisible = secondary !== null
  useLayoutEffect(() => {
    bubbleVisibleRef.current = bubbleVisible
    engineRef.current?.setBubble(bubbleVisible)
    loopRef.current?.requestHitRects()
  }, [bubbleVisible])

  // L'icône de la bulle glisse vers l'île quand l'activité secondaire devient principale (prototype : flyGhost)
  const primaryId = primary?.id ?? null
  const secondaryId = secondary?.id ?? null
  const ghostRef = useRef<{ prim: string | null; sec: string | null; nodes: Node[]; timers: number[] }>({
    prim: primaryId,
    sec: secondaryId,
    nodes: [],
    timers: [],
  })
  useLayoutEffect(() => {
    const g = ghostRef.current
    const flies = g.sec !== null && primaryId === g.sec && primaryId !== g.prim
    const engine = engineRef.current
    const root = rootRef.current
    const placement = flies && !reduced && engine ? engine.ghostPlacement() : null
    if (placement && root && g.nodes.length > 0) {
      const ghost = document.createElement('span')
      ghost.className = styles.ghost ?? ''
      ghost.setAttribute('aria-hidden', 'true')
      ghost.style.left = `${placement.left}px`
      ghost.style.width = `${placement.width}px`
      ghost.style.height = `${placement.height}px`
      g.nodes.forEach((n) => ghost.appendChild(n))
      root.appendChild(ghost)
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          ghost.style.transform = `translateX(${placement.dx.toFixed(1)}px) scale(${GHOST.scale})`
          ghost.style.opacity = '0'
        }),
      )
      g.timers.push(raf)
      g.timers.push(window.setTimeout(() => ghost.remove(), GHOST.lifetimeMs))
    }
    g.prim = primaryId
    g.sec = secondaryId
    // Copie du contenu actuel de la bulle : il servira de fantôme si cette activité passe dans l'île.
    g.nodes = Array.from(bubbleContentRef.current?.childNodes ?? [], (n) => n.cloneNode(true))
  }, [primaryId, secondaryId, reduced])
  useLayoutEffect(() => {
    const g = ghostRef.current
    return () => {
      g.timers.forEach((t) => {
        cancelAnimationFrame(t)
        clearTimeout(t)
      })
    }
  }, [])

  // Références posées par les sous-composants (appelées par React au montage, jamais pendant le rendu)
  const registerShared = useCallback((id: SharedElementId, el: HTMLElement | null) => {
    if (el) sharedRef.current.set(id, el)
    else sharedRef.current.delete(id)
    engineRef.current?.markDirty()
  }, [])
  const timerRef = useCallback((el: HTMLElement | null) => {
    liveRef.current.timer = el
  }, [])
  const elapsedRef = useCallback((el: HTMLElement | null) => {
    liveRef.current.elapsed = el
  }, [])
  const waveBarRef = useCallback((i: number, el: HTMLElement | null) => {
    liveRef.current.waveBars[i] = el
  }, [])
  const eqBarRef = useCallback((i: number, el: HTMLElement | null) => {
    liveRef.current.eqBars[i] = el
  }, [])
  const ringRef = useCallback((el: SVGCircleElement | null) => {
    liveRef.current.ring = el
  }, [])
  const bubbleRingRef = useCallback((el: SVGCircleElement | null) => {
    liveRef.current.bubbleRing = el
  }, [])
  const rowElapsedRef = useCallback((sessionId: string, el: HTMLElement | null) => {
    if (el) liveRef.current.rowElapsed.set(sessionId, el)
    else liveRef.current.rowElapsed.delete(sessionId)
  }, [])

  const handleFocus = () => setFocusWithin(true)
  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false)
  }
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    if (state === 'notif' && snapshot.notification) onNotificationDismiss(snapshot.notification)
    else if (state === 'appel') onCallIgnore()
  }

  const base = { current: state, platform, withCall }
  const extra = snapshot.activityCount - 2

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-platform={platform}
      data-hover={open ? 'true' : 'false'}
      data-reduced={reduced ? 'true' : 'false'}
      data-state={state}
      style={callToneStyle(callService)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={islandRef}
        className={styles.island}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
      >
        <svg ref={svgRef} className={styles.shape} aria-hidden="true">
          <path ref={pathRef} className={styles.shapeBody} />
        </svg>
        <div ref={contentRef} className={styles.content}>
          <ActivityLayers
            base={base}
            open={open}
            snapshot={snapshot}
            call={call}
            meet={meet}
            meetRows={meetRows}
            progress={progress}
            agentSession={agentSession}
            sessions={sessions}
            drop={drop}
            hotZone={hotZone}
            refs={{ eqBarRef, ringRef, rowElapsedRef }}
            handlers={{
              onCallAccept,
              onCallIgnore,
              onProjectChange,
              onStopRecording,
              onAskDecision,
              onAnswerSession,
              onOpenSession,
              onNotificationAction,
            }}
          />
          <div className={cx(styles.garden, gardenVisible && styles.on)} aria-hidden="true">
            <GardenEnvContext.Provider value={gardenEnv}>{garden}</GardenEnvContext.Provider>
          </div>
          <SharedElements
            sessions={sessions}
            callService={callService}
            register={registerShared}
            timerRef={timerRef}
            elapsedRef={elapsedRef}
            waveBarRef={waveBarRef}
            agentWorking={agentSession?.status === 'working'}
            reduced={reduced}
          />
        </div>
      </div>
      <button
        ref={bubbleRef}
        type="button"
        className={styles.bubble}
        aria-label={
          bubbleActivity
            ? `Afficher ${ACTIVITY_NAMES[bubbleActivity.kind]} dans l’île${extra > 0 ? `, et ${extra} ${extra > 1 ? 'autres activités' : 'autre activité'}` : ''}`
            : 'Activité secondaire'
        }
        tabIndex={secondary ? 0 : -1}
        onClick={() => {
          if (secondary) onBubbleClick(secondary)
        }}
      >
        <svg ref={bubbleSvgRef} aria-hidden="true">
          <path ref={bubblePathRef} />
        </svg>
        <span ref={bubbleContentRef} className={styles.bubbleContent}>
          <BubbleContent activity={bubbleActivity} ringRef={bubbleRingRef} />
        </span>
        {secondary && extra > 0 && (
          <span className={styles.badge} aria-hidden="true">
            +{extra}
          </span>
        )}
      </button>
      <p className={styles.srOnly} aria-live="polite">
        {islandLabel(snapshot, sessionCount, call?.appName ?? null)}
      </p>
    </div>
  )
}
