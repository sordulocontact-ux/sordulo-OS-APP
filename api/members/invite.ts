/**
 * POST /api/members/invite { organizationId, name, email, role } — réservé aux admins de l'organisation.
 * Crée le compte de connexion s'il n'existe pas, génère un lien de connexion à usage unique, puis
 * ajoute le membre (déjà relié au compte) et renvoie 201 { member, link }. Aucun email n'est envoyé.
 * Si l'email a déjà un compte qui s'est connecté, le membre est relié à ce compte et link vaut null :
 * il se connecte comme d'habitude (un admin n'obtient jamais de lien vers un compte déjà utilisé).
 *
 * Ordre choisi pour ne jamais laisser d'état bancal : le membre est inséré EN DERNIER. Si la création
 * du compte ou du lien échoue, aucun membre n'existe (l'admin relance simplement l'invitation) et le
 * compte créé par cet appel est supprimé. Si l'insertion échoue, ce compte est supprimé aussi et le
 * lien n'est jamais renvoyé.
 * 409 : email déjà dans l'organisation (actif ou retiré).
 */
import { z } from 'zod'
import type { InviteMemberRequest, InviteMemberResponse } from '../../src/shared/api-contract.js'
import { MEMBER_ROLES, type Member } from '../../src/shared/types.js'
import { requireOrgAdmin, requireUser } from '../_lib/auth.js'
import { HttpError, json, readJsonBody, route } from '../_lib/http.js'
import {
  deleteCreatedAccount,
  ensureAuthAccount,
  findAuthAccountByEmail,
  generateLoginLink,
  hasSignedIn,
  loginRedirectUrl,
  type EnsuredAccount,
} from '../_lib/members.js'
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'

/** Violation d'unicité Postgres (members_org_email_key, members_org_user_key). */
const UNIQUE_VIOLATION = '23505'

const InviteMemberSchema = z.object({
  organizationId: z.guid('Organisation invalide.'),
  name: z.string().trim().min(1, 'Le nom est obligatoire.').max(120, 'Le nom dépasse 120 caractères.'),
  email: z.string().trim().toLowerCase().pipe(z.email('Email invalide.')),
  role: z.enum(MEMBER_ROLES, 'Rôle invalide.'),
}) satisfies z.ZodType<InviteMemberRequest>

export const POST = route(async (request) => {
  const body = await readJsonBody(request, InviteMemberSchema)
  const user = await requireUser(request)
  await requireOrgAdmin(user, body.organizationId)
  const admin = getSupabaseAdmin()

  // Comparé dans le code (pas avec ilike) pour que « _ » ou « % » ne soient pas des jokers.
  const existing = await admin
    .from('members')
    .select('id, email, removed_at')
    .eq('organization_id', body.organizationId)
  if (existing.error) throw new Error(`Lecture des membres impossible : ${existing.error.message}`)
  const duplicate = ((existing.data as Pick<Member, 'id' | 'email' | 'removed_at'>[] | null) ?? []).find(
    (m) => m.email.trim().toLowerCase() === body.email,
  )
  if (duplicate?.removed_at) {
    throw new HttpError(409, `${body.email} est un membre retiré : réintègre-le depuis l'équipe.`)
  }
  if (duplicate) throw new HttpError(409, `${body.email} fait déjà partie de l'équipe.`)

  // Compte déjà utilisé : le membre y est relié, sans lien (un admin n'obtient jamais d'accès au compte
  // existant de quelqu'un d'autre). Sinon : compte créé si besoin, puis lien à usage unique.
  const existingAccount = await findAuthAccountByEmail(body.email)
  let account: EnsuredAccount = { createdUserId: null }
  let link: string | null = null
  let authUserId: string
  if (existingAccount && hasSignedIn(existingAccount)) {
    authUserId = existingAccount.id
  } else {
    if (!existingAccount) account = await ensureAuthAccount(body.email)
    try {
      const generated = await generateLoginLink(body.email, loginRedirectUrl(request))
      authUserId = generated.user.id
      // Connexion survenue entre la lecture et la génération : le lien n'est pas renvoyé.
      link = hasSignedIn(generated.user) ? null : generated.link
    } catch (error) {
      await deleteCreatedAccount(account)
      throw error
    }
  }

  const inserted = await admin
    .from('members')
    .insert({
      organization_id: body.organizationId,
      name: body.name,
      email: body.email,
      role: body.role,
      skills: {},
      user_id: authUserId,
      invited_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (inserted.error || !inserted.data) {
    await deleteCreatedAccount(account)
    if (inserted.error?.code === UNIQUE_VIOLATION) {
      throw new HttpError(409, `${body.email} fait déjà partie de l'équipe.`)
    }
    throw new Error(`Ajout du membre impossible : ${inserted.error?.message ?? 'réponse vide'}`)
  }
  const member = inserted.data as Member
  console.log(`[members] membre ${member.id} invité dans ${member.organization_id} (compte ${account.createdUserId ? 'créé' : 'existant'}${link ? '' : ', sans lien'})`)

  return json(201, { member, link } satisfies InviteMemberResponse)
})

export { OPTIONS } from '../_lib/cors.js'
