/**
 * Le Claude de l'île (icône partagée `agentIcon`) : même silhouette et mêmes yeux que les personnages du
 * jardin, avec des bras et des accessoires. Il cligne des yeux à intervalles aléatoires et enchaîne des scènes
 * (mascotScenes.ts) : au travail, celle de ce qu'il fait (lit, fouille, écrit, tape une commande, cherche à la
 * loupe, réfléchit avec des engrenages au-dessus de la tête, lance un sous-agent), avec de temps en temps une variation (s'étire, bâille, se gratte la
 * tête…) ; un moment quand l'état change (réveil, fin, erreur) ; pendant une demande d'autorisation, il te
 * regarde en tapant du pied ; au repos, il regarde autour de lui.
 * Sous prefers-reduced-motion : immobile, l'accessoire de l'activité seul.
 */
import { useEffect, useRef, useState } from 'react'
import type { ClaudeActivity, ClaudeSessionStatus } from '../types'
import { MASCOT, between } from './mascot'
import {
  ACTIVITY_PROP,
  SCENES,
  detectMoment,
  mascotPhase,
  momentScene,
  nextScene,
  type MascotMoment,
  type MascotPart,
  type MascotScene,
} from './mascotScenes'
import { ART } from '../art/pixelArt'
import { PixelArtSvg } from '../art/PixelArtSvg'
import styles from './ClaudeMascot.module.css'

export interface ClaudeMascotProps {
  /** Statut de la session affichée ; null : pas de session (repos). */
  status: ClaudeSessionStatus | null
  /** Ce que fait Claude (outil en cours) ; null hors du travail. */
  activity: ClaudeActivity | null
  /** Session bloquée (commande refusée). */
  error: boolean
  /** Début du tour en cours (epoch ms) : bâillements et sueur quand ça dure. */
  startedAt: number | null
  reduced: boolean
}

type PartRef = (el: Element | null) => void

/** Éléments animés par pièce, et leurs rappels de ref (stables : créés une fois par pièce). */
function createParts() {
  const elements: Partial<Record<MascotPart, Element[]>> = {}
  const refs = new Map<string, PartRef>()
  const ref = (name: MascotPart, slot = 0): PartRef => {
    const key = `${name}:${slot}`
    let callback = refs.get(key)
    if (!callback) {
      callback = (el) => {
        const list = elements[name] ?? []
        if (el) list[slot] = el
        else delete list[slot]
        elements[name] = list
      }
      refs.set(key, callback)
    }
    return callback
  }
  return { elements, ref }
}

interface MascotInputs {
  status: ClaudeSessionStatus | null
  activity: ClaudeActivity | null
  error: boolean
  startedAt: number | null
}

export function ClaudeMascot({ status, activity, error, startedAt, reduced }: ClaudeMascotProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const [parts] = useState(createParts)
  const part = parts.ref
  const inputsRef = useRef<MascotInputs>({ status, activity, error, startedAt })
  /** Rappel posé par la boucle des scènes : un moment ou un changement de phase la relance tout de suite. */
  const interruptRef = useRef<((moment: MascotMoment | null) => void) | null>(null)

  useEffect(() => {
    const previous = inputsRef.current
    const next = { status, activity, error, startedAt }
    inputsRef.current = next
    const moment = detectMoment(previous, next)
    if (moment || mascotPhase(previous.status) !== mascotPhase(status)) interruptRef.current?.(moment)
  }, [status, activity, error, startedAt])

  useEffect(() => {
    const root = rootRef.current
    if (reduced || !root || typeof root.animate !== 'function') return
    const rand = Math.random
    const timers = new Set<number>()
    const scene = new Set<Animation>()
    const blinks = new Set<Animation>()
    const later = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        timers.delete(id)
        fn()
      }, ms)
      timers.add(id)
      return id
    }
    const play = (into: Set<Animation>, el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = el.animate(keyframes, options)
      into.add(animation)
      animation.onfinish = () => into.delete(animation)
      animation.oncancel = () => into.delete(animation)
      return animation
    }

    // Clignements, à part des scènes.
    const closeLids = (delay: number) => {
      for (const lid of parts.elements.lids ?? []) {
        if (!lid) continue
        play(blinks, lid, [{ height: '0%' }, { height: '12.5%', offset: 0.4 }, { height: '12.5%', offset: 0.6 }, { height: '0%' }], {
          duration: MASCOT.blink.duration,
          delay,
        })
      }
    }
    const blink = () => {
      closeLids(0)
      if (rand() < MASCOT.blink.double) closeLids(MASCOT.blink.duration + MASCOT.blink.gap)
      const working = inputsRef.current.status === 'working'
      later(between(working ? MASCOT.blink.every : MASCOT.blink.idleEvery, rand), blink)
    }

    // Scènes.
    let pendingMoment: MascotMoment | null = null
    let previous: MascotScene | null = null
    let previousActivity: ClaudeActivity | null = null
    let shownActivity: ClaudeActivity | null = null
    let shownSince: number | null = null
    let sceneTimer: number | null = null
    /** Numéro de la scène en cours : une scène interrompue n'enchaîne pas sur la suivante. */
    let sceneId = 0

    const run = () => {
      sceneTimer = null
      const id = ++sceneId
      const { status: s, activity: a, startedAt: since } = inputsRef.current
      const now = Date.now()
      if (a !== shownActivity || shownSince === null) {
        shownActivity = a
        shownSince = now
      }
      let current: MascotScene
      if (pendingMoment) {
        current = momentScene(pendingMoment, rand)
        pendingMoment = null
      } else {
        current = nextScene(
          {
            status: s,
            activity: a,
            activityElapsed: now - (shownSince ?? now),
            workingFor: since === null ? 0 : now - since,
            previous,
            previousActivity,
          },
          rand,
        )
      }
      previous = current
      if (current.family === 'activity') previousActivity = a ?? 'think'
      else if (current.family !== 'variation') previousActivity = null
      root.dataset.prop = current.prop ?? ''
      const finished: Promise<unknown>[] = []
      for (const t of current.tracks) {
        for (const el of parts.elements[t.part] ?? []) {
          if (!el) continue
          const animation = play(scene, el, t.keyframes, {
            duration: t.duration,
            delay: t.delay ?? 0,
            easing: t.easing ?? 'ease-in-out',
          })
          finished.push(animation.finished)
        }
      }
      const pause = current.family === 'idle' ? between(MASCOT.next.idle, rand) : between(SCENES.gap, rand)
      // Scène suivante à la fin réelle des animations (une minuterie seule, ralentie par le navigateur quand
      // la fenêtre est en arrière-plan, faisait se chevaucher deux scènes).
      if (finished.length === 0) {
        sceneTimer = later(current.duration + pause, run)
        return
      }
      void Promise.allSettled(finished).then(() => {
        if (id === sceneId) sceneTimer = later(pause, run)
      })
    }

    interruptRef.current = (moment) => {
      if (moment) pendingMoment = moment
      sceneId++
      scene.forEach((animation) => animation.cancel())
      if (sceneTimer !== null) {
        clearTimeout(sceneTimer)
        timers.delete(sceneTimer)
      }
      sceneTimer = later(0, run)
    }

    later(between(MASCOT.blink.every, rand), blink)
    sceneTimer = later(between(MASCOT.next.working, rand), run)
    return () => {
      interruptRef.current = null
      sceneId++
      timers.forEach((id) => clearTimeout(id))
      scene.forEach((animation) => animation.cancel())
      blinks.forEach((animation) => animation.cancel())
      delete root.dataset.prop
    }
  }, [reduced, parts])

  // Animations réduites : l'accessoire de l'activité, et la bulle de fin ou d'erreur, sans mouvement.
  const staticProp = reduced && status === 'working' && activity ? (ACTIVITY_PROP[activity] ?? undefined) : undefined
  const staticBubble = reduced ? (error ? 'err' : status === 'done' ? 'done' : undefined) : undefined

  return (
    <span
      ref={rootRef}
      className={styles.mascot}
      aria-hidden="true"
      data-reduced={reduced ? 'true' : undefined}
      {...(reduced ? { 'data-prop': staticProp ?? '' } : {})}
      data-bubble={staticBubble}
    >
      {/* Derrière lui : le fond du dossier, le mini Claude du sous-agent */}
      <span className={styles.layer}>
        <PixelArtSvg art={ART.folderBack} className={`${styles.prop} ${styles.folderBack}`} />
        <span ref={part('mini')} className={styles.mini}>
          <span className={styles.miniBody} />
        </span>
      </span>

      <span ref={part('figure')} className={styles.figure}>
        {/* Le masque du corps n'a pas les pattes (le jardin les dessine à part pour la marche) */}
        <i className={`${styles.leg} ${styles.leg1}`} />
        <i className={`${styles.leg} ${styles.leg2}`} />
        <i className={`${styles.leg} ${styles.leg3}`} />
        <i ref={part('leg4')} className={`${styles.leg} ${styles.leg4}`} />
        <span ref={part('upper')} className={styles.upper}>
          <span className={styles.torso} />
          <span ref={part('face')} className={styles.face}>
            <i className={`${styles.eye} ${styles.left}`} />
            <i className={`${styles.eye} ${styles.right}`} />
            <i ref={part('lids', 0)} className={`${styles.lid} ${styles.left}`} />
            <i ref={part('lids', 1)} className={`${styles.lid} ${styles.right}`} />
            <i ref={part('mouth')} className={styles.mouth} />
          </span>
          {/* Feuille (lit), carnet (écrit), loupe (web : verre teinté avec l'œil grossi) */}
          <PixelArtSvg ref={part('paper')} art={ART.paper} className={`${styles.prop} ${styles.paper}`} />
          <PixelArtSvg art={ART.notepad} className={`${styles.prop} ${styles.notepad}`} />
          <PixelArtSvg ref={part('lens')} art={ART.lens} className={`${styles.prop} ${styles.lens}`} />
          <span ref={part('armL')} className={`${styles.arm} ${styles.armL}`} />
          <span ref={part('armR')} className={`${styles.arm} ${styles.armR}`}>
            {/* Crayon (écrit) : pointe en bas à gauche de la patte, gomme en haut à droite */}
            <PixelArtSvg art={ART.pencil} className={`${styles.prop} ${styles.pencil}`} />
          </span>
        </span>
      </span>

      {/* Devant lui : le devant du dossier, le clavier et l'invite de commande */}
      <span className={styles.layer}>
        <PixelArtSvg art={ART.folderFront} className={`${styles.prop} ${styles.folderFront}`} />
        <PixelArtSvg art={ART.keyboard} className={`${styles.prop} ${styles.keyboard}`} />
        <PixelArtSvg art={ART.prompt} className={`${styles.prop} ${styles.prompt}`} />
      </span>

      {/* Au-dessus : engrenages, bulles ✓ et ?, sueur, étincelles */}
      <span className={styles.layer}>
        {/* Engrenages de la réflexion : ils tournent tant qu'ils sont affichés (animation en images) */}
        <span ref={part('gears')} className={styles.gearsBox}>
          <PixelArtSvg art={ART.gears} className={`${styles.prop} ${styles.gears}`} />
        </span>
        <svg
          ref={part('bubbleDone')}
          className={`${styles.fx} ${styles.bubble} ${styles.bubbleDone}`}
          viewBox="0 0 7 8"
          shapeRendering="crispEdges"
        >
          <rect x="0" y="0" width="7" height="8" />
          <g className={styles.glyph}>
            <rect x="1" y="4" width="1" height="1" />
            <rect x="2" y="5" width="1" height="1" />
            <rect x="3" y="4" width="1" height="1" />
            <rect x="4" y="3" width="1" height="1" />
            <rect x="5" y="2" width="1" height="1" />
          </g>
        </svg>
        <svg
          ref={part('bubbleErr')}
          className={`${styles.fx} ${styles.bubble} ${styles.bubbleErr}`}
          viewBox="0 0 7 8"
          shapeRendering="crispEdges"
        >
          <rect x="0" y="0" width="7" height="8" />
          <g className={styles.glyph}>
            <rect x="2" y="1" width="3" height="1" />
            <rect x="1" y="2" width="1" height="1" />
            <rect x="5" y="2" width="1" height="1" />
            <rect x="4" y="3" width="1" height="1" />
            <rect x="3" y="4" width="1" height="1" />
            <rect x="3" y="6" width="1" height="1" />
          </g>
        </svg>
        <i ref={part('sweat')} className={`${styles.fx} ${styles.sweat}`} />
        {(['spark0', 'spark1', 'spark2', 'spark3', 'spark4', 'spark5'] as const).map((name) => (
          <i key={name} ref={part(name)} className={`${styles.fx} ${styles.spark}`} />
        ))}
      </span>
    </span>
  )
}
