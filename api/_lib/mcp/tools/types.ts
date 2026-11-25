/** Contrat d'un outil du serveur MCP (api/mcp.ts). */
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Member, MemberRole } from '../../../../src/shared/types.js'

export interface McpToolContext {
  /** Clé service : la RLS ne s'applique pas, chaque outil filtre sur `member.organization_id` et vérifie le rôle. */
  admin: SupabaseClient
  /** Membre actif propriétaire du jeton. */
  member: Member
  /** Date du jour à Paris, AAAA-MM-JJ. */
  today: string
}

export interface McpToolResult {
  /** Texte lisible (français) : ce que Claude lit en premier. */
  text: string
  /** Même contenu en JSON (structuredContent). */
  structured: Record<string, unknown>
}

export interface McpTool<S extends z.ZodType = z.ZodType> {
  name: string
  title: string
  description: string
  /** Arguments : validés par zod, publiés en JSON Schema par tools/list. */
  schema: S
  /** Rôles qui voient et appellent l'outil. */
  roles: readonly MemberRole[]
  /** Lecture seule (annotation readOnlyHint). */
  readOnly: boolean
  run: (ctx: McpToolContext, args: z.output<S>) => Promise<McpToolResult>
}

/** Échec attendu d'un outil (droit, objet introuvable, valeur refusée) : renvoyé à Claude avec isError. */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpToolError'
  }
}

export function defineTool<S extends z.ZodType>(tool: McpTool<S>): McpTool<S> {
  return tool
}

interface QueryResponse {
  data: unknown
  error: { message: string } | null
}

/** Lignes d'une requête, erreur levée sinon. */
export async function rowsOf<T>(query: PromiseLike<QueryResponse>, what: string): Promise<T[]> {
  const { data, error } = await query
  if (error) throw new Error(`Lecture ${what} impossible : ${error.message}`)
  return (data ?? []) as T[]
}

/** Ligne unique (maybeSingle), null si absente. */
export async function rowOf<T>(query: PromiseLike<QueryResponse>, what: string): Promise<T | null> {
  const { data, error } = await query
  if (error) throw new Error(`Lecture ${what} impossible : ${error.message}`)
  return (data ?? null) as T | null
}

/** Nombre maximal de lignes lues par table pour une recherche ou une liste (taille d'une agence). */
export const SCAN_LIMIT = 1000
