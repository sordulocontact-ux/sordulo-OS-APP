/**
 * Authentification du serveur MCP : `Authorization: Bearer sdo_…`, jeton personnel créé dans Connecteurs.
 * Seule l'empreinte SHA-256 (hexadécimal) est en base (api_tokens.token_hash) ; le jeton n'est jamais journalisé.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiToken, Member } from '../../../src/shared/types.js'

/** `sdo_` + 32 octets aléatoires en base64url (43 caractères). Même format que src/features/connectors/mcpTokens.ts. */
export const MCP_TOKEN_PATTERN = /^sdo_[A-Za-z0-9_-]{43}$/

export class McpAuthError extends Error {
  readonly status: 401 | 403
  constructor(status: 401 | 403, message: string) {
    super(message)
    this.name = 'McpAuthError'
    this.status = status
  }
}

/** SHA-256 hexadécimal du jeton (UTF-8). */
export async function hashMcpToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Jeton de l'en-tête Authorization, ou null s'il est absent ou mal formé. */
export function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec((request.headers.get('authorization') ?? '').trim())
  return match?.[1] ?? null
}

export interface McpPrincipal {
  member: Member
  tokenId: string
}

const MISSING = 'Jeton manquant : ajoute l’en-tête « Authorization: Bearer <jeton> » (jeton créé dans Connecteurs > Serveur MCP Sordulo OS).'
const INVALID = 'Jeton invalide ou révoqué : crée un nouveau jeton dans Connecteurs > Serveur MCP Sordulo OS.'

/**
 * Jeton non révoqué → membre actif de l'organisation du jeton. Met à jour last_used_at.
 * McpAuthError 401 (jeton absent, inconnu, révoqué) ou 403 (membre retiré de l'organisation).
 */
export async function authenticateMcp(request: Request, admin: SupabaseClient): Promise<McpPrincipal> {
  const token = bearerToken(request)
  if (!token) throw new McpAuthError(401, MISSING)
  if (!MCP_TOKEN_PATTERN.test(token)) throw new McpAuthError(401, INVALID)

  const tokenRes = await admin
    .from('api_tokens')
    .select('*')
    .eq('token_hash', await hashMcpToken(token))
    .is('revoked_at', null)
    .maybeSingle()
  if (tokenRes.error) throw new Error(`Lecture des jetons impossible : ${tokenRes.error.message}`)
  const row = tokenRes.data as ApiToken | null
  if (!row) throw new McpAuthError(401, INVALID)

  const memberRes = await admin
    .from('members')
    .select('*')
    .eq('id', row.member_id)
    .eq('organization_id', row.organization_id)
    .maybeSingle()
  if (memberRes.error) throw new Error(`Lecture du membre impossible : ${memberRes.error.message}`)
  const member = memberRes.data as Member | null
  if (!member || member.removed_at) throw new McpAuthError(403, 'Accès refusé : ce membre ne fait plus partie de l’organisation.')

  const touched = await admin.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id)
  if (touched.error) console.error(`[mcp] last_used_at non mis à jour : ${touched.error.message}`)
  return { member, tokenId: row.id }
}
