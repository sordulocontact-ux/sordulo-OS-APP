import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPage, nodeTransport, PageFetchError, type Transport, type TransportResponse } from './fetchPage.js'
import { UnsafeUrlError } from './ssrf.js'

const PUBLIC = async () => ['93.184.216.34']

function html(body = '<html><title>Ok</title></html>', extra: Partial<TransportResponse> = {}): TransportResponse {
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: new TextEncoder().encode(body),
    truncated: false,
    ...extra,
  }
}

function redirect(location: string | undefined, status = 302): TransportResponse {
  return {
    status,
    headers: location ? { location } : {},
    body: new Uint8Array(),
    truncated: false,
  }
}

/** Transport simulé : une réponse par appel, et la trace des adresses réellement visées. */
function scripted(...responses: TransportResponse[]): {
  transport: Transport
  calls: { url: string; address: string }[]
} {
  const calls: { url: string; address: string }[] = []
  let index = 0
  const transport: Transport = async ({ url, target }) => {
    calls.push({ url: url.toString(), address: target.address })
    const response = responses[index++]
    if (!response) throw new Error('plus de réponse prévue')
    return response
  }
  return { transport, calls }
}

describe('fetchPage', () => {
  it('lit une page publique et se connecte à l’adresse vérifiée', async () => {
    const { transport, calls } = scripted(html('<html><title>Café</title></html>'))
    const page = await fetchPage('https://exemple.fr/', {
      resolve: PUBLIC,
      transport,
    })
    expect(page.html).toContain('Café')
    expect(page.status).toBe(200)
    expect(page.redirects).toBe(0)
    expect(calls).toEqual([{ url: 'https://exemple.fr/', address: '93.184.216.34' }])
  })

  it('refuse sans réseau une adresse interdite', async () => {
    const { transport, calls } = scripted(html())
    await expect(
      fetchPage('http://169.254.169.254/latest/meta-data/', {
        resolve: PUBLIC,
        transport,
      }),
    ).rejects.toThrow(UnsafeUrlError)
    await expect(fetchPage('http://localhost:8080/', { resolve: PUBLIC, transport })).rejects.toThrow(UnsafeUrlError)
    await expect(fetchPage('file:///etc/passwd', { resolve: PUBLIC, transport })).rejects.toThrow(UnsafeUrlError)
    expect(calls).toHaveLength(0)
  })

  it('refuse un nom qui se résout vers une adresse privée, sans connexion', async () => {
    const { transport, calls } = scripted(html())
    await expect(
      fetchPage('https://piege.exemple.fr/', {
        resolve: async () => ['192.168.0.10'],
        transport,
      }),
    ).rejects.toThrow(/pas un site public/)
    expect(calls).toHaveLength(0)
  })

  it('suit une redirection, relative comprise, et la revalide', async () => {
    const { transport, calls } = scripted(redirect('/accueil', 301), redirect('https://www.exemple.fr/fr/'), html())
    const page = await fetchPage('http://exemple.fr/', {
      resolve: PUBLIC,
      transport,
    })
    expect(page.url).toBe('https://www.exemple.fr/fr/')
    expect(page.redirects).toBe(2)
    expect(calls.map((c) => c.url)).toEqual(['http://exemple.fr/', 'http://exemple.fr/accueil', 'https://www.exemple.fr/fr/'])
  })

  it.each([
    ['les métadonnées cloud', 'http://169.254.169.254/latest/meta-data/'],
    ['localhost', 'http://localhost/admin'],
    ['une adresse loopback', 'http://127.0.0.1/'],
    ['un port interdit', 'https://exemple.fr:8443/'],
    ['un autre schéma', 'ftp://exemple.fr/'],
    ['des identifiants', 'https://root:x@exemple.fr/'],
  ])('refuse une redirection vers %s', async (_label, location) => {
    const { transport, calls } = scripted(redirect(location), html())
    await expect(fetchPage('https://exemple.fr/', { resolve: PUBLIC, transport })).rejects.toThrow(UnsafeUrlError)
    expect(calls).toHaveLength(1)
  })

  it('refuse une redirection dont le nom se résout vers le réseau interne', async () => {
    const resolve = async (host: string) => (host === 'interne.exemple.fr' ? ['10.0.0.8'] : ['93.184.216.34'])
    const { transport, calls } = scripted(redirect('https://interne.exemple.fr/'), html())
    await expect(fetchPage('https://exemple.fr/', { resolve, transport })).rejects.toThrow(/pas un site public/)
    expect(calls).toHaveLength(1)
  })

  it('accepte 3 redirections et refuse la 4e', async () => {
    const ok = scripted(redirect('/a'), redirect('/b'), redirect('/c'), html())
    expect(
      (
        await fetchPage('https://exemple.fr/', {
          resolve: PUBLIC,
          transport: ok.transport,
        })
      ).redirects,
    ).toBe(3)

    const loop = scripted(redirect('/a'), redirect('/b'), redirect('/c'), redirect('/d'), html())
    await expect(
      fetchPage('https://exemple.fr/', {
        resolve: PUBLIC,
        transport: loop.transport,
      }),
    ).rejects.toThrow(/trop de fois/)
    expect(loop.calls).toHaveLength(4)
  })

  it('refuse une redirection sans destination', async () => {
    const { transport } = scripted(redirect(undefined))
    await expect(fetchPage('https://exemple.fr/', { resolve: PUBLIC, transport })).rejects.toThrow(PageFetchError)
  })

  it('refuse une erreur HTTP et un contenu qui n’est pas une page web', async () => {
    const error = scripted({ ...html(), status: 503 })
    await expect(
      fetchPage('https://exemple.fr/', {
        resolve: PUBLIC,
        transport: error.transport,
      }),
    ).rejects.toThrow(/erreur 503/)
    const pdf = scripted({
      ...html(),
      headers: { 'content-type': 'application/pdf' },
    })
    await expect(
      fetchPage('https://exemple.fr/', {
        resolve: PUBLIC,
        transport: pdf.transport,
      }),
    ).rejects.toThrow(/pas une page web/)
  })

  it('signale un corps coupé à la limite', async () => {
    const { transport } = scripted(html('<html>' + 'x'.repeat(50), { truncated: true }))
    const page = await fetchPage('https://exemple.fr/', {
      resolve: PUBLIC,
      transport,
    })
    expect(page.truncated).toBe(true)
  })

  it('traduit un site injoignable', async () => {
    const transport: Transport = async () => {
      throw new Error('ECONNREFUSED')
    }
    await expect(fetchPage('https://exemple.fr/', { resolve: PUBLIC, transport })).rejects.toThrow(/injoignable/)
  })

  it('coupe au délai de 10 s', async () => {
    vi.useFakeTimers()
    try {
      const transport: Transport = ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      const pending = fetchPage('https://exemple.fr/', {
        resolve: PUBLIC,
        transport,
      })
      const assertion = expect(pending).rejects.toThrow(/trop de temps/)
      await vi.advanceTimersByTimeAsync(10_001)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('décode le jeu de caractères annoncé', async () => {
    const latin1 = Uint8Array.from([0x63, 0x61, 0x66, 0xe9]) // « café » en ISO-8859-1
    const { transport } = scripted({
      status: 200,
      headers: { 'content-type': 'text/html; charset=iso-8859-1' },
      body: latin1,
      truncated: false,
    })
    expect((await fetchPage('https://exemple.fr/', { resolve: PUBLIC, transport })).html).toBe('café')
  })
})

describe('nodeTransport (serveur local, adresse imposée par l’appelant)', () => {
  let server: http.Server | null = null
  afterEach(() => {
    server?.close()
    server = null
  })

  function listen(handler: http.RequestListener): Promise<number> {
    server = http.createServer(handler)
    return new Promise((resolve) => server?.listen(0, '127.0.0.1', () => resolve((server?.address() as AddressInfo).port)))
  }

  it('envoie le vrai nom dans Host, sans compression, et lit le corps', async () => {
    let seen: http.IncomingHttpHeaders = {}
    const port = await listen((request, response) => {
      seen = request.headers
      response.setHeader('content-type', 'text/html')
      response.end('<html>bonjour</html>')
    })
    const response = await nodeTransport({
      url: new URL(`http://exemple.fr:${port}/page?x=1`),
      target: { address: '127.0.0.1', family: 4 },
      signal: new AbortController().signal,
      maxBytes: 1024,
    })
    expect(response.status).toBe(200)
    expect(new TextDecoder().decode(response.body)).toBe('<html>bonjour</html>')
    expect(response.truncated).toBe(false)
    expect(seen.host).toBe(`exemple.fr:${port}`)
    expect(seen['accept-encoding']).toBe('identity')
  })

  it('coupe le corps à la limite', async () => {
    const port = await listen((_request, response) => {
      response.setHeader('content-type', 'text/html')
      response.write('a'.repeat(5000))
      response.end('b'.repeat(5000))
    })
    const response = await nodeTransport({
      url: new URL(`http://exemple.fr:${port}/`),
      target: { address: '127.0.0.1', family: 4 },
      signal: new AbortController().signal,
      maxBytes: 2048,
    })
    expect(response.truncated).toBe(true)
    expect(response.body.byteLength).toBe(2048)
  })

  it('ne suit pas les redirections et rend leur destination', async () => {
    const port = await listen((_request, response) => {
      response.statusCode = 302
      response.setHeader('location', 'http://169.254.169.254/')
      response.end()
    })
    const response = await nodeTransport({
      url: new URL(`http://exemple.fr:${port}/`),
      target: { address: '127.0.0.1', family: 4 },
      signal: new AbortController().signal,
      maxBytes: 1024,
    })
    expect(response.status).toBe(302)
    expect(response.headers.location).toBe('http://169.254.169.254/')
  })

  it('s’arrête quand le signal est annulé', async () => {
    const port = await listen(() => {
      /* ne répond jamais */
    })
    const controller = new AbortController()
    const pending = nodeTransport({
      url: new URL(`http://exemple.fr:${port}/`),
      target: { address: '127.0.0.1', family: 4 },
      signal: controller.signal,
      maxBytes: 1024,
    })
    setTimeout(() => controller.abort(), 30)
    await expect(pending).rejects.toThrow()
  })
})
