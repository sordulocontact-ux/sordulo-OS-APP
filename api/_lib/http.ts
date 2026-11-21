/** HTTP helpers for the /api functions (Web Request/Response). Error messages are in French. */
import { z } from 'zod'
import type { ApiError } from '../../src/shared/api-contract.js'
import { preflight, withCors } from './cors.js'
import { MissingEnvError } from './env.js'

/** Error that becomes a JSON response { error } with the given status. */
export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export function errorJson(status: number, message: string): Response {
  return json(status, { error: message } satisfies ApiError)
}

const frenchErrors = z.locales.fr()

/** Formats zod issues as one readable French sentence. */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => (issue.path.length > 0 ? `${issue.path.join('.')} : ${issue.message}` : issue.message))
    .join(' ; ')
}

/** Reads the JSON body and validates it. Throws HttpError(400) with a French message. */
export async function readJsonBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new HttpError(400, 'Requête invalide : le corps doit être du JSON.')
  }
  const result = schema.safeParse(raw, { error: frenchErrors.localeError })
  if (!result.success) throw new HttpError(400, `Requête invalide : ${formatZodIssues(result.error)}`)
  return result.data
}

/**
 * Wraps a route handler: HttpError -> its status, anything else -> 500 (logged).
 * Also adds the CORS headers (desktop app origins only) to every response, errors included,
 * and answers OPTIONS preflights with 204.
 */
export function route(handler: (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'OPTIONS') return preflight(request)
    return withCors(request, await run(handler, request))
  }
}

async function run(handler: (request: Request) => Promise<Response>, request: Request): Promise<Response> {
  try {
    return await handler(request)
  } catch (error) {
    if (error instanceof HttpError) return errorJson(error.status, error.message)
    if (error instanceof MissingEnvError) {
      console.error(`[api] ${error.message}`)
      return errorJson(500, error.message)
    }
    console.error('[api] erreur inattendue', error)
    return errorJson(500, 'Erreur serveur inattendue. Réessaie dans un instant.')
  }
}
