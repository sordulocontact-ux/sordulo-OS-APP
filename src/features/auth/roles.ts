import type { MemberRole } from '../../shared/types'
import { useCurrentMember } from './useCurrentMember'

/** Tous les rôles : l'Accueil s'adapte au rôle. */
export const ALL_ROLES: readonly MemberRole[] = ['admin', 'membre', 'prospection', 'finance']
/** Travaillent sur les projets (entrées, tickets, tâches) et écrivent clients et projets. */
export const PROJECT_ROLES: readonly MemberRole[] = ['admin', 'membre']
/** Lisent la liste des projets et les clients (finance en lecture seule, la RLS l'impose). */
export const CLIENT_READ_ROLES: readonly MemberRole[] = ['admin', 'membre', 'finance']
/** Devis, factures et chiffres. */
export const FINANCE_ROLES: readonly MemberRole[] = ['admin', 'finance']
/** Prospection. */
export const PROSPECT_ROLES: readonly MemberRole[] = ['admin', 'prospection']
/** Équipe et Paramètres. */
export const ADMIN_ROLES: readonly MemberRole[] = ['admin']

/** Vrai si le membre connecté a l'un des rôles. */
export function useHasRole(roles: readonly MemberRole[]): boolean {
  const { member } = useCurrentMember()
  return member !== null && roles.includes(member.role)
}
