import { useCallback, useState, useSyncExternalStore } from 'react'

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

/**
 * Vrai tant que l'heure (epoch ms) est avant `deadline`, puis faux tout seul à l'échéance (un seul minuteur, pas
 * de rendu par image) : « Annuler » le dernier repère, étoile brève d'un repère ajouté. null : toujours faux.
 */
export function useBefore(deadline: number | null): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (deadline === null || typeof window === 'undefined') return () => {}
      const ms = deadline - Date.now()
      if (ms <= 0) return () => {}
      const id = window.setTimeout(onChange, ms + 1)
      return () => window.clearTimeout(id)
    },
    [deadline],
  )
  const read = () => deadline !== null && Date.now() < deadline
  return useSyncExternalStore(subscribe, read, () => false)
}
