/**
 * Le Claude de l'île (icône partagée `agentIcon`) : même silhouette et mêmes yeux que les personnages du
 * jardin. Il cligne des yeux à intervalles aléatoires ; en travail, il enchaîne des gestes tirés au hasard
 * (sauts, penchés, écrasements, pas de côté, regards) ; au repos, il se contente de cligner et de regarder
 * autour de lui. Sous prefers-reduced-motion : immobile.
 */
import { useEffect, useRef } from 'react'
import {
  IDLE_WEIGHTS,
  MASCOT,
  WORKING_WEIGHTS,
  between,
  gestureAnimation,
  pickGesture,
  type MascotGesture,
} from './mascot'
import styles from './ClaudeMascot.module.css'

export interface ClaudeMascotProps {
  /** La session affichée travaille : gestes variés. Sinon : clignements et regards seulement. */
  working: boolean
  reduced: boolean
}

export function ClaudeMascot({ working, reduced }: ClaudeMascotProps) {
  const figureRef = useRef<HTMLSpanElement>(null)
  const faceRef = useRef<HTMLSpanElement>(null)
  const lidRefs = useRef<(HTMLElement | null)[]>([])
  const workingRef = useRef(working)

  useEffect(() => {
    workingRef.current = working
  }, [working])

  useEffect(() => {
    const figure = figureRef.current
    const face = faceRef.current
    if (reduced || !figure || !face || typeof figure.animate !== 'function') return
    const rand = Math.random
    const timers = new Set<number>()
    const running = new Set<Animation>()
    const later = (ms: number, fn: () => void) => {
      const id = window.setTimeout(() => {
        timers.delete(id)
        fn()
      }, ms)
      timers.add(id)
    }
    const play = (el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = el.animate(keyframes, options)
      running.add(animation)
      animation.onfinish = () => running.delete(animation)
      animation.oncancel = () => running.delete(animation)
    }

    const closeLids = (delay: number) => {
      for (const lid of lidRefs.current) {
        if (!lid) continue
        play(lid, [{ height: '0%' }, { height: '12.5%', offset: 0.4 }, { height: '12.5%', offset: 0.6 }, { height: '0%' }], {
          duration: MASCOT.blink.duration,
          delay,
        })
      }
    }
    const blink = () => {
      closeLids(0)
      if (rand() < MASCOT.blink.double) closeLids(MASCOT.blink.duration + MASCOT.blink.gap)
      later(between(workingRef.current ? MASCOT.blink.every : MASCOT.blink.idleEvery, rand), blink)
    }

    let previous: MascotGesture | null = null
    const gesture = () => {
      const isWorking = workingRef.current
      const next = pickGesture(isWorking ? WORKING_WEIGHTS : IDLE_WEIGHTS, previous, rand)
      previous = next
      const animation = gestureAnimation(next, rand)
      let busy = 0
      if (animation) {
        play(animation.target === 'face' ? face : figure, animation.keyframes, {
          duration: animation.duration,
          easing: animation.easing,
        })
        busy = animation.duration
      }
      later(busy + between(isWorking ? MASCOT.next.working : MASCOT.next.idle, rand), gesture)
    }

    later(between(MASCOT.blink.every, rand), blink)
    later(between(MASCOT.next.working, rand), gesture)
    return () => {
      timers.forEach((id) => clearTimeout(id))
      running.forEach((animation) => animation.cancel())
    }
  }, [reduced])

  return (
    <span className={styles.mascot} aria-hidden="true">
      <span ref={figureRef} className={styles.figure}>
        <span className={styles.body} />
        <span ref={faceRef} className={styles.face}>
          <i className={`${styles.eye} ${styles.left}`} />
          <i className={`${styles.eye} ${styles.right}`} />
          <i ref={(el) => {
              lidRefs.current[0] = el
            }} className={`${styles.lid} ${styles.left}`} />
          <i ref={(el) => {
              lidRefs.current[1] = el
            }} className={`${styles.lid} ${styles.right}`} />
        </span>
      </span>
    </span>
  )
}
