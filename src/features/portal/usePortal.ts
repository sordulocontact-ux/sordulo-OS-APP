import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PortalApiError, fetchPortal, postPortalAction } from './portalApi'
import type { PortalActionRequest } from './portalContract'

export const portalKeys = {
  portal: (token: string) => ['portal', token] as const,
}

/** Les liens de fichiers signés durent 10 minutes : on relit le portail au retour sur l'onglet après 8 minutes. */
const STALE_MS = 8 * 60 * 1000

export function usePortal(token: string) {
  return useQuery({
    queryKey: portalKeys.portal(token),
    queryFn: () => fetchPortal(token),
    staleTime: STALE_MS,
    refetchOnWindowFocus: true,
    // Lien invalide (404) ou trop de requêtes (429) : inutile d'insister.
    retry: (count, error) => !(error instanceof PortalApiError && [400, 404, 429].includes(error.status)) && count < 2,
  })
}

/** Action du client (le jeton est ajouté ici), puis relecture du portail. */
export function usePortalAction(token: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: DistributiveOmit<PortalActionRequest, 'token'>) =>
      postPortalAction({ ...body, token } as PortalActionRequest),
    onSettled: () => queryClient.invalidateQueries({ queryKey: portalKeys.portal(token) }),
  })
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export function portalErrorText(error: unknown): string {
  if (error instanceof PortalApiError) return error.message
  return 'Une erreur est survenue. Réessayez dans un instant.'
}
