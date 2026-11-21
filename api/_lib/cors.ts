/**
 * CORS de l'API : seules les origines de l'app de bureau (Tauri) sont autorisées, jamais `*`
 * (le front envoie un jeton Authorization). Le web appelle l'API depuis sa propre origine : rien à ajouter.
 */

/** Origines de la webview Tauri : macOS (`tauri://localhost`), Windows (`http(s)://tauri.localhost`). */
export const DESKTOP_ORIGINS: readonly string[] = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
]

/** Ajoute les en-têtes CORS à la réponse si l'origine de la requête est autorisée (sinon ne touche à rien). */
export function withCors(request: Request, response: Response): Response {
  const origin = request.headers.get('origin')
  const headers = new Headers(response.headers)
  headers.append('vary', 'Origin')
  if (origin && DESKTOP_ORIGINS.includes(origin)) {
    headers.set('access-control-allow-origin', origin)
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/** Réponse au préflight : 204, avec méthodes, en-têtes et durée de cache si l'origine est autorisée. */
export function preflight(request: Request): Response {
  const response = new Response(null, { status: 204 })
  const origin = request.headers.get('origin')
  if (!origin || !DESKTOP_ORIGINS.includes(origin)) return withCors(request, response)
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-methods', 'GET, POST, OPTIONS')
  headers.set('access-control-allow-headers', 'authorization, content-type')
  headers.set('access-control-max-age', '86400')
  return withCors(request, new Response(null, { status: 204, headers }))
}

/** À réexporter dans chaque fichier de route (`export { OPTIONS } from '../_lib/cors.js'`) : Vercel renvoie 405 pour une méthode non exportée. */
export const OPTIONS = (request: Request): Response => preflight(request)
