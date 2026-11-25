/**
 * Droits par rôle, appliqués en code par chaque outil MCP et par la commande vocale (la clé service contourne
 * la RLS). Mêmes règles que CLAUDE.md « Rôles et droits » et que la RLS (migrations 0003, 0004, 0014).
 */
import type { MemberRole } from '../../../src/shared/types.js'

export const ACCESS = {
  /** Clients et projets en lecture (finance en lecture seule). */
  clients: ['admin', 'membre', 'finance'],
  projects: ['admin', 'membre', 'finance'],
  /** Tickets et tâches : lecture et écriture. */
  work: ['admin', 'membre'],
  /** Devis, factures et chiffres. */
  billing: ['admin', 'finance'],
  /** Prospects : admin et membre voient tout, l'apporteur (prospection) seulement les siens. */
  prospects: ['admin', 'membre', 'prospection'],
} as const satisfies Record<string, readonly MemberRole[]>

export type AccessArea = keyof typeof ACCESS

export function can(role: MemberRole, area: AccessArea): boolean {
  return (ACCESS[area] as readonly MemberRole[]).includes(role)
}

/** L'apporteur ne voit que les prospects dont il est responsable ou qu'il a créés. */
export function seesAllProspects(role: MemberRole): boolean {
  return role === 'admin' || role === 'membre'
}

export function ownsProspect(memberId: string, prospect: { owner_member_id: string | null; created_by: string | null }): boolean {
  return prospect.owner_member_id === memberId || prospect.created_by === memberId
}

/** Recherche sans accents ni casse. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

/** Vrai si tous les mots de la requête apparaissent dans l'un des champs. */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return false
  const haystack = normalizeSearch(fields.filter(Boolean).join(' '))
  return words.every((word) => haystack.includes(word))
}
