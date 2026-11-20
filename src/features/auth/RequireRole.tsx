import type { ReactNode } from 'react'
import type { MemberRole } from '../../shared/types'
import { EmptyState } from '../../components/ui'
import { useCurrentMember } from './useCurrentMember'

/**
 * Masque une page aux rôles non autorisés. Confort d'interface seulement : la protection réelle est
 * la RLS (écritures) côté base. Placé sous MemberGate, le membre est donc déjà chargé.
 */
export function RequireRole({ roles, children }: { roles: readonly MemberRole[]; children: ReactNode }) {
  const { member } = useCurrentMember()
  if (member && roles.includes(member.role)) return children
  if (member?.role === 'prospection') {
    return <EmptyState title="Ton espace arrive bientôt" text="L'espace prospection n'est pas encore disponible." />
  }
  return <EmptyState title="Accès réservé" text="Cette page est réservée aux administrateurs de l'organisation." />
}
