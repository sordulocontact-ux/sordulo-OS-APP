/**
 * Connecteur Vercel : accès à l'API REST de Vercel (https://api.vercel.com, CORS ouvert : appelée
 * directement depuis le navigateur et la fenêtre de l'île) et au jeton du compte (table
 * `vercel_connections`, migration 0008 : chaque compte ne lit que sa propre ligne).
 *
 * Utilisé par la page Connecteurs (connexion, déconnexion) et par la source « déploiements » de l'île
 * (sondage des déploiements de production). Les réponses de Vercel sont normalisées ici, par des
 * fonctions pures testées : le reste du code ne voit jamais le JSON brut.
 *
 * Le jeton n'est jamais écrit dans les journaux ni dans les messages d'erreur.
 */
import { supabase } from './supabase'

const API = 'https://api.vercel.com'

/** Page de Vercel où l'on crée un jeton d'accès. */
export const VERCEL_TOKENS_URL = 'https://vercel.com/account/settings/tokens'

export type VercelDeploymentState = 'QUEUED' | 'INITIALIZING' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED'

const STATES: readonly VercelDeploymentState[] = ['QUEUED', 'INITIALIZING', 'BUILDING', 'READY', 'ERROR', 'CANCELED']

/** Déploiement de production, normalisé. Dates en epoch ms. */
export interface VercelDeployment {
  /** uid Vercel (`dpl_…`). */
  id: string
  projectId: string | null
  /** Nom du projet Vercel (« sordulo-os-app »). */
  projectName: string
  /** URL unique du déploiement, avec https://. */
  url: string
  /** Page du déploiement dans le tableau de bord Vercel (logs) ; null si Vercel ne la donne pas. */
  inspectorUrl: string | null
  state: VercelDeploymentState
  createdAt: number
  /** Début de la construction ; null tant qu'elle n'a pas commencé. */
  buildingAt: number | null
  /** Fin (en ligne, échec ou annulation) ; null tant que ce n'est pas fini. */
  readyAt: number | null
  /** Branche Git (`meta.githubCommitRef`, ou GitLab / Bitbucket) ; null : déploiement sans Git (CLI). */
  branch: string | null
  /** Première ligne du message du commit ; null sans Git. */
  commitMessage: string | null
  /** Équipe Vercel du déploiement (paramètre `teamId` des appels suivants) ; null : compte personnel. */
  teamId: string | null
}

export interface VercelAccount {
  id: string
  /** Identifiant Vercel (`username`), affiché dans la carte du connecteur. */
  username: string
  name: string | null
}

export interface VercelTeam {
  id: string
  slug: string
  name: string | null
}

/** Erreur de l'API Vercel. `unauthorized` : jeton refusé, expiré ou révoqué (il faut le remplacer). */
export class VercelApiError extends Error {
  readonly status: number
  readonly unauthorized: boolean
  constructor(status: number, message: string, unauthorized: boolean) {
    super(message)
    this.name = 'VercelApiError'
    this.status = status
    this.unauthorized = unauthorized
  }
}

/** Le déploiement n'est pas encore fini (file d'attente, préparation, construction). */
export function isDeploymentActive(state: VercelDeploymentState): boolean {
  return state === 'QUEUED' || state === 'INITIALIZING' || state === 'BUILDING'
}

// ---------------------------------------------------------------------------
// Normalisation (pure)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function withHttps(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

function firstLine(text: string | null): string | null {
  const line = text?.split(/\r?\n/, 1)[0]?.trim()
  return line ? line : null
}

/** Déploiement de la liste `/v6/deployments` ; null si l'objet est inutilisable. */
export function normalizeDeployment(raw: unknown, teamId: string | null): VercelDeployment | null {
  if (!isObject(raw)) return null
  const id = str(raw.uid) ?? str(raw.id)
  const url = str(raw.url)
  const rawState = str(raw.readyState) ?? str(raw.state)
  const state = STATES.find((s) => s === rawState?.toUpperCase())
  const createdAt = num(raw.createdAt) ?? num(raw.created)
  if (!id || !url || !state || !createdAt) return null
  const meta = isObject(raw.meta) ? raw.meta : {}
  return {
    id,
    projectId: str(raw.projectId),
    projectName: str(raw.name) ?? url,
    url: withHttps(url),
    inspectorUrl: str(raw.inspectorUrl),
    state,
    createdAt,
    buildingAt: num(raw.buildingAt),
    readyAt: num(raw.ready),
    branch: str(meta.githubCommitRef) ?? str(meta.gitlabCommitRef) ?? str(meta.bitbucketCommitRef),
    commitMessage: firstLine(
      str(meta.githubCommitMessage) ?? str(meta.gitlabCommitMessage) ?? str(meta.bitbucketCommitMessage),
    ),
    teamId,
  }
}

/** Réponse de `/v6/deployments` → déploiements valides, du plus récent au plus ancien. */
export function normalizeDeployments(body: unknown, teamId: string | null): VercelDeployment[] {
  const list = isObject(body) && Array.isArray(body.deployments) ? body.deployments : []
  return list
    .map((raw) => normalizeDeployment(raw, teamId))
    .filter((d): d is VercelDeployment => d !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Réponse de `/v2/user` → compte ; null si la forme est inattendue. */
export function normalizeAccount(body: unknown): VercelAccount | null {
  const user = isObject(body) && isObject(body.user) ? body.user : null
  const id = user ? (str(user.id) ?? str(user.uid)) : null
  const username = user ? str(user.username) : null
  if (!user || !id || !username) return null
  return { id, username, name: str(user.name) }
}

/** Réponse de `/v2/teams` → équipes. */
export function normalizeTeams(body: unknown): VercelTeam[] {
  const list = isObject(body) && Array.isArray(body.teams) ? body.teams : []
  return list.flatMap((raw) => {
    if (!isObject(raw)) return []
    const id = str(raw.id)
    const slug = str(raw.slug)
    return id && slug ? [{ id, slug, name: str(raw.name) }] : []
  })
}

/**
 * Réponse de `/v13/deployments/:id` → adresse de production à ouvrir (premier alias, ex.
 * « https://sordulo-os-app.vercel.app ») ; null si le déploiement n'a pas d'alias.
 */
export function productionUrlOf(body: unknown): string | null {
  const aliases = isObject(body) && Array.isArray(body.alias) ? body.alias : []
  const alias = aliases.map(str).find((a): a is string => a !== null)
  return alias ? withHttps(alias) : null
}

// ---------------------------------------------------------------------------
// Appels à l'API Vercel
// ---------------------------------------------------------------------------

async function get(token: string, path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new VercelApiError(0, 'Vercel ne répond pas. Vérifiez la connexion internet.', false)
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.ok) return body
  const error = isObject(body) && isObject(body.error) ? body.error : {}
  // Jeton inconnu, expiré ou révoqué : 401, ou 403 avec `invalidToken` (vérifié sur l'API le 23/11/2026).
  const unauthorized = response.status === 401 || (response.status === 403 && error.invalidToken === true)
  const message = unauthorized
    ? 'Vercel refuse ce jeton : il est invalide, expiré ou révoqué.'
    : `Vercel a répondu ${response.status}${str(error.message) ? ` : ${String(error.message)}` : ''}.`
  throw new VercelApiError(response.status, message, unauthorized)
}

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined) search.set(key, String(value))
  const text = search.toString()
  return text ? `?${text}` : ''
}

/** Compte du jeton : sert à vérifier un jeton collé et à afficher le nom du compte. */
export async function fetchVercelAccount(token: string, signal?: AbortSignal): Promise<VercelAccount> {
  const account = normalizeAccount(await get(token, '/v2/user', signal))
  if (!account) throw new VercelApiError(200, 'Réponse de Vercel inattendue pour le compte.', false)
  return account
}

/** Équipes visibles par le jeton (un jeton limité à une équipe n'en voit qu'une). */
export async function fetchVercelTeams(token: string, signal?: AbortSignal): Promise<VercelTeam[]> {
  return normalizeTeams(await get(token, `/v2/teams${query({ limit: 50 })}`, signal))
}

/** Derniers déploiements de PRODUCTION d'une équipe (`teamId`) ou du compte personnel (null). */
export async function fetchProductionDeployments(
  token: string,
  teamId: string | null,
  limit = 20,
  signal?: AbortSignal,
): Promise<VercelDeployment[]> {
  const body = await get(token, `/v6/deployments${query({ target: 'production', limit, teamId })}`, signal)
  return normalizeDeployments(body, teamId)
}

/** Adresse de production d'un déploiement en ligne (premier alias), ou null. */
export async function fetchProductionUrl(
  token: string,
  deploymentId: string,
  teamId: string | null,
  signal?: AbortSignal,
): Promise<string | null> {
  return productionUrlOf(await get(token, `/v13/deployments/${encodeURIComponent(deploymentId)}${query({ teamId })}`, signal))
}

// ---------------------------------------------------------------------------
// Jeton du compte (Supabase, table vercel_connections)
// ---------------------------------------------------------------------------

export interface VercelConnection {
  token: string
  /** Nom du compte Vercel enregistré à la connexion. */
  account: string | null
  updatedAt: string
}

/** Connexion Vercel du compte connecté, ou null s'il n'en a pas. */
export async function readVercelConnection(): Promise<VercelConnection | null> {
  const { data, error } = await supabase.from('vercel_connections').select('token, account, updated_at').maybeSingle()
  if (error) throw new Error(`Connexion Vercel illisible : ${error.message}`)
  if (!isObject(data)) return null
  const token = str(data.token)
  if (!token) return null
  return { token, account: str(data.account), updatedAt: str(data.updated_at) ?? '' }
}

/** Enregistre (ou remplace) le jeton du compte connecté. Le vérifier d'abord avec fetchVercelAccount. */
export async function saveVercelConnection(token: string, account: string): Promise<void> {
  const { data } = await supabase.auth.getUser()
  const userId = data.user?.id
  if (!userId) throw new Error('Connectez-vous à Sordulo OS pour relier Vercel.')
  const { error } = await supabase
    .from('vercel_connections')
    .upsert({ user_id: userId, token: token.trim(), account }, { onConflict: 'user_id' })
  if (error) throw new Error(`Connexion Vercel non enregistrée : ${error.message}`)
}

/** Oublie le jeton du compte connecté. */
export async function deleteVercelConnection(): Promise<void> {
  const { data } = await supabase.auth.getUser()
  const userId = data.user?.id
  if (!userId) return
  const { error } = await supabase.from('vercel_connections').delete().eq('user_id', userId)
  if (error) throw new Error(`Déconnexion de Vercel impossible : ${error.message}`)
}
