import { describe, expect, it } from 'vitest'
import { DESKTOP_MIN_VERSION } from '../../src/shared/desktop-version.js'
import { GET, OPTIONS } from '../desktop/min-version.js'
import { HttpError, route } from './http.js'

const URL = 'https://sordulo-os-app.vercel.app/api/desktop/min-version'
const req = (method: string, origin?: string) =>
  new Request(URL, { method, headers: origin ? { origin } : {} })

describe('CORS', () => {
  it.each(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'])(
    'origine autorisée %s : en-têtes présents',
    async (origin) => {
      const response = await GET(req('GET', origin))
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
      expect(response.headers.get('vary')).toContain('Origin')
    },
  )

  it('origine inconnue ou absente : pas d’en-tête Allow-Origin, jamais *', async () => {
    for (const origin of ['https://evil.example', 'https://sordulo-os-app.vercel.app', undefined]) {
      const response = await GET(req('GET', origin))
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    }
  })

  it('les erreurs portent aussi les en-têtes', async () => {
    const failing = route(async () => {
      throw new HttpError(403, 'Non.')
    })
    const response = await failing(req('POST', 'tauri://localhost'))
    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBe('tauri://localhost')
  })

  it('OPTIONS : 204 avec méthodes, en-têtes et max-age', async () => {
    for (const handler of [OPTIONS, route(async () => new Response('x'))]) {
      const response = await handler(req('OPTIONS', 'http://tauri.localhost'))
      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe('http://tauri.localhost')
      expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS')
      expect(response.headers.get('access-control-allow-headers')).toBe('authorization, content-type')
      expect(response.headers.get('access-control-max-age')).toBe('86400')
    }
  })

  it('OPTIONS depuis une origine inconnue : 204 sans autorisation', async () => {
    const response = await OPTIONS(req('OPTIONS', 'https://evil.example'))
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('access-control-allow-methods')).toBeNull()
  })
})

describe('GET /api/desktop/min-version', () => {
  it('renvoie la constante, sans cache', async () => {
    const response = await GET(req('GET'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ minVersion: DESKTOP_MIN_VERSION })
  })
})
