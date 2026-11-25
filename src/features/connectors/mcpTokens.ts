/**
 * Jetons personnels du serveur MCP (api/mcp.ts). Le jeton est généré dans le navigateur (WebCrypto) : seuls
 * son empreinte SHA-256 et son préfixe vont en base, le jeton lui-même n'est montré qu'une fois.
 * Format partagé avec le serveur (api/_lib/mcp/auth.ts) : `sdo_` + 32 octets aléatoires en base64url.
 */
import type { ApiToken } from '../../shared/types'

export const MCP_TOKEN_PREFIX = 'sdo_'
/** Caractères gardés pour l'affichage (base : 4 à 16). */
export const MCP_TOKEN_DISPLAY_LENGTH = 12
export const MCP_TOKEN_NAME_MAX = 100

export interface GeneratedMcpToken {
  token: string
  prefix: string
  hash: string
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** `random` : pour les tests seulement. */
export async function generateMcpToken(
  random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): Promise<GeneratedMcpToken> {
  const token = MCP_TOKEN_PREFIX + base64url(random(new Uint8Array(32)))
  return { token, prefix: token.slice(0, MCP_TOKEN_DISPLAY_LENGTH), hash: await sha256Hex(token) }
}

/** Adresse du serveur : VITE_API_BASE_URL (app de bureau) ou l'origine de la page. */
export function mcpEndpoint(apiBase: string | undefined, origin: string): string {
  const base = (apiBase ?? '').trim().replace(/\/+$/, '') || origin.replace(/\/+$/, '')
  return `${base}/api/mcp`
}

/** Commande Claude Code qui branche le serveur. */
export function mcpAddCommand(endpoint: string, token: string): string {
  return `claude mcp add --transport http sordulo ${endpoint} --header "Authorization: Bearer ${token}"`
}

/** Nom saisi : message d'erreur, ou null s'il est valable. */
export function tokenNameError(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Donne un nom au jeton, par exemple « Claude Code du MacBook ».'
  if (trimmed.length > MCP_TOKEN_NAME_MAX) return `${MCP_TOKEN_NAME_MAX} caractères au plus.`
  return null
}

export type McpTokenRow = Pick<ApiToken, 'id' | 'name' | 'prefix' | 'last_used_at' | 'created_at' | 'revoked_at'>

/** Jetons actifs, du plus récent au plus ancien. */
export function activeTokens(rows: readonly McpTokenRow[]): McpTokenRow[] {
  return rows.filter((row) => row.revoked_at === null).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

const dateTime = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function lastUsedLabel(lastUsedAt: string | null): string {
  return lastUsedAt ? `Utilisé le ${dateTime.format(new Date(lastUsedAt))}` : 'Jamais utilisé'
}

export interface McpCardView {
  badge: { tone: 'neutral' | 'success' | 'warning'; label: string }
  state: string
  connected: boolean
}

export function describeMcp(ctx: { loading: boolean; loadFailed: boolean; activeCount: number }): McpCardView {
  if (ctx.loading) return { badge: { tone: 'neutral', label: 'Chargement' }, state: 'Lecture des jetons…', connected: false }
  if (ctx.loadFailed) return { badge: { tone: 'warning', label: 'Erreur' }, state: 'Les jetons n’ont pas pu être lus.', connected: false }
  if (ctx.activeCount === 0) {
    return { badge: { tone: 'neutral', label: 'Aucun jeton' }, state: 'Créez un jeton pour brancher Claude Code sur Sordulo OS.', connected: false }
  }
  const label = ctx.activeCount === 1 ? '1 jeton actif' : `${ctx.activeCount} jetons actifs`
  return { badge: { tone: 'success', label }, state: `${label} : Claude peut lire vos projets, tâches et devis selon vos droits.`, connected: true }
}
