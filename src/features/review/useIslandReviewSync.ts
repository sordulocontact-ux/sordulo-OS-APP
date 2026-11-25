import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { listen } from '@tauri-apps/api/event'
import { currentWindowLabel, isDesktop } from '../../lib/desktop'
import { queryKeys } from '../../lib/queryKeys'
import { DESKTOP_WINDOWS } from '../../shared/desktop-contract'
import { REVIEW_CHANGED_EVENT, type ReviewChangedPayload } from './reviewSync'

/**
 * App de bureau, fenêtre principale : l'île a validé ou refusé des tickets (REVIEW_CHANGED_EVENT), on relit
 * les tickets de l'entrée, ceux du projet, ses tâches et ses entrées. Sans effet dans le navigateur.
 */
export function useIslandReviewSync(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!isDesktop() || currentWindowLabel() !== DESKTOP_WINDOWS.main) return
    let active = true
    let off: (() => void) | null = null
    listen<ReviewChangedPayload>(REVIEW_CHANGED_EVENT, ({ payload }) => {
      if (!active || !payload?.projectId || !payload.inputId) return
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.inputTickets(payload.inputId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tickets(payload.projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks(payload.projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inputs(payload.projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.input(payload.inputId) }),
      ])
    })
      .then((unlisten) => {
        if (active) off = unlisten
        else unlisten()
      })
      .catch(() => undefined)
    return () => {
      active = false
      off?.()
    }
  }, [queryClient])
}
