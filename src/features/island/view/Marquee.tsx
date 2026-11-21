/**
 * Texte qui défile comme sur iPhone quand il est trop long pour sa ligne (titre, artistes, lecteur de la musique) :
 * fixe MARQUEE.holdMs, puis il glisse vers la gauche, suivi d'une copie (pas de trou), revient au début et
 * repart après une nouvelle pause. Court : rien ne bouge. Animations réduites ou vue fermée : texte fixe, coupé
 * par « … ». Le texte complet reste dans le `title`.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx } from './cx'
import { usePrefersReducedMotion } from './hooks'
import styles from './Island.module.css'

/** Pause avant chaque défilement (ms) et vitesse du défilement (px/s). */
const MARQUEE = { holdMs: 5000, speed: 30 }

export function Marquee({ text, active }: { text: string; active: boolean }) {
  const boxRef = useRef<HTMLSpanElement>(null)
  const trackRef = useRef<HTMLSpanElement>(null)
  const [overflows, setOverflows] = useState(false)
  const reduced = usePrefersReducedMotion()

  // Trop long pour la ligne ? (mesuré à chaque texte et à chaque changement de largeur)
  useLayoutEffect(() => {
    const box = boxRef.current
    const first = trackRef.current?.firstElementChild as HTMLElement | null
    if (!box || !first) return
    const measure = () => setOverflows(first.offsetWidth > box.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [text])

  // Défilement : pause, puis glissement jusqu'à la copie (qui prend la place du début), en boucle.
  useEffect(() => {
    const track = trackRef.current
    if (!track || !overflows || !active || reduced || typeof track.animate !== 'function') return
    const [first, copy] = Array.from(track.children) as HTMLElement[]
    if (!first || !copy) return
    const distance = copy.offsetLeft - first.offsetLeft
    const scrollMs = (distance / MARQUEE.speed) * 1000
    const total = MARQUEE.holdMs + scrollMs
    const animation = track.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(0)', offset: MARQUEE.holdMs / total },
        { transform: `translateX(${-distance}px)` },
      ],
      { duration: total, iterations: Infinity, easing: 'linear' },
    )
    return () => animation.cancel()
  }, [overflows, active, reduced, text])

  const scrolling = overflows && active && !reduced
  return (
    <span ref={boxRef} className={cx(styles.marquee, scrolling && styles.marqueeOn)} title={text}>
      <span ref={trackRef} className={styles.marqueeTrack}>
        <span>{text}</span>
        {scrolling && (
          <span className={styles.marqueeCopy} aria-hidden="true">
            {text}
          </span>
        )}
      </span>
    </span>
  )
}
