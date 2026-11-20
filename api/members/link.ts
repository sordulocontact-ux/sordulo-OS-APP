/**
 * POST /api/members/link { memberId } — réservé aux admins de l'organisation du membre.
 * Nouveau lien de connexion à usage unique pour un membre actif qui ne s'est encore jamais connecté
 * (lien d'invitation expiré ou perdu). Crée son compte de connexion s'il manque.
 * 409 si le membre est retiré, ou si son compte s'est déjà connecté : un admin ne doit pas pouvoir
 * obtenir un accès au compte d'un membre qui l'utilise.
 */
import type { User } from '@supabase/supabase-js'
import { z } from 'zod'
import type { MemberLinkRequest, MemberLinkResponse } from '../../src/shared/api-contract.js'
import type { Member } from '../../src/shared/types.js'
import { requireOrgAdmin, requireUser } from '../_lib/auth.js'
import { HttpError, json, readJsonBody, route } from '../_lib/http.js'
import { ensureAuthAccount, findAuthAccountByEmail, generateLoginLink, hasSignedIn, loginRedirectUrl } from '../_lib/members.js'
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'

const MemberLinkSchema = z.object({
  memberId: z.guid('Membre invalide.'),
}) satisfies z.ZodType<MemberLinkRequest>

function alreadySignedIn(member: Member): HttpError {
  return new HttpError(
    409,
    `${member.name} s'est déjà connecté : il se connecte avec son email (mot de passe ou lien reçu par email), aucun nouveau lien n'est généré.`,
  )
}

/** Compte relié au membre, ou null s'il n'est relié à aucun compte (ou si ce compte n'existe plus). */
async function linkedAccount(member: Member): Promise<User | null> {
  if (!member.user_id) return null
  const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(member.user_id)
  if (data.user) return data.user
  if (error && error.status !== 404) throw new Error(`Lecture du compte de connexion impossible : ${error.message}`)
  return null
}

export const POST = route(async (request) => {
  const { memberId } = await readJsonBody(request, MemberLinkSchema)
  const user = await requireUser(request)
  const admin = getSupabaseAdmin()

  const { data, error } = await admin.from('members').select('*').eq('id', memberId).maybeSingle()
  if (error) throw new Error(`Lecture du membre impossible : ${error.message}`)
  if (!data) throw new HttpError(404, 'Membre introuvable.')
  const member = data as Member
  await requireOrgAdmin(user, member.organization_id)
  if (member.removed_at) {
    throw new HttpError(409, `${member.name} a été retiré de l'organisation : réintègre-le depuis l'équipe d'abord.`)
  }

  // Contrôle « déjà connecté » AVANT toute génération (compte relié, sinon compte portant l'email),
  // puis de nouveau sur le compte que renvoie la génération (le lien n'est jamais renvoyé s'il a servi).
  const account = await linkedAccount(member)
  if (account && hasSignedIn(account)) throw alreadySignedIn(member)
  const email = account?.email ?? member.email.trim().toLowerCase()
  if (!account) {
    const existing = await findAuthAccountByEmail(email)
    if (existing && hasSignedIn(existing)) throw alreadySignedIn(member)
    if (!existing) await ensureAuthAccount(email)
  }

  const generated = await generateLoginLink(email, loginRedirectUrl(request))
  if (hasSignedIn(generated.user)) throw alreadySignedIn(member)

  if (!member.user_id) {
    const linked = await admin
      .from('members')
      .update({ user_id: generated.user.id })
      .eq('id', member.id)
      .is('user_id', null)
    // Pas bloquant : claim_membership relie aussi le compte à la première connexion.
    if (linked.error) console.error(`[members] membre ${member.id} non relié à son compte : ${linked.error.message}`)
  }
  console.log(`[members] nouveau lien de connexion pour le membre ${member.id}`)

  return json(200, { link: generated.link } satisfies MemberLinkResponse)
})
