import { useState, useSyncExternalStore } from 'react'

/**
 * Garde la dernière valeur non nulle : une couche qui s'efface montre encore son contenu pendant le fondu
 * (notification, demande, fichier glissé…).
 */
export function useLastNonNull<T>(value: T | null): T | null {
  const [kept, setKept] = useState<T | null>(value)
  if (value !== null && value !== kept) setKept(value)
  return value ?? kept
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReduced(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(REDUCED_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function readReduced(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(REDUCED_QUERY).matches
}

/** prefers-reduced-motion, suivi en direct. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, readReduced, () => false)
}
