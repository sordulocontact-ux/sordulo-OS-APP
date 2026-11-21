/**
 * Le jardin des Claude (prototype design/prototypes/ile-sordulo-os.html : .garden, initGarden, updateGarden,
 * renderGarden) : dans l'état `multi` au repos, chaque session Claude Code est un petit personnage qui se
 * promène dans la forme noire, avec ses sous-agents, ses rencontres et ses événements.
 *
 * À passer à `<Island garden={<Garden sessions={…} />} />` : l'île fournit par GardenEnvContext la taille
 * animée réelle, ses images, la visibilité, l'humeur (appel en cours, musique) et la réduction des animations.
 * - React ne rend que le conteneur ; personnages et effets sont écrits par ./renderer.ts à chaque image de la
 *   boucle de l'île, seulement quand le jardin est visible (abonnement retiré sinon).
 * - Aussi dans la musique quand des sessions Claude tournent (forme `musicGarden`) : ils marchent sous la
 *   pochette et l'égaliseur et ceux qui travaillent hochent la tête sur le tempo (musique en lecture).
 * - Chaque personnage a ses pattes qui marchent, une ombre de contact au sol et un plan de profondeur (au
 *   fond : plus petit, plus sombre, pieds plus haut, derrière les autres).
 * - Passage `agent` → `multi` (ou → musique avec jardin) : le personnage de la session affichée part de l'icône Claude.
 * - Bords en portail : un personnage qui sort à droite rentre déjà à gauche (jumeau dessiné par renderer.ts).
 * - Animations réduites (prefers-reduced-motion ou prop `reducedMotion` de l'île) : personnages immobiles,
 *   pattes posées, pas de hochement, pas d'effets.
 */
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ISLAND_SIZES, SHARED_ELEMENTS } from '../geometry'
import type { ClaudeSession, IslandState } from '../types'
import { GardenEnvContext, type GardenEnv } from './context'
import styles from './Garden.module.css'
import { GardenRenderer, type GardenClassNames } from './renderer'
import { GardenSim, type GardenIconStart, type GardenMood, type GardenSyncOptions } from './simulation'

export interface GardenProps {
  /** Sessions Claude Code (les 5 premières ont un personnage). */
  sessions: readonly ClaudeSession[]
  /** Humeur forcée (labo) : s'ajoute à celle que donne l'île (appel en cours, musique). */
  mood?: Partial<GardenMood>
}

function classNames(): GardenClassNames {
  const c = (name: string) => styles[name] ?? ''
  return {
    crowd: c('crowd'),
    mascot: c('mascot'),
    fig: c('fig'),
    upper: c('upper'),
    body: c('body'),
    leg: c('leg'),
    leg1: c('leg1'),
    leg2: c('leg2'),
    leg3: c('leg3'),
    leg4: c('leg4'),
    eye: c('eye'),
    lid: c('lid'),
    closed: c('closed'),
    left: c('left'),
    right: c('right'),
    shadow: c('shadow'),
    bubble: c('bubble'),
    wait: c('wait'),
    done: c('done'),
    err: c('err'),
    fx: c('fx'),
    say: c('say'),
    red: c('red'),
    grey: c('grey'),
    small: c('small'),
    heart: c('heart'),
    steam: c('steam'),
    star: c('star'),
    cloud: c('cloud'),
    paper: c('paper'),
    z: c('z'),
    note: c('note'),
    spark: c('spark'),
  }
}

function moodOf(env: GardenEnv, forced: Partial<GardenMood> | undefined): GardenMood {
  return { call: env.mood.call || !!forced?.call, music: env.mood.music || !!forced?.music }
}

export function Garden({ sessions, mood }: GardenProps) {
  const env = useContext(GardenEnvContext)
  const layerRef = useRef<HTMLDivElement>(null)
  const [sim] = useState(() => new GardenSim())
  const rendererRef = useRef<GardenRenderer | null>(null)
  const envRef = useRef(env)
  const moodRef = useRef(mood)
  const prevStateRef = useRef<IslandState | null>(null)
  const prevOnRef = useRef(false)
  const agentRef = useRef<string | null>(null)
  const reducedRef = useRef(false)

  useLayoutEffect(() => {
    envRef.current = env
    moodRef.current = mood
  })

  // Moteur de rendu : possède les éléments des personnages et des effets
  useLayoutEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    const renderer = new GardenRenderer(layer, classNames())
    rendererRef.current = renderer
    return () => {
      renderer.dispose()
      rendererRef.current = null
    }
  }, [])

  const state = env?.state ?? null
  const platform = env?.platform ?? 'win'
  const reduced = env?.reduced ?? false
  const visible = env?.visible ?? false
  const agentSessionId = env?.agentSessionId ?? null
  const stage = env?.stage ?? null
  const sizeKey = env?.sizeKey ?? 'multi'
  // Le jardin occupe l'île : état multi, ou musique avec des sessions Claude.
  const gardenOn = state === 'multi' || (state === 'music' && sizeKey === 'musicGarden')

  // Sessions et état de l'île → simulation (arrivées, fins, conflits, sous-agents, départ depuis l'icône)
  useLayoutEffect(() => {
    if (state === 'agent' && agentSessionId) agentRef.current = agentSessionId
    const size = stage?.size() ?? null
    const opts: GardenSyncOptions = {
      width: ISLAND_SIZES[platform][sizeKey].w,
      height: size?.height ?? ISLAND_SIZES[platform][sizeKey].h,
      platform,
      reduced,
      live: visible,
    }
    const prev = prevStateRef.current
    const wasOn = prevOnRef.current
    prevStateRef.current = state
    prevOnRef.current = gardenOn
    if (gardenOn && !wasOn) {
      if (prev === 'agent' && agentRef.current && !reduced) {
        const icon = SHARED_ELEMENTS.agentIcon[platform].agent
        const start: GardenIconStart | null = icon
          ? { sessionId: agentRef.current, left: icon.x, top: icon.y, size: icon.s ?? ISLAND_SIZES[platform].multi.h }
          : null
        sim.reset(sessions, opts, start)
      } else if (sim.walkers.length === 0) {
        sim.reset(sessions, opts)
      } else {
        sim.sync(sessions, opts)
      }
    } else {
      sim.sync(sessions, opts)
    }
    if (reduced && !reducedRef.current) sim.settle()
    reducedRef.current = reduced
  }, [sim, sessions, state, gardenOn, sizeKey, platform, reduced, visible, agentSessionId, stage])

  // Boucle : abonnée aux images de l'île seulement quand le jardin est visible
  useEffect(() => {
    if (!stage || !visible) return
    return stage.subscribe((frame) => {
      const current = envRef.current
      const renderer = rendererRef.current
      if (!current || !renderer) return
      const m = moodOf(current, moodRef.current)
      if (!current.reduced) sim.step(frame.dt, { width: frame.width, height: frame.height, platform: current.platform, mood: m })
      renderer.render(sim, {
        width: frame.width,
        height: frame.height,
        platform: current.platform,
        mood: m,
        reduced: current.reduced,
        now: frame.now / 1000,
      })
    })
  }, [sim, stage, visible])

  return (
    <div className={styles.garden} data-reduced={reduced ? 'true' : 'false'} aria-hidden="true">
      <div ref={layerRef} className={styles.layer} />
      {platform === 'mac' && <span className={styles.notch} />}
    </div>
  )
}
