import { useOrgMembers } from '../auth'

/** Tous les membres de l'organisation, retirés compris (le filtre d'affichage se fait dans la page). */
export function useTeamMembers(organizationId: string | undefined) {
  return useOrgMembers(organizationId)
}
