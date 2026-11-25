/**
 * POST /api/mcp : serveur MCP de Sordulo OS (12e et dernière fonction Vercel de l'offre gratuite).
 * « Streamable HTTP » sans état, JSON-RPC 2.0 ; jeton personnel `Authorization: Bearer sdo_…` créé dans
 * Connecteurs. Outils : search, list_projects, get_project, list_my_tasks, create_task, update_task,
 * finance_summary, list_prospects. Logique dans api/_lib/mcp/.
 * Brancher Claude Code : claude mcp add --transport http sordulo <origine>/api/mcp --header "Authorization: Bearer <jeton>"
 */
import { route } from './_lib/http.js'
import { handleMcp } from './_lib/mcp/server.js'

export { OPTIONS } from './_lib/cors.js'

export const POST = route(handleMcp)
/** Pas de flux serveur → client ni de session : 405 (exportés pour répondre en JSON-RPC plutôt que par la page 405 de Vercel). */
export const GET = route(handleMcp)
export const DELETE = route(handleMcp)
