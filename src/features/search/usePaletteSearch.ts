import { useEffect, useState } from 'react'
import type { MemberRole } from '../../shared/types'
import { buildGroups, DEBOUNCE_MS, filterSourcesByRole, rankResults } from './searchLogic'
import type { SearchGroup, SearchSource } from './types'

export type PaletteStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface PaletteSearch {
  status: PaletteStatus
  groups: SearchGroup[]
  /** Nombre de sources en échec quand d'autres ont répondu : les résultats sont partiels. */
  failedCount: number
  retry: () => void
}

interface Answer {
  /** Requête à laquelle cette réponse appartient. */
  key: string
  groups: SearchGroup[]
  failedCount: number
  allFailed: boolean
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Lance les sources visibles par le rôle, après un délai de frappe, et annule les requêtes en cours
 * dès que la saisie change. Rien n'est stocké hors des callbacks asynchrones : « chargement » se déduit
 * de l'écart entre la saisie et la requête de la dernière réponse.
 */
export function usePaletteSearch(
  query: string,
  sources: readonly SearchSource[],
  role: MemberRole | null,
  organizationId: string | null,
): PaletteSearch {
  const trimmed = query.trim()
  const [debounced, setDebounced] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(trimmed), trimmed === '' ? 0 : DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [trimmed])

  useEffect(() => {
    if (debounced === '' || role === null) return
    const visible = filterSourcesByRole(sources, role)
    const controller = new AbortController()
    const ctx = { role, organizationId, signal: controller.signal }

    void Promise.allSettled(visible.map((source) => source.search(debounced, ctx))).then((settled) => {
      if (controller.signal.aborted) return
      const entries = settled.map((outcome, index) => {
        const source = visible[index] as SearchSource
        return {
          source,
          items: outcome.status === 'fulfilled' ? rankResults(outcome.value, debounced) : [],
          failed: outcome.status === 'rejected' && !isAbort(outcome.reason),
        }
      })
      const failedCount = entries.filter((entry) => entry.failed).length
      setAnswer({
        key: `${debounced}#${attempt}`,
        groups: buildGroups(entries),
        failedCount,
        allFailed: entries.length > 0 && failedCount === entries.length,
      })
    })

    return () => controller.abort()
  }, [debounced, sources, role, organizationId, attempt])

  const retry = () => setAttempt((value) => value + 1)

  if (trimmed === '') return { status: 'idle', groups: [], failedCount: 0, retry }
  const current = answer !== null && answer.key === `${trimmed}#${attempt}` && debounced === trimmed
  if (!current || answer === null) {
    // On garde les résultats précédents à l'écran pendant que la nouvelle réponse arrive (pas de clignotement).
    return { status: 'loading', groups: answer?.groups ?? [], failedCount: 0, retry }
  }
  if (answer.allFailed) return { status: 'error', groups: [], failedCount: answer.failedCount, retry }
  return { status: 'ready', groups: answer.groups, failedCount: answer.failedCount, retry }
}
