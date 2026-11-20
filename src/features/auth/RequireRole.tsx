import type { ReactNode } from 'react'
import type { MemberRole } from '../../shared/types'
import { EmptyState } from '../../components/ui'
import { useCurrentMember } from './useCurrentMember'

/**
 * Masque une page aux rôles non autorisés. Confort d'interface seulement : la protection réelle est
 * la RLS côté base. Placé sous MemberGate, le membre est donc déjà chargé.
 */
export function RequireRole({ roles, children }: { roles: readonly MemberRole[]; children: ReactNode }) {
  const { member } = useCurrentMember()
  if (member && roles.includes(member.role)) return children
  return <EmptyState title="Accès réservé" text="Ton rôle ne donne pas accès à cette page." />
}
