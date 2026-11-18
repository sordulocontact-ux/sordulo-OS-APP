/**
 * Dev only: serves the Vercel functions in /api through the Vite dev server,
 * so `npm run dev` works without the Vercel CLI.
 * Convention (same as on Vercel): api/inputs/create.ts -> /api/inputs/create,
 * the file exports named handlers GET/POST(request: Request): Promise<Response>.
 * Files and folders starting with "_" are not routes.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'

type Handler = (request: Request) => Promise<Response> | Response

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

async function handle(server: ViteDevServer, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (!url.pathname.startsWith('/api/')) return false
  const route = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '')
  if (route.split('/').some((part) => part.startsWith('_') || part === '..')) return false
  const file = path.resolve(server.config.root, 'api', `${route}.ts`)
  if (!fs.existsSync(file)) {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: `Route introuvable : ${url.pathname}` }))
    return true
  }
  const mod = (await server.ssrLoadModule(file)) as Record<string, unknown>
  const method = (req.method ?? 'GET').toUpperCase()
  const handler = mod[method] as Handler | undefined
  if (typeof handler !== 'function') {
    res.statusCode = 405
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: `Méthode ${method} non supportée` }))
    return true
  }
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(', '))
  }
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
  const request = new Request(url.toString(), { method, headers, body })
  const response = await handler(request)
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(Buffer.from(await response.arrayBuffer()))
  return true
}

export function apiDevPlugin(): Plugin {
  return {
    name: 'sordulo-api-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        handle(server, req, res)
          .then((handled) => {
            if (!handled) next()
          })
          .catch((error: unknown) => {
            server.config.logger.error(String(error instanceof Error ? error.stack : error))
            res.statusCode = 500
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ error: 'Erreur serveur (dev)' }))
          })
      })
    },
  }
}
