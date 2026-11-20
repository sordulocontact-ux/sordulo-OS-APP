import type { MemberRole } from '../../shared/types'
import { useCurrentMember } from './useCurrentMember'

/** Rôles qui travaillent sur les clients et les projets. Prospection aura son propre espace plus tard. */
export const PROJECT_ROLES: readonly MemberRole[] = ['admin', 'membre']
export const ADMIN_ROLES: readonly MemberRole[] = ['admin']

/** Vrai si le membre connecté a l'un des rôles. */
export function useHasRole(roles: readonly MemberRole[]): boolean {
  const { member } = useCurrentMember()
  return member !== null && roles.includes(member.role)
}
