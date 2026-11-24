/**
 * L'île (prototype design/prototypes/ile-sordulo-os.html, version Windows) : forme noire collée au milieu d'un
 * bord de l'écran (prop `edge`, en haut par défaut), qui change de forme selon l'état avec une animation à
 * ressort. En bas : miroir. À gauche et à droite : pilule verticale au repos, carte horizontale ouverte. Le composant occupe toute la
 * fenêtre transparente ; il ne décide rien (voir IslandProps).
 *
 * Rendu React : couches, textes, boutons. Moteur (engine.ts) + boucle (loop.ts) : forme, éléments partagés,
 * bulle, minuteurs, onde, anneau, écrits directement dans le DOM à chaque image.
 * Jardin (prop `garden`) : il reçoit par GardenEnvContext la scène (taille animée réelle du ressort et images
 * de la boucle), sa visibilité, l'état, la plateforme, la réduction des animations, l'humeur et le lecteur du
 * vrai son (`musicLevels`, stable : lu à chaque image, jamais de rendu React par analyse).
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { GardenEnvContext, type GardenEnv } from '../garden/context'
import {
  ACTIVE_PLATFORM,
  DEFAULT_EDGE,
  GHOST,
  edgePlatform,
  isVerticalLayout,
  progressShowsName,
  sizeKeyFor,
  type SharedElementId,
} from '../geometry'
import type { CallService } from '../../../shared/desktop-contract'
import { callToneStyle } from '../brands'
import type { Activity, ClaudeSession, IslandSizeKey } from '../types'
import { BubbleContent } from './BubbleContent'
import { cx } from './cx'
import { useIslandDrag } from './drag'
import { IslandEngine, type EngineTarget } from './engine'
import { useLastNonNull, usePrefersReducedMotion } from './hooks'
import styles from './Island.module.css'
import { backgroundRows, islandLabel, type BackgroundRow } from './labels'
import { ActivityLayers } from './layers'
import { createIslandStage, startIslandLoop, type IslandLoop, type LiveData, type LiveElements } from './loop'
import { musicHasProgress, musicStyle } from './music'
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
    platform: platformProp = ACTIVE_PLATFORM,
    edge = DEFAULT_EDGE,
    dragging = false,
    onDragStart,
    dragMotion,
    hover,
    call,
    audioLevels,
    sessions,
    drop,
    hotZone,
    music: musicProp,
    musicLevels,
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
    onMusicCommand,
    onHitRectsChange,
  } = props
  const music = musicProp ?? null
  // Variante dessinée : l'encoche n'existe qu'en haut ('win' ailleurs, même sur Mac).
  const platform = edgePlatform(platformProp, edge)

  const prefersReduced = usePrefersReducedMotion()
  const reduced = reducedMotion ?? prefersReduced
  // Le focus clavier ouvre l'île comme le survol : « Arrêter » et « Répondre » restent atteignables au clavier.
  const [focusWithin, setFocusWithin] = useState(false)
  // Glisser en cours : toujours fermée.
  const open = !dragging && (hover || focusWithin)
  const { state, withCall, primary, secondary } = snapshot
  // Liste « aussi en cours » dépliée (clic sur « N autres activités ») : pour cet état et cette activité
  // principale, tant que l'île reste ouverte. Elle se replie à la fermeture ou quand la principale change.
  const expandKey = `${state}:${primary?.id ?? ''}`
  const [expandedFor, setExpandedFor] = useState<string | null>(null)
  if (expandedFor !== null && (!open || expandedFor !== expandKey)) setExpandedFor(null)
  const rowsExpanded = open && expandedFor === expandKey
  const hasGarden = garden !== undefined && garden !== null && garden !== false
  const sessionCount = sessions.length

  const meet = findActivity('meet', primary, secondary)
  const progress = findActivity('progress', primary)
  // Gardée pendant le fondu de sortie des éléments partagés (icône, libellé fermé)
  const shownProgress = useLastNonNull(progress)
  const bubbleProgress = findActivity('progress', secondary)
  // Déploiement : l'île fermée montre le nom du projet (sur Mac, elle s'élargit de part et d'autre de l'encoche).
  const progressNamed = progressShowsName(progress)
  const agentActivity = findActivity('agent', primary, secondary)
  const musicOn =
    findActivity('music', primary, secondary) !== null || snapshot.background.some((a) => a.kind === 'music')
  // Musique + sessions Claude : une seule île, les Claude marchent sous la musique (jamais de bulle).
  const musicGarden =
    state === 'music' && hasGarden && snapshot.background.some((a) => a.kind === 'agent' || a.kind === 'multi')
  // Les Claude du jardin ne dansent qu'en lecture (sans données : comme en lecture).
  const musicPlaying = musicOn && music?.playing !== false
  const musicProgress = musicHasProgress(music)
  const musicControls = music?.canControl !== false
  const agentSession: ClaudeSession | null =
    sessions.find((s) => s.id === agentActivity?.sessionId) ?? sessions[0] ?? null
  const askSession = snapshot.ask ? (sessions.find((s) => s.id === snapshot.ask?.sessionId) ?? null) : null
  const bubbleActivity = useLastNonNull(secondary)
  // Ce qui tourne aussi, sous l'appel ou la musique au survol (pas de bulle) ; dépliée : toutes les lignes.
  const duringCall = meet !== null
  const meetRows = useMemo(
    () => backgroundRows(snapshot.background, sessions, music, { expanded: rowsExpanded, duringCall }),
    [snapshot.background, sessions, music, rowsExpanded, duringCall],
  )
  /** Clic sur une ligne « aussi en cours » : même action que la vue « plusieurs sessions » ou que la bulle. */
  const selectRow = (row: BackgroundRow) => {
    const target = row.target
    if (!target) return
    switch (target.type) {
      case 'session':
        if (target.waiting) onAnswerSession(target.sessionId)
        else onOpenSession(target.sessionId)
        return
      case 'activity': {
        const activity = snapshot.background.find((a) => a.id === target.activityId)
        if (activity) onBubbleClick(activity)
        return
      }
      case 'player':
        onMusicCommand?.('open')
        return
      case 'more':
        setExpandedFor(expandKey)
        return
    }
  }

  // Service de l'appel (logo et couleur) : l'enregistrement en cours, sinon la proposition ; gardé le temps
  // du fondu de sortie pour que la couleur ne repasse pas au jaune avant la fin.
  const liveService: CallService | null | undefined = meet ? meet.service : call ? call.service : undefined
  const [keptService, setKeptService] = useState<CallService | null>(null)
  // Calque des sous-agents, devant la pochette (voir GardenEnv.front)
  const [gardenFront, setGardenFront] = useState<HTMLDivElement | null>(null)
  // Calque des personnages du fond, derrière le titre de la musique (voir GardenEnv.back)
  const [gardenBack, setGardenBack] = useState<HTMLDivElement | null>(null)
  if (liveService !== undefined && liveService !== keptService) setKeptService(liveService)
  const callService = liveService === undefined ? keptService : liveService

  // Question à choix de Claude : taille haute pour loger les choix (agentQuestion, la hauteur de agentAskCall
  // sans la ligne de l'appel, donc sans l'icône ni le minuteur d'appel). Pendant un vrai appel : agentAskCall.
  const questionAsk = state === 'agentAsk' && Boolean(snapshot.ask?.questions) && !withCall
  const target: EngineTarget = useMemo(
    () => ({
      key: questionAsk ? 'agentQuestion' : sizeKeyFor(state, open, withCall, musicGarden, progressNamed),
      platform,
      edge,
      reduced,
      hasGarden,
      sessionCount,
      meetRows: meetRows.length,
      musicProgress,
      musicControls,
      dragging,
    }),
    [
      state,
      open,
      withCall,
      questionAsk,
      musicGarden,
      progressNamed,
      platform,
      edge,
      reduced,
      hasGarden,
      sessionCount,
      meetRows.length,
      musicProgress,
      musicControls,
      dragging,
    ],
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
    musicElapsed: null,
    musicFill: null,
  })
  const [stage] = useState(createIslandStage)
  const engineRef = useRef<IslandEngine | null>(null)
  const loopRef = useRef<IslandLoop | null>(null)
  const targetRef = useRef(target)
  // Bulle secondaire : seulement en haut (une seule île : elle n'est plus utilisée).
  const bubbleOn = secondary !== null && edge === 'top'
  const bubbleVisibleRef = useRef(bubbleOn)

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
    music,
    musicLevels,
    dragMotion,
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
    engine.rootHeight = root.clientHeight
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
      engine.rootHeight = root.clientHeight
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
  // Avec la musique, les Claude restent visibles au survol : l'île s'ouvre et ils tombent jusqu'en bas.
  const gardenVisible = (state === 'multi' && !open) || musicGarden
  const callOn = meet !== null
  const agentSessionId = agentSession?.id ?? null
  const gardenEnv: GardenEnv = useMemo(
    () => ({
      stage,
      visible: gardenVisible,
      sizeKey: musicGarden ? 'musicGarden' : 'multi',
      state,
      platform,
      reduced,
      mood: { call: callOn, music: musicPlaying },
      musicLevels: musicLevels ?? null,
      agentSessionId,
      front: gardenFront,
      back: gardenBack,
    }),
    [
      stage,
      gardenVisible,
      musicGarden,
      state,
      platform,
      reduced,
      callOn,
      musicPlaying,
      musicLevels,
      agentSessionId,
      gardenFront,
      gardenBack,
    ],
  )

  // Nouvelle cible : état, survol, plateforme, jardin, nombre de sessions
  useLayoutEffect(() => {
    targetRef.current = target
    engineRef.current?.retarget(target)
    loopRef.current?.requestHitRects()
  }, [target])

  // Bulle secondaire
  useLayoutEffect(() => {
    bubbleVisibleRef.current = bubbleOn
    engineRef.current?.setBubble(bubbleOn)
    loopRef.current?.requestHitRects()
  }, [bubbleOn])

  // Glisser de l'île : appui sur la forme + déplacement au-delà du seuil (drag.ts). Taille envoyée : celle de
  // l'île fermée (on la saisit souvent ouverte au survol, mais elle se referme pendant le glisser et l'aperçu
  // montre où se posera la forme fermée).
  const closedKeyRef = useRef<IslandSizeKey>(target.key)
  useLayoutEffect(() => {
    closedKeyRef.current = questionAsk
      ? 'agentQuestion'
      : sizeKeyFor(state, false, withCall, musicGarden, progressNamed)
  })
  const readDragSize = useCallback(() => engineRef.current?.dragSize(closedKeyRef.current) ?? null, [])
  const drag = useIslandDrag(onDragStart, readDragSize)

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
  const eqBarRef = useCallback((i: number, el: SVGRectElement | null) => {
    liveRef.current.eqBars[i] = el
  }, [])
  const ringRef = useCallback((el: SVGCircleElement | null) => {
    liveRef.current.ring = el
  }, [])
  const bubbleRingRef = useCallback((el: SVGCircleElement | null) => {
    liveRef.current.bubbleRing = el
  }, [])
  const musicElapsedRef = useCallback((el: HTMLElement | null) => {
    liveRef.current.musicElapsed = el
  }, [])
  const musicFillRef = useCallback((el: HTMLElement | null) => {
    liveRef.current.musicFill = el
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

  const base = { current: state, platform, edge, withCall }
  const vertical = isVerticalLayout(edge, target.key)
  const extra = snapshot.activityCount - 2

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-platform={platform}
      data-edge={edge}
      data-vertical={vertical ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-hover={open ? 'true' : 'false'}
      data-reduced={reduced ? 'true' : 'false'}
      data-state={state}
      style={{ ...callToneStyle(callService), ...musicStyle(music?.palette) }}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={islandRef}
        className={styles.island}
        onPointerDown={drag.onPointerDown}
        onDragStart={drag.onNativeDragStart}
        onMouseEnter={() => onHoverChange?.(true)}
        onMouseLeave={() => onHoverChange?.(false)}
      >
        <svg ref={svgRef} className={styles.shape} aria-hidden="true">
          <path ref={pathRef} className={styles.shapeBody} />
        </svg>
        <div ref={contentRef} className={styles.content}>
          {/* Personnages du fond : derrière le titre de la musique (dessinés avant les activités) */}
          {hasGarden && (
            <div
              ref={setGardenBack}
              className={cx(styles.garden, gardenVisible && styles.on)}
              aria-hidden="true"
            />
          )}
          <ActivityLayers
            base={base}
            open={open}
            snapshot={snapshot}
            call={call}
            meet={meet}
            meetRows={meetRows}
            progress={progress}
            music={music}
            agentSession={agentSession}
            sessions={sessions}
            drop={drop}
            hotZone={hotZone}
            refs={{ musicElapsedRef, musicFillRef, rowElapsedRef }}
            handlers={{
              onCallAccept,
              onCallIgnore,
              onProjectChange,
              onStopRecording,
              onAskDecision,
              onAnswerSession,
              onOpenSession,
              onNotificationAction,
              onMusicCommand,
              onSelectRow: selectRow,
            }}
          />
          {/* Personnages principaux : derrière la pochette et l'égaliseur (éléments partagés, dessinés après) */}
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
            eqBarRef={eqBarRef}
            artworkUrl={music?.artworkUrl ?? null}
            agent={agentSession}
            reduced={reduced}
            progress={shownProgress}
            platform={platform}
            ringRef={ringRef}
          />
          {/* Sous-agents : devant la pochette, ils sont petits et ne la cachent pas */}
          {hasGarden && (
            <div
              ref={setGardenFront}
              className={cx(styles.garden, gardenVisible && styles.on, styles.gardenFront)}
              aria-hidden="true"
            />
          )}
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
        tabIndex={bubbleOn ? 0 : -1}
        onClick={() => {
          if (secondary && bubbleOn) onBubbleClick(secondary)
        }}
      >
        <svg ref={bubbleSvgRef} aria-hidden="true">
          <path ref={bubblePathRef} />
        </svg>
        <span ref={bubbleContentRef} className={styles.bubbleContent}>
          <BubbleContent activity={bubbleActivity} music={music} ringRef={bubbleRingRef} />
        </span>
        {bubbleOn && extra > 0 && (
          <span className={styles.badge} aria-hidden="true">
            +{extra}
          </span>
        )}
      </button>
      <p className={styles.srOnly} aria-live="polite">
        {islandLabel(snapshot, sessionCount, call?.appName ?? null, music)}
      </p>
    </div>
  )
}
