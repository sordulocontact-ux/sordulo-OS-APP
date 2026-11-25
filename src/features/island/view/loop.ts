/**
 * Boucle requestAnimationFrame de l'île (prototype : frame) : ressort, rendu de la forme, minuteurs, onde,
 * anneau, égaliseur (vrai son quand il est là, sinon simulé) et progression de la musique, rapport des zones
 * cliquables. Tout s'écrit directement dans le DOM.
 */
import type { IslandRect } from '../../../shared/desktop-contract'
import { WAVE, progressRatio, ringDashOffset, waveBarHeight } from '../geometry'
import type { ClaudeSession, IslandMusic, IslandState, MusicLevelsReader, ProgressActivity } from '../types'
import type { IslandEngine } from './engine'
import type { DragMotionReader } from './types'
import { formatElapsed } from './labels'
import {
  createEqualizer,
  eqBarGeometry,
  eqBarTone,
  musicBeatPhase,
  musicPosition,
  musicRatio,
  stepEqualizer,
  stepEqualizerReal,
  stillEqualizer,
} from './music'

/** Intervalle minimal entre deux rapports de zones cliquables pendant une animation (ms). */
export const HIT_RECTS_INTERVAL_MS = 50

/** Éléments mis à jour par la boucle (texte et styles que React ne rend pas). */
export interface LiveElements {
  timer: HTMLElement | null
  elapsed: HTMLElement | null
  waveBars: (HTMLElement | null)[]
  eqBars: (SVGRectElement | null)[]
  ring: SVGCircleElement | null
  bubbleRing: SVGCircleElement | null
  /** Temps écoulé des sessions qui travaillent, dans multiOpen. */
  rowElapsed: Map<string, HTMLElement>
  /** Temps écoulé du morceau et remplissage de sa barre de progression (musicOpen). */
  musicElapsed: HTMLElement | null
  musicFill: HTMLElement | null
}

/** Données lues par la boucle, mises à jour à chaque rendu React. */
export interface LiveData {
  state: IslandState
  withCall: boolean
  reduced: boolean
  /** Début de l'enregistrement (epoch ms) ; null : minuteur à 00:00. */
  callStartedAt: number | null
  /** Début de la session Claude affichée dans agent / agentAsk (epoch ms). */
  elapsedStartedAt: number | null
  sessions: readonly ClaudeSession[]
  progress: ProgressActivity | null
  bubbleProgress: ProgressActivity | null
  audioLevels: readonly number[] | undefined
  /** Lecture en cours (égaliseur, progression) ; null : égaliseur en lecture, sans progression. */
  music: IslandMusic | null
  /** Vrai son (Windows), lu à chaque image ; absent ou sans analyse récente : égaliseur simulé. */
  musicLevels: MusicLevelsReader | undefined
  /** Vitesse du glisser (goutte liquide) ; absent : goutte immobile. */
  dragMotion: DragMotionReader | undefined
  onHitRects: (rects: IslandRect[]) => void
}

function sameRects(a: IslandRect[], b: IslandRect[] | null): boolean {
  if (!b || a.length !== b.length) return false
  return a.every((r, i) => {
    const o = b[i]
    return !!o && o.x === r.x && o.y === r.y && o.width === r.width && o.height === r.height
  })
}

function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text
}

/** Une image de la boucle de l'île : temps, pas (s) et taille courante du ressort (px). */
export interface IslandFrameInfo {
  now: number
  dt: number
  width: number
  height: number
}

/**
 * Scène de l'île pour ce qui s'anime à l'intérieur de la forme (le jardin) : taille animée réelle et
 * abonnement aux images de la boucle, sans rendu React.
 */
export interface IslandStage {
  /** Appelé à chaque image tant qu'on est abonné ; renvoie la désinscription. */
  subscribe: (listener: (frame: IslandFrameInfo) => void) => () => void
  /** Taille courante du ressort ; null tant que l'île n'est pas montée. */
  size: () => { width: number; height: number } | null
}

export interface IslandStageHandle extends IslandStage {
  /** Image suivante (appelé par la boucle). */
  emit: (frame: IslandFrameInfo) => void
  /** Lecture de la taille courante (le moteur, une fois monté). */
  setSizeReader: (read: (() => { width: number; height: number }) | null) => void
}

export function createIslandStage(): IslandStageHandle {
  const listeners = new Set<(frame: IslandFrameInfo) => void>()
  let read: (() => { width: number; height: number }) | null = null
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    size: () => (read ? read() : null),
    emit: (frame) => {
      for (const listener of [...listeners]) listener(frame)
    },
    setSizeReader: (next) => {
      read = next
    },
  }
}

export interface IslandLoop {
  stop: () => void
  /** Rapporte les zones cliquables dès la prochaine image (nouvelle cible, redimensionnement). */
  requestHitRects: () => void
}

/** `onFrame` : appelé à chaque image après le rendu de la forme (scène du jardin). */
export function startIslandLoop(
  engine: IslandEngine,
  live: LiveElements,
  data: () => LiveData,
  onFrame?: (now: number, dtSeconds: number) => void,
): IslandLoop {
  let raf = 0
  let last = performance.now()
  let lastReport = -Infinity
  let reported: IslandRect[] | null = null
  let forceReport = true
  let wasAnimating = false
  let lastScroll = 0
  const wave: number[] = [...WAVE.initial]
  // Onde simulée du prototype quand aucun niveau sonore n'est fourni (labo).
  let talking = true
  let talkLeft = 14
  const eq = createEqualizer()
  // Échelles déjà écrites : on n'écrit le DOM que si une barre bouge.
  const eqShown = new WeakMap<SVGRectElement, number>()
  live.waveBars.forEach((b, j) => {
    if (b) b.style.height = `${wave[j] ?? WAVE.minHeight}px`
  })

  function simulatedSample(): number {
    if (--talkLeft <= 0) {
      talking = !talking
      talkLeft = talking ? 8 + Math.random() * 18 : 3 + Math.random() * 7
    }
    if (!talking) return WAVE.minHeight
    return Math.random() < 0.15 ? 3 : Math.round(5 + Math.random() * 9)
  }

  function report(d: LiveData, now: number): void {
    const rects = engine.hitRects()
    lastReport = now
    if (sameRects(rects, reported)) return
    reported = rects
    d.onHitRects(rects)
  }

  function frame(now: number): void {
    const d = data()
    const dt = (now - last) / 1000
    engine.setMotion(d.dragMotion?.(now) ?? null)
    const animating = engine.step(dt)
    last = now
    engine.render()
    onFrame?.(now, dt)

    if (forceReport || (animating && now - lastReport >= HIT_RECTS_INTERVAL_MS) || (!animating && wasAnimating)) {
      forceReport = false
      report(d, now)
    }
    wasAnimating = animating

    const epoch = Date.now()
    const { state } = d
    const callVisible = state === 'meet' || (d.withCall && (state === 'notif' || state === 'agentAsk'))
    if (callVisible) {
      setText(live.timer, formatElapsed(d.callStartedAt === null ? 0 : epoch - d.callStartedAt))
      if (!d.reduced && now - lastScroll > WAVE.scrollMs) {
        lastScroll = now
        if (d.audioLevels) {
          const levels = d.audioLevels.slice(-WAVE.bars)
          const pad = WAVE.bars - levels.length
          for (let j = 0; j < WAVE.bars; j++) wave[j] = j < pad ? WAVE.minHeight : waveBarHeight(levels[j - pad] ?? 0)
        } else {
          wave.shift()
          wave.push(simulatedSample())
        }
        live.waveBars.forEach((b, j) => {
          if (b) b.style.height = `${wave[j] ?? WAVE.minHeight}px`
        })
      }
    }
    if ((state === 'agent' || state === 'agentAsk') && d.elapsedStartedAt !== null) {
      setText(live.elapsed, formatElapsed(epoch - d.elapsedStartedAt))
    }
    if (state === 'multi') {
      for (const s of d.sessions) {
        const el = live.rowElapsed.get(s.id)
        if (el) setText(el, formatElapsed(epoch - s.startedAt))
      }
    }
    if (state === 'progress' && d.progress && live.ring) {
      live.ring.style.strokeDashoffset = ringDashOffset(progressRatio(d.progress, epoch)).toFixed(2)
    }
    if (d.bubbleProgress && live.bubbleRing) {
      live.bubbleRing.style.strokeDashoffset = ringDashOffset(progressRatio(d.bubbleProgress, epoch)).toFixed(2)
    }
    if (state === 'music') {
      // Sans données de lecture (scénarios), l'égaliseur joue.
      const playing = d.music?.playing ?? true
      // Vrai son seulement en lecture (en pause : à plat, comme la simulation).
      const levels = playing && !d.reduced ? (d.musicLevels?.get(epoch) ?? null) : null
      // Tempo du morceau (Deezer) d'après sa position : quand le vrai son ne donne pas de temps.
      const tempoPhase = playing && !d.reduced ? (d.musicLevels?.tempoPhase(epoch) ?? null) : null
      const scales = d.reduced
        ? stillEqualizer(playing)
        : levels
          ? stepEqualizerReal(eq, dt, levels.bands, musicBeatPhase(levels, epoch) ?? tempoPhase)
          : stepEqualizer(eq, now / 1000, dt, playing, Math.random, tempoPhase)
      live.eqBars.forEach((b, j) => {
        const v = Math.round((scales[j] ?? 0) * 1000) / 1000
        if (!b || eqShown.get(b) === v) return
        eqShown.set(b, v)
        const bar = eqBarGeometry(v)
        b.setAttribute('y', bar.y.toFixed(2))
        b.setAttribute('height', bar.height.toFixed(2))
        b.style.setProperty('--eq-t', eqBarTone(v).toFixed(3))
      })
      if (d.music) {
        const position = musicPosition(d.music, epoch)
        setText(live.musicElapsed, formatElapsed(position ?? 0))
        if (live.musicFill) live.musicFill.style.transform = `scaleX(${musicRatio(d.music, epoch).toFixed(4)})`
      }
    }
    raf = requestAnimationFrame(frame)
  }

  raf = requestAnimationFrame(frame)
  return {
    stop: () => cancelAnimationFrame(raf),
    requestHitRects: () => {
      forceReport = true
    },
  }
}
