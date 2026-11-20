/** Authentication and organization membership checks for the /api functions. */
import type { Member } from '../../src/shared/types.js'
import { HttpError } from './http.js'
import { getSupabaseAdmin } from './supabaseAdmin.js'

export interface AuthUser {
  id: string
  email: string | null
}

/** Checks `Authorization: Bearer <supabase access token>`. Throws HttpError(401). */
export async function requireUser(request: Request): Promise<AuthUser> {
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  if (!match?.[1]) throw new HttpError(401, 'Connexion requise : reconnecte-toi.')
  const { data, error } = await getSupabaseAdmin().auth.getUser(match[1])
  if (error || !data.user) throw new HttpError(401, 'Session invalide ou expirée : reconnecte-toi.')
  return { id: data.user.id, email: data.user.email ?? null }
}

/**
 * Returns the active member of `organizationId` linked to the user, or throws HttpError(403).
 * If no member is linked yet but an active member of this organization has the user's email
 * and no user_id, it is linked now (first login). A removed member (`removed_at` set) is never
 * returned nor linked: he no longer has access.
 */
export async function requireOrgMember(user: AuthUser, organizationId: string): Promise<Member> {
  const admin = getSupabaseAdmin()
  const linked = await admin
    .from('members')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .is('removed_at', null)
    .limit(1)
    .maybeSingle()
  if (linked.error) throw new Error(`Lecture des membres impossible : ${linked.error.message}`)
  if (linked.data) return linked.data as Member

  const forbidden = new HttpError(403, "Accès refusé : tu n'es pas membre de cette organisation.")
  const email = user.email?.trim().toLowerCase()
  if (!email) throw forbidden

  // Compared in code (not with ilike) so that "_" or "%" in an email are not wildcards.
  const unlinked = await admin
    .from('members')
    .select('*')
    .eq('organization_id', organizationId)
    .is('user_id', null)
    .is('removed_at', null)
  if (unlinked.error) throw new Error(`Lecture des membres impossible : ${unlinked.error.message}`)
  const candidate = (unlinked.data as Member[]).find((m) => m.email.trim().toLowerCase() === email)
  if (!candidate) throw forbidden

  const claimed = await admin
    .from('members')
    .update({ user_id: user.id })
    .eq('id', candidate.id)
    .is('user_id', null)
    .is('removed_at', null)
    .select('*')
    .maybeSingle()
  if (claimed.error) throw new Error(`Liaison du compte impossible : ${claimed.error.message}`)
  if (!claimed.data) throw forbidden
  console.log(`[auth] compte lié au membre ${candidate.id}`)
  return claimed.data as Member
}

/** Like requireOrgMember, but the member must also be an admin of the organization. Throws HttpError(403). */
export async function requireOrgAdmin(user: AuthUser, organizationId: string): Promise<Member> {
  const member = await requireOrgMember(user, organizationId)
  if (member.role !== 'admin') throw new HttpError(403, "Accès refusé : réservé aux admins de l'organisation.")
  return member
}
