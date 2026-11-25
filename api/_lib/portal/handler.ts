/**
 * Portail client public : GET (lecture) et POST (actions), sans session.
 * Ordre des contrôles : limitation de débit par adresse, format du jeton (avant toute requête),
 * limitation par jeton et adresse, projet retrouvé par son jeton (clé service), puis validation.
 * Un jeton mal formé, inconnu ou désactivé donne la même réponse 404 (aucun indice).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { todayIso } from '../../../src/shared/billing.js'
import { PORTAL_TOKEN_PATTERN } from '../../../src/features/portal/portalContract.js'
import { HttpError, formatZodIssues, json } from '../http.js'
import { runPortalAction } from './actions.js'
import { clientIp, createRateLimiter } from './rateLimit.js'
import { portalActionSchema } from './schemas.js'
import { findProjectByToken, loadPortalView, type PortalProjectRow } from './view.js'

export interface PortalDeps {
  /** Appelé seulement une fois le format du jeton vérifié. */
  admin: () => SupabaseClient
  now?: () => Date
}

export const INVALID_LINK_MESSAGE = 'Ce lien n’est pas valide ou a été désactivé. Demandez un nouveau lien à l’agence.'
const TOO_MANY_MESSAGE = 'Trop de requêtes. Patientez une minute avant de réessayer.'

/** Limites par instance (voir rateLimit.ts) : toutes les requêtes d'une adresse, puis par jeton et adresse. */
const ipLimiter = createRateLimiter({ limit: 240, windowMs: 60_000 })
const readLimiter = createRateLimiter({ limit: 90, windowMs: 60_000 })
const actionLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 })

/** Tests seulement. */
export function resetPortalRateLimits(): void {
  ipLimiter.reset()
  readLimiter.reset()
  actionLimiter.reset()
}

const frenchErrors = z.locales.fr()

function portalJson(status: number, body: unknown): Response {
  const response = json(status, body)
  response.headers.set('x-robots-tag', 'noindex, nofollow')
  response.headers.set('referrer-policy', 'no-referrer')
  return response
}

function checkToken(request: Request, token: unknown, limiter: typeof readLimiter): string {
  const ip = clientIp(request)
  if (!ipLimiter.take(ip)) throw new HttpError(429, TOO_MANY_MESSAGE)
  if (typeof token !== 'string' || !PORTAL_TOKEN_PATTERN.test(token)) throw new HttpError(404, INVALID_LINK_MESSAGE)
  if (!limiter.take(`${token}|${ip}`)) throw new HttpError(429, TOO_MANY_MESSAGE)
  return token
}

async function projectFor(admin: SupabaseClient, token: string): Promise<PortalProjectRow> {
  const project = await findProjectByToken(admin, token)
  if (!project) throw new HttpError(404, INVALID_LINK_MESSAGE)
  return project
}

export async function handlePortalGet(request: Request, deps: PortalDeps): Promise<Response> {
  const token = checkToken(request, new URL(request.url).searchParams.get('token'), readLimiter)
  const admin = deps.admin()
  const project = await projectFor(admin, token)
  const today = todayIso(deps.now?.() ?? new Date())
  return portalJson(200, await loadPortalView(admin, project, today))
}

export async function handlePortalPost(request: Request, deps: PortalDeps): Promise<Response> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new HttpError(400, 'Requête invalide : le corps doit être du JSON.')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Requête invalide : objet JSON attendu.')
  const token = checkToken(request, (raw as Record<string, unknown>).token, actionLimiter)

  const parsed = portalActionSchema.safeParse(raw, { error: frenchErrors.localeError })
  if (!parsed.success) throw new HttpError(400, `Requête invalide : ${formatZodIssues(parsed.error)}`)

  const admin = deps.admin()
  const project = await projectFor(admin, token)
  const now = deps.now?.() ?? new Date()
  const result = await runPortalAction({ admin, project, now, today: todayIso(now) }, parsed.data)
  return portalJson(200, result)
}
