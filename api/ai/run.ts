/**
 * POST /api/ai/run { action, ...données }
 * Seule fonction serveur des actions IA (offre gratuite de Vercel : 12 fonctions au plus). `action` choisit
 * le module dans api/_lib/ai/registry.ts ; le reste du corps est validé par le schéma de l'action, qui
 * vérifie elle-même les droits sur l'objet visé (ctx.requireMember). 400 action inconnue ou corps invalide,
 * 401 sans session, 403 sans droit, 501 action pas encore codée.
 */
import { isAiActionName } from '../../src/shared/ai-actions.js'
import type { MemberRole } from '../../src/shared/types.js'
import { AI_ACTION_REGISTRY } from '../_lib/ai/registry.js'
import { requireOrgMember, requireUser } from '../_lib/auth.js'
import { HttpError, formatZodIssues, json, route } from '../_lib/http.js'
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js'
import { z } from 'zod'

const frenchErrors = z.locales.fr()

export const POST = route(async (request) => {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new HttpError(400, 'Requête invalide : le corps doit être du JSON.')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Requête invalide : objet JSON attendu.')
  const { action, ...rest } = raw as Record<string, unknown>
  if (!isAiActionName(action)) throw new HttpError(400, 'Requête invalide : action inconnue.')

  const user = await requireUser(request)
  const handler = AI_ACTION_REGISTRY[action]
  const parsed = handler.schema.safeParse(rest, { error: frenchErrors.localeError })
  if (!parsed.success) throw new HttpError(400, `Requête invalide : ${formatZodIssues(parsed.error)}`)

  const admin = getSupabaseAdmin()
  const requireMember = async (organizationId: string, roles?: readonly MemberRole[]) => {
    const member = await requireOrgMember(user, organizationId)
    if (roles && !roles.includes(member.role)) throw new HttpError(403, 'Accès refusé : ton rôle ne permet pas cette action.')
    return member
  }
  const result = await handler.run({ body: parsed.data, user, admin, requireMember, request })
  return json(200, result)
})
