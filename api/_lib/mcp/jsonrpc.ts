/**
 * JSON-RPC 2.0 écrit à la main pour le serveur MCP (pas de dépendance) : lecture d'un message ou d'un lot,
 * réponses et erreurs conformes (https://www.jsonrpc.org/specification).
 */

export const JSONRPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const

export type JsonRpcId = string | number | null

/** Requêtes au plus dans un lot (au-delà : une seule erreur -32600, rien n'est exécuté). */
export const MAX_BATCH_SIZE = 20
/** Taille maximale du corps d'une requête HTTP : 1 Mo. */
export const MAX_BODY_BYTES = 1024 * 1024

export interface JsonRpcErrorBody {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: JsonRpcErrorBody
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

/** Erreur levée par une méthode : devient la réponse d'erreur JSON-RPC de ce code. */
export class JsonRpcError extends Error {
  readonly code: number
  readonly data?: unknown
  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'JsonRpcError'
    this.code = code
    this.data = data
  }
}

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result }
}

export function failure(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } }
}

/** Ce qu'est un message reçu : requête (attend une réponse), notification, réponse du client, ou invalide. */
export type IncomingMessage =
  | { kind: 'request'; id: string | number; method: string; params: unknown }
  | { kind: 'notification'; method: string; params: unknown }
  | { kind: 'response' }
  | { kind: 'invalid'; id: JsonRpcId; message: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isValidId = (value: unknown): value is string | number =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))

export function classifyMessage(message: unknown): IncomingMessage {
  if (!isRecord(message)) return { kind: 'invalid', id: null, message: 'Requête invalide : objet JSON-RPC attendu.' }
  const id = isValidId(message.id) ? message.id : null
  if (message.jsonrpc !== '2.0') return { kind: 'invalid', id, message: 'Requête invalide : « jsonrpc » doit valoir « 2.0 ».' }
  // Réponse du client à une requête du serveur : ce serveur n'en envoie jamais, on l'ignore.
  if (!('method' in message) && ('result' in message || 'error' in message)) return { kind: 'response' }
  if (typeof message.method !== 'string' || message.method === '') {
    return { kind: 'invalid', id, message: 'Requête invalide : « method » manquante.' }
  }
  if (message.params !== undefined && !isRecord(message.params) && !Array.isArray(message.params)) {
    return { kind: 'invalid', id, message: 'Requête invalide : « params » doit être un objet.' }
  }
  if (!('id' in message)) return { kind: 'notification', method: message.method, params: message.params }
  if (!isValidId(message.id)) return { kind: 'invalid', id: null, message: 'Requête invalide : « id » doit être un texte ou un nombre.' }
  return { kind: 'request', id: message.id, method: message.method, params: message.params }
}

export type MethodHandler = (method: string, params: unknown) => Promise<unknown>

async function answer(message: unknown, handle: MethodHandler, onUnexpected: (error: unknown) => void): Promise<JsonRpcResponse | null> {
  const incoming = classifyMessage(message)
  switch (incoming.kind) {
    case 'invalid':
      return failure(incoming.id, JSONRPC_ERRORS.invalidRequest, incoming.message)
    case 'response':
    case 'notification':
      // Une notification n'a jamais de réponse (notifications/initialized, notifications/cancelled…).
      return null
    case 'request':
      try {
        return success(incoming.id, await handle(incoming.method, incoming.params))
      } catch (error) {
        if (error instanceof JsonRpcError) return failure(incoming.id, error.code, error.message, error.data)
        onUnexpected(error)
        return failure(incoming.id, JSONRPC_ERRORS.internal, 'Erreur interne du serveur. Réessaie dans un instant.')
      }
  }
}

/**
 * Traite un corps déjà lu : un message ou un lot. Renvoie la réponse (ou le tableau des réponses d'un lot),
 * ou null s'il n'y a rien à répondre (seulement des notifications ou des réponses).
 */
export async function dispatchJsonRpc(
  body: unknown,
  handle: MethodHandler,
  onUnexpected: (error: unknown) => void = () => {},
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (!Array.isArray(body)) return answer(body, handle, onUnexpected)
  if (body.length === 0) return failure(null, JSONRPC_ERRORS.invalidRequest, 'Requête invalide : lot vide.')
  if (body.length > MAX_BATCH_SIZE) {
    return failure(
      null,
      JSONRPC_ERRORS.invalidRequest,
      `Requête invalide : lot de ${body.length} messages, ${MAX_BATCH_SIZE} au plus. Découpe-le en plusieurs envois.`,
    )
  }
  const responses: JsonRpcResponse[] = []
  // Dans l'ordre : une création suivie d'une lecture dans le même lot doit voir la création.
  for (const message of body) {
    const response = await answer(message, handle, onUnexpected)
    if (response) responses.push(response)
  }
  return responses.length > 0 ? responses : null
}

/** Corps HTTP plus gros que la limite (réponse 413). */
export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Requête trop volumineuse : ${Math.round(maxBytes / 1024)} Ko au plus.`)
    this.name = 'BodyTooLargeError'
  }
}

/**
 * Lit le corps en texte sans jamais dépasser `maxBytes` : refus d'emblée si Content-Length annonce plus,
 * sinon lecture du flux arrêtée dès que la limite est franchie (un Content-Length absent ou faux ne suffit pas).
 */
export async function readBodyText(request: Request, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError(maxBytes)
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new BodyTooLargeError(maxBytes)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}
