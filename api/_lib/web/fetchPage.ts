/**
 * Récupère une page web publique côté serveur, sans jamais atteindre le réseau interne (voir ssrf.ts) :
 * adresse validée, DNS résolu puis connexion à l'adresse vérifiée, redirections revérifiées une à une
 * (3 au plus), délai total 10 s, 2 Mo au plus lus, pas de compression (pas de bombe de décompression).
 */
import http from 'node:http'
import https from 'node:https'
import { dnsResolver, parsePublicUrl, resolvePublicAddress, UnsafeUrlError, type PublicAddress, type Resolver } from './ssrf.js'

export const FETCH_TIMEOUT_MS = 10_000
export const FETCH_MAX_BYTES = 2 * 1024 * 1024
export const FETCH_MAX_REDIRECTS = 3
const USER_AGENT = 'SordulOS-Audit/1.0 (+audit de site demandé par une agence)'

export interface TransportRequest {
  url: URL
  target: PublicAddress
  signal: AbortSignal
  maxBytes: number
}

export interface TransportResponse {
  status: number
  /** En-têtes en minuscules. */
  headers: Record<string, string | undefined>
  body: Uint8Array
  /** Le corps dépassait maxBytes : il a été coupé. */
  truncated: boolean
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>

export interface FetchPageOptions {
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
  /** Tests : résolveur DNS et transport simulés. */
  resolve?: Resolver
  transport?: Transport
}

export interface FetchedPage {
  /** Adresse finale, après redirections. */
  url: string
  status: number
  html: string
  bytes: number
  truncated: boolean
  redirects: number
  elapsedMs: number
}

/** Échec attendu (site injoignable, pas du HTML…), message affichable. */
export class PageFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PageFetchError'
  }
}

/** Transport réel : http(s).request sur l'adresse déjà vérifiée (en-tête Host et SNI du vrai nom). */
export const nodeTransport: Transport = ({ url, target, signal, maxBytes }) =>
  new Promise<TransportResponse>((resolve, reject) => {
    const secure = url.protocol === 'https:'
    const lib = secure ? https : http
    const request = lib.request(
      {
        host: target.address,
        family: target.family,
        port: url.port === '' ? (secure ? 443 : 80) : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        agent: false,
        signal,
        servername: secure ? url.hostname : undefined,
        headers: {
          host: url.host,
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'accept-encoding': 'identity',
          'accept-language': 'fr,en;q=0.8',
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        let size = 0
        let done = false
        const finish = (truncated: boolean) => {
          if (done) return
          done = true
          const headers: Record<string, string | undefined> = {}
          for (const [name, value] of Object.entries(response.headers)) {
            headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
          }
          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks),
            truncated,
          })
        }
        response.on('data', (chunk: Buffer) => {
          const room = maxBytes - size
          if (chunk.length >= room) {
            chunks.push(chunk.subarray(0, room))
            size = maxBytes
            finish(true)
            request.destroy()
            return
          }
          chunks.push(chunk)
          size += chunk.length
        })
        response.on('end', () => finish(false))
        response.on('close', () => {
          if (done) return
          if (signal.aborted) reject(new Error('aborted'))
          else finish(!response.complete)
        })
        response.on('error', (error) => {
          if (!done) reject(error)
        })
      },
    )
    request.on('error', (error) => reject(error))
    request.end()
  })

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function decode(body: Uint8Array, contentType: string | undefined): string {
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1]
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(body)
  } catch {
    return new TextDecoder('utf-8').decode(body)
  }
}

/** Throws UnsafeUrlError (adresse refusée) ou PageFetchError (site injoignable ou pas une page web). */
export async function fetchPage(rawUrl: string, options: FetchPageOptions = {}): Promise<FetchedPage> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? FETCH_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? FETCH_MAX_REDIRECTS
  const resolve = options.resolve ?? dnsResolver
  const transport = options.transport ?? nodeTransport

  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let url = parsePublicUrl(rawUrl)
    for (let hop = 0; ; hop++) {
      const target = await resolvePublicAddress(url, resolve)
      let response: TransportResponse
      try {
        response = await transport({
          url,
          target,
          signal: controller.signal,
          maxBytes,
        })
      } catch (error) {
        if (controller.signal.aborted) throw new PageFetchError('Le site met trop de temps à répondre.')
        if (error instanceof UnsafeUrlError) throw error
        throw new PageFetchError('Le site est injoignable.')
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.location
        if (!location) throw new PageFetchError('Le site redirige sans destination.')
        if (hop >= maxRedirects) throw new PageFetchError('Le site redirige trop de fois.')
        // Chaque saut est revalidé en entier (schéma, port, nom, adresses).
        let next: string
        try {
          next = new URL(location, url).toString()
        } catch {
          throw new PageFetchError('Le site redirige vers une adresse invalide.')
        }
        url = parsePublicUrl(next)
        continue
      }
      if (response.status < 200 || response.status >= 300) {
        throw new PageFetchError(`Le site répond avec l’erreur ${response.status}.`)
      }
      const contentType = response.headers['content-type']
      if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        throw new PageFetchError('L’adresse ne renvoie pas une page web.')
      }
      return {
        url: url.toString(),
        status: response.status,
        html: decode(response.body, contentType),
        bytes: response.body.byteLength,
        truncated: response.truncated,
        redirects: hop,
        elapsedMs: Date.now() - started,
      }
    }
  } finally {
    clearTimeout(timer)
  }
}
