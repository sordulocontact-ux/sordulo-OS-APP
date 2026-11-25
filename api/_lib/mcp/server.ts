/**
 * Serveur MCP de Sordulo OS (api/mcp.ts) en « streamable HTTP » sans état : chaque POST porte un message
 * JSON-RPC ou un lot, la réponse est du JSON (jamais de flux SSE, pas de session). GET et DELETE : 405.
 * Authentification par jeton personnel (auth.ts) ; les droits sont ceux du membre (access.ts).
 */
import { z } from 'zod'
import { getSupabaseAdmin } from '../supabaseAdmin.js'
import { McpAuthError, authenticateMcp } from './auth.js'
import { parisDate } from './finance.js'
import {
  BodyTooLargeError,
  JSONRPC_ERRORS,
  JsonRpcError,
  dispatchJsonRpc,
  failure,
  readBodyText,
  type JsonRpcResponse,
} from './jsonrpc.js'
import { describeTool, findTool, toolsForRole } from './tools/index.js'
import { McpToolError, type McpToolContext } from './tools/types.js'

/** Versions du protocole MCP acceptées, la plus récente d'abord. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

export const SERVER_INFO = { name: 'sordulo-os', title: 'Sordulo OS', version: '1.0.0' } as const

const INSTRUCTIONS =
  'Sordulo OS est l’outil interne de l’agence Sordulo : clients, projets, tickets, tâches, devis, factures et prospection. ' +
  'Les droits sont ceux du membre propriétaire du jeton. Commence par search ou list_projects pour trouver les identifiants, ' +
  'puis get_project. Les écritures (create_task, update_task) sont immédiates : confirme avec l’utilisateur avant de les lancer.'

const frenchErrors = z.locales.fr()

/** Version demandée par le client si elle est acceptée, sinon la plus récente (le client décide de continuer). */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === 'string' && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

function issuesText(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')} : ${issue.message}` : issue.message))
    .join(' ; ')
}

async function callTool(ctx: McpToolContext, params: unknown) {
  if (!isRecord(params) || typeof params.name !== 'string') {
    throw new JsonRpcError(JSONRPC_ERRORS.invalidParams, 'Paramètres invalides : « name » (nom de l’outil) attendu.')
  }
  const tool = findTool(params.name)
  if (!tool) throw new JsonRpcError(JSONRPC_ERRORS.invalidParams, `Outil inconnu : ${params.name}.`)
  const toolError = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true })

  if (!tool.roles.includes(ctx.member.role)) return toolError('Accès refusé : ton rôle ne permet pas d’utiliser cet outil.')
  const parsed = tool.schema.safeParse(params.arguments ?? {}, { error: frenchErrors.localeError })
  if (!parsed.success) return toolError(`Arguments invalides : ${issuesText(parsed.error)}`)
  try {
    const result = await tool.run(ctx, parsed.data)
    return { content: [{ type: 'text', text: result.text }], structuredContent: result.structured }
  } catch (error) {
    if (error instanceof McpToolError) return toolError(error.message)
    throw error
  }
}

function methodHandler(ctx: McpToolContext) {
  return async (method: string, params: unknown): Promise<unknown> => {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: negotiateProtocolVersion(isRecord(params) ? params.protocolVersion : undefined),
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        }
      case 'ping':
        return {}
      case 'tools/list':
        return { tools: toolsForRole(ctx.member.role).map(describeTool) }
      case 'tools/call':
        return callTool(ctx, params)
      default:
        throw new JsonRpcError(JSONRPC_ERRORS.methodNotFound, `Méthode inconnue : ${method}.`)
    }
  }
}

/** Point d'entrée HTTP (POST seulement). */
export async function handleMcp(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse(405, failure(null, JSONRPC_ERRORS.invalidRequest, 'Méthode HTTP non prise en charge : ce serveur sans état n’accepte que POST.'), {
      allow: 'POST, OPTIONS',
    })
  }

  const admin = getSupabaseAdmin()
  let ctx: McpToolContext
  try {
    const principal = await authenticateMcp(request, admin)
    ctx = { admin, member: principal.member, today: parisDate(new Date()) }
  } catch (error) {
    if (!(error instanceof McpAuthError)) throw error
    const headers: Record<string, string> = error.status === 401 ? { 'www-authenticate': 'Bearer realm="sordulo-os"' } : {}
    return jsonResponse(error.status, failure(null, error.status === 401 ? -32001 : -32003, error.message), headers)
  }

  let text: string
  try {
    text = await readBodyText(request)
  } catch (error) {
    if (error instanceof BodyTooLargeError) return jsonResponse(413, failure(null, JSONRPC_ERRORS.invalidRequest, error.message))
    throw error
  }
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    return jsonResponse(400, failure(null, JSONRPC_ERRORS.parse, 'Erreur d’analyse : le corps doit être du JSON.'))
  }

  const responses: JsonRpcResponse | JsonRpcResponse[] | null = await dispatchJsonRpc(body, methodHandler(ctx), (error) =>
    console.error('[mcp] erreur inattendue', error),
  )
  if (responses === null) return new Response(null, { status: 202 })
  return jsonResponse(200, responses)
}
