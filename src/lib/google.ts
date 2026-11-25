/**
 * Connecteurs Google (Agenda, Gmail) : connexions du compte Sordulo OS (table `google_connections`, migration
 * 0024 : une ligne par compte et par service, chaque compte ne lit que ses propres lignes). L'app Google
 * (Client ID + secret, client « Application de bureau ») est celle de l'agence, compilée dans l'app de bureau ;
 * l'app de bureau autorise le compte (OAuth PKCE, boucle locale) et le jeton de rafraîchissement est gardé
 * ici : la connexion suit le compte sur tous ses ordinateurs. Lecture seule : calendar.readonly, gmail.readonly.
 *
 * Utilisé par la page Connecteurs (connexion, déconnexion, « À reconnecter ») et par les sources « calendar »
 * et « gmail » de l'île (jeton d'accès demandé à Rust, puis appels REST de Google depuis le front).
 *
 * Le jeton n'est jamais écrit dans les journaux ni dans les messages d'erreur, et ne passe jamais dans une URL.
 */
import type { GoogleAuthorization, GoogleService } from '../shared/desktop-contract'
import { supabase } from './supabase'

export type { GoogleService }

export const GOOGLE_SERVICES: readonly GoogleService[] = ['calendar', 'gmail']

/** Ligne du compte pour un service, normalisée. */
export interface GoogleAccountConnection {
  service: GoogleService
  /** null : accès perdu (refusé par Google) : la carte affiche « À reconnecter ». */
  refreshToken: string | null
  /** Adresse du compte Google ; gardée quand l'accès est perdu. */
  account: string | null
  /** Gmail : les mails reçus avant cette date ne sont plus proposés (ISO). null : date de connexion. */
  cursorAt: string | null
  createdAt: string
  updatedAt: string
}

/** `none` (pas de ligne), `connected`, `lost` (accès perdu : il faut reconnecter). */
export type GoogleConnectionState = 'none' | 'connected' | 'lost'

export function googleConnectionState(row: GoogleAccountConnection | null): GoogleConnectionState {
  if (!row) return 'none'
  return row.refreshToken ? 'connected' : 'lost'
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function isService(value: unknown): value is GoogleService {
  return value === 'calendar' || value === 'gmail'
}

/** Ligne brute de Supabase → connexion, ou null si elle est inutilisable. */
export function normalizeGoogleConnection(raw: unknown): GoogleAccountConnection | null {
  if (!isObject(raw) || !isService(raw.service)) return null
  const createdAt = text(raw.created_at)
  const updatedAt = text(raw.updated_at)
  if (!createdAt || !updatedAt) return null
  return {
    service: raw.service,
    refreshToken: text(raw.refresh_token)?.trim() ?? null,
    account: text(raw.account),
    cursorAt: text(raw.cursor_at),
    createdAt,
    updatedAt,
  }
}

const COLUMNS = 'service, refresh_token, account, cursor_at, created_at, updated_at'

/** Ligne du compte connecté pour ce service (null : pas de ligne, ou pas connecté à Sordulo OS). */
export async function readGoogleConnection(service: GoogleService): Promise<GoogleAccountConnection | null> {
  const { data, error } = await supabase
    .from('google_connections')
    .select(COLUMNS)
    .eq('service', service)
    .maybeSingle()
  if (error) throw new Error('Impossible de lire la connexion Google du compte.')
  return normalizeGoogleConnection(data)
}

/** Les deux lignes du compte, par service. */
export async function readGoogleConnections(): Promise<Record<GoogleService, GoogleAccountConnection | null>> {
  const { data, error } = await supabase.from('google_connections').select(COLUMNS)
  if (error) throw new Error('Impossible de lire les connexions Google du compte.')
  const rows = (data ?? []).map(normalizeGoogleConnection)
  return {
    calendar: rows.find((r) => r?.service === 'calendar') ?? null,
    gmail: rows.find((r) => r?.service === 'gmail') ?? null,
  }
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('Connecte-toi à Sordulo OS pour connecter Google.')
  return data.user.id
}

/**
 * Enregistre une autorisation (après googleConnect). Gmail : le curseur repart de maintenant, les mails déjà
 * reçus ne sont pas proposés.
 */
export async function saveGoogleAuthorization(auth: GoogleAuthorization, now: Date = new Date()): Promise<void> {
  const userId = await currentUserId()
  const row: Json = {
    user_id: userId,
    service: auth.service,
    refresh_token: auth.refreshToken,
    account: auth.account,
  }
  if (auth.service === 'gmail') row.cursor_at = now.toISOString()
  const { error } = await supabase.from('google_connections').upsert(row, { onConflict: 'user_id,service' })
  if (error) throw new Error("Impossible d'enregistrer la connexion Google sur le compte.")
}

/** Google a refusé le jeton : on l'oublie, le compte reste affiché (« À reconnecter »). */
export async function markGoogleConnectionLost(service: GoogleService): Promise<void> {
  const { error } = await supabase.from('google_connections').update({ refresh_token: null }).eq('service', service)
  if (error) throw new Error('Impossible de mettre à jour la connexion Google du compte.')
}

/** Gmail : les mails reçus avant `at` ne seront plus proposés. */
export async function saveGmailCursor(at: Date): Promise<void> {
  const { error } = await supabase
    .from('google_connections')
    .update({ cursor_at: at.toISOString() })
    .eq('service', 'gmail')
  if (error) throw new Error('Impossible de mettre à jour la connexion Gmail du compte.')
}

/** Déconnexion : la ligne du service est supprimée. */
export async function deleteGoogleConnection(service: GoogleService): Promise<void> {
  const { error } = await supabase.from('google_connections').delete().eq('service', service)
  if (error) throw new Error('Impossible de supprimer la connexion Google du compte.')
}
