/**
 * Comptes de connexion des membres invités (clé service) : création du compte, lien de connexion
 * à usage unique, adresse de retour dans l'app. Utilisé par /api/members/invite et /api/members/link.
 */
import type { User } from '@supabase/supabase-js'
import { getOptionalEnv } from './env.js'
import { HttpError } from './http.js'
import { getSupabaseAdmin } from './supabaseAdmin.js'

/** Adresse de production de l'app web (Vercel). */
export const PRODUCTION_APP_ORIGIN = 'https://sordulo-os-app.vercel.app'
/** Serveur de développement Vite (`npm run dev`). */
export const DEV_APP_ORIGIN = 'http://localhost:5173'

function originOf(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/** Origines acceptées comme retour d'un lien de connexion. */
export function allowedAppOrigins(): string[] {
  const origins = new Set<string>([PRODUCTION_APP_ORIGIN])
  const configured = originOf(getOptionalEnv('APP_URL'))
  if (configured) origins.add(configured)
  if (process.env.NODE_ENV !== 'production') origins.add(DEV_APP_ORIGIN)
  return [...origins]
}

/**
 * Où le lien de connexion renvoie : l'en-tête Origin de la requête s'il fait partie des origines
 * autorisées (l'admin reste sur la même app), sinon APP_URL, sinon l'origine de l'API elle-même
 * (sur Vercel, l'API et l'app partagent le domaine). L'adresse doit aussi figurer dans les
 * « Redirect URLs » de Supabase Auth, sinon Supabase renvoie vers la Site URL.
 */
export function loginRedirectUrl(request: Request): string {
  const fromHeader = originOf(request.headers.get('origin'))
  if (fromHeader && allowedAppOrigins().includes(fromHeader)) return fromHeader
  return originOf(getOptionalEnv('APP_URL')) ?? new URL(request.url).origin
}

const USERS_PER_PAGE = 1000
const USERS_MAX_PAGES = 50

/**
 * Compte de connexion portant cet email, ou null. Lecture seule (aucun lien généré, aucun jeton
 * remplacé) : l'API Auth admin ne filtre pas par email, on parcourt donc les pages de comptes.
 */
export async function findAuthAccountByEmail(email: string): Promise<User | null> {
  const wanted = email.trim().toLowerCase()
  for (let page = 1; page <= USERS_MAX_PAGES; page++) {
    const { data, error } = await getSupabaseAdmin().auth.admin.listUsers({ page, perPage: USERS_PER_PAGE })
    if (error) throw new HttpError(502, `Lecture des comptes de connexion impossible : ${error.message}. Réessaie.`)
    const found = data.users.find((u) => u.email?.trim().toLowerCase() === wanted)
    if (found) return found
    if (data.users.length < USERS_PER_PAGE) return null
  }
  return null
}

/** Compte de connexion créé par cet appel (à supprimer si la suite échoue), ou null s'il existait. */
export interface EnsuredAccount {
  createdUserId: string | null
}

/** Crée le compte de connexion (email déjà confirmé) s'il n'existe pas encore. */
export async function ensureAuthAccount(email: string): Promise<EnsuredAccount> {
  const { data, error } = await getSupabaseAdmin().auth.admin.createUser({ email, email_confirm: true })
  if (!error) return { createdUserId: data.user?.id ?? null }
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return { createdUserId: null }
  throw new HttpError(502, `Création du compte de connexion impossible : ${error.message}. Réessaie.`)
}

/** Supprime un compte créé par cet appel quand la suite a échoué. Ne lève jamais (journalise). */
export async function deleteCreatedAccount(account: EnsuredAccount): Promise<void> {
  if (!account.createdUserId) return
  try {
    const { error } = await getSupabaseAdmin().auth.admin.deleteUser(account.createdUserId)
    if (error) console.error(`[members] compte ${account.createdUserId} non supprimé : ${error.message}`)
  } catch (error) {
    console.error(`[members] compte ${account.createdUserId} non supprimé`, error)
  }
}

export interface LoginLink {
  link: string
  user: User
}

/** Lien de connexion à usage unique (aucun email envoyé). Le compte doit exister. */
export async function generateLoginLink(email: string, redirectTo: string): Promise<LoginLink> {
  const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  })
  const link = data.properties?.action_link
  if (error || !link || !data.user) {
    throw new HttpError(502, `Génération du lien de connexion impossible : ${error?.message ?? 'réponse vide'}. Réessaie.`)
  }
  return { link, user: data.user }
}

/** Le compte s'est-il déjà connecté au moins une fois ? */
export function hasSignedIn(user: Pick<User, 'last_sign_in_at'>): boolean {
  return Boolean(user.last_sign_in_at)
}
