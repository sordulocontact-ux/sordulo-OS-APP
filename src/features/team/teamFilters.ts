import type { Member, MemberRole } from '../../shared/types'
import { memberStatus, type MemberStatus } from './teamLogic'

/** Filtre Rôle : '' = tous. */
export type RoleFilter = '' | MemberRole
/** Filtre Statut : '' = actifs et invités (les retirés restent masqués par défaut). */
export type TeamStatusFilter = '' | MemberStatus

export interface TeamFilters {
  query: string
  role: RoleFilter
  status: TeamStatusFilter
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Recherche sur nom et email (sans casse ni accents), puis rôle et statut. */
export function filterMembers<T extends Pick<Member, 'name' | 'email' | 'role' | 'removed_at' | 'invited_at' | 'user_id'>>(
  members: readonly T[],
  { query, role, status }: TeamFilters,
): T[] {
  const q = normalize(query)
  return members.filter((m) => {
    const current = memberStatus(m)
    if (status === '' ? current === 'removed' : current !== status) return false
    if (role !== '' && m.role !== role) return false
    if (!q) return true
    return normalize(m.name).includes(q) || normalize(m.email).includes(q)
  })
}

/** Nombre de filtres actifs (la recherche n'en fait pas partie). */
export function activeTeamFilterCount({ role, status }: Pick<TeamFilters, 'role' | 'status'>): number {
  return (role !== '' ? 1 : 0) + (status !== '' ? 1 : 0)
}
