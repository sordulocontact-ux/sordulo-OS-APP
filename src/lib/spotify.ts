/**
 * Connecteur Spotify : connexion du compte Sordulo OS (table `spotify_connections`, migration 0009 : chaque
 * compte ne lit que sa propre ligne). Chacun crée son app sur developer.spotify.com et colle son Client ID
 * dans la carte Spotify ; l'app de bureau autorise le compte (OAuth PKCE, sans secret) et le jeton de
 * rafraîchissement est gardé ici : la connexion suit le compte sur tous ses ordinateurs.
 *
 * Utilisé par la page Connecteurs (Client ID, connexion, déconnexion) et par la source « spotify » de l'île
 * (relecture de la ligne, envoi à Rust, rotation du jeton). Les réponses de Supabase sont normalisées ici
 * par des fonctions pures testées.
 *
 * Le jeton n'est jamais écrit dans les journaux ni dans les messages d'erreur, et ne passe jamais dans une
 * URL (pas de filtre sur le jeton : le remplacement conditionnel passe par une fonction SQL, corps POST).
 */
import type { SpotifyAuthorization, SpotifyConnection } from '../shared/desktop-contract'
import { supabase } from './supabase'

/** Tableau de bord Spotify où l'on crée son app et copie son Client ID. */
export const SPOTIFY_DASHBOARD_URL = 'https://developer.spotify.com/dashboard'
/** Adresse de redirection à déclarer dans l'app Spotify (serveur local de l'app de bureau). */
export const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:43127/callback'

/** Ligne du compte, normalisée. */
export interface SpotifyAccountConnection {
  clientId: string
  /** null : compte pas encore autorisé, ou accès perdu. */
  refreshToken: string | null
  /** Nom affiché du compte Spotify ; gardé quand l'accès est perdu (« À reconnecter »). */
  account: string | null
  premium: boolean
  updatedAt: string
}

/**
 * État de la connexion d'après la ligne : `none` (pas de ligne), `clientId` (Client ID enregistré, compte
 * pas encore autorisé), `connected`, `lost` (accès perdu : il faut reconnecter).
 */
export type SpotifyConnectionState = 'none' | 'clientId' | 'connected' | 'lost'

export function spotifyConnectionState(row: SpotifyAccountConnection | null): SpotifyConnectionState {
  if (!row) return 'none'
  if (row.refreshToken) return 'connected'
  return row.account ? 'lost' : 'clientId'
}

/** Client ID collé : espaces retirés autour. */
export function cleanSpotifyClientId(raw: string): string {
  return raw.trim()
}

/** Même règle que la table et l'app de bureau : alphanumérique, 64 caractères au plus (32 hexadécimaux en pratique). */
export function isValidSpotifyClientId(clientId: string): boolean {
  return /^[A-Za-z0-9]{1,64}$/.test(clientId)
}

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** Ligne brute de Supabase → connexion ; null si inutilisable (pas de Client ID valide). */
export function normalizeSpotifyConnection(raw: unknown): SpotifyAccountConnection | null {
  if (!isObject(raw)) return null
  const clientId = str(raw.client_id)
  if (!clientId || !isValidSpotifyClientId(clientId)) return null
  return {
    clientId,
    refreshToken: str(raw.refresh_token),
    account: str(raw.account),
    premium: raw.premium === true,
    updatedAt: str(raw.updated_at) ?? '',
  }
}

/** Ce que l'app de bureau reçoit (`spotifySetConnection`) : seulement avec un jeton. */
export function desktopConnectionOf(row: SpotifyAccountConnection | null): SpotifyConnection | null {
  if (!row?.refreshToken) return null
  return { clientId: row.clientId, refreshToken: row.refreshToken, account: row.account, premium: row.premium }
}

/** Message d'erreur sans aucun des jetons donnés (au cas où une erreur reprendrait une valeur envoyée). */
export function withoutSecrets(message: string, secrets: readonly (string | null | undefined)[]): string {
  return secrets.reduce<string>((text, secret) => (secret ? text.split(secret).join('<masqué>') : text), message)
}

const COLUMNS = 'client_id, refresh_token, account, premium, updated_at'

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

/** Connexion Spotify du compte connecté, ou null s'il n'en a pas. */
export async function readSpotifyConnection(): Promise<SpotifyAccountConnection | null> {
  const { data, error } = await supabase.from('spotify_connections').select(COLUMNS).maybeSingle()
  if (error) throw new Error(`Connexion Spotify illisible : ${error.message}`)
  return normalizeSpotifyConnection(data)
}

/**
 * Enregistre le Client ID du compte connecté. Même Client ID : rien ne change ; autre Client ID : l'ancien
 * jeton est oublié par la base (il ne vaut que pour le Client ID qui l'a obtenu).
 */
export async function saveSpotifyClientId(clientId: string): Promise<void> {
  const id = cleanSpotifyClientId(clientId)
  if (!isValidSpotifyClientId(id)) throw new Error('Client ID Spotify invalide.')
  const userId = await currentUserId()
  if (!userId) throw new Error('Connectez-vous à Sordulo OS pour relier Spotify.')
  const { error } = await supabase
    .from('spotify_connections')
    .upsert({ user_id: userId, client_id: id }, { onConflict: 'user_id' })
  if (error) throw new Error(`Client ID Spotify non enregistré : ${error.message}`)
}

/** Enregistre l'autorisation faite par l'app de bureau (`spotifyConnect`) et renvoie la ligne enregistrée. */
export async function saveSpotifyAuthorization(
  clientId: string,
  authorization: SpotifyAuthorization,
): Promise<SpotifyAccountConnection> {
  const userId = await currentUserId()
  if (!userId) throw new Error('Connectez-vous à Sordulo OS pour relier Spotify.')
  const { data, error } = await supabase
    .from('spotify_connections')
    .upsert(
      {
        user_id: userId,
        client_id: cleanSpotifyClientId(clientId),
        refresh_token: authorization.refreshToken,
        account: authorization.account,
        premium: authorization.premium,
      },
      { onConflict: 'user_id' },
    )
    .select(COLUMNS)
    .single()
  if (error) {
    throw new Error(`Connexion Spotify non enregistrée : ${withoutSecrets(error.message, [authorization.refreshToken])}`)
  }
  const row = normalizeSpotifyConnection(data)
  if (!row) throw new Error('Connexion Spotify enregistrée mais illisible.')
  return row
}

/**
 * Remplace le jeton du compte s'il vaut encore `previous` (rotation par Spotify, ou `next` null : accès
 * perdu). Vrai si la ligne a changé ; faux si un autre ordinateur l'a déjà remplacé.
 */
export async function replaceSpotifyRefreshToken(previous: string, next: string | null): Promise<boolean> {
  const { data, error } = await supabase.rpc('spotify_replace_refresh_token', { previous, next })
  if (error) throw new Error(`Jeton Spotify non enregistré : ${withoutSecrets(error.message, [previous, next])}`)
  return data === true
}

/** Reporte sur le compte le nom et Premium relus chez Spotify par l'app de bureau. */
export async function saveSpotifyProfile(account: string | null, premium: boolean): Promise<void> {
  const userId = await currentUserId()
  if (!userId) return
  const { error } = await supabase.from('spotify_connections').update({ account, premium }).eq('user_id', userId)
  if (error) throw new Error(`Compte Spotify non mis à jour : ${error.message}`)
}

/** Déconnexion : jeton et compte oubliés ; le Client ID reste pour reconnecter sans repasser par Spotify. */
export async function forgetSpotifyAccount(): Promise<void> {
  const userId = await currentUserId()
  if (!userId) return
  const { error } = await supabase
    .from('spotify_connections')
    .update({ refresh_token: null, account: null, premium: false })
    .eq('user_id', userId)
  if (error) throw new Error(`Déconnexion de Spotify impossible : ${error.message}`)
}
