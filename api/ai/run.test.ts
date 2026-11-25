import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSupabase } from '../_lib/testing/fake-supabase.js'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null }))
vi.mock('../_lib/supabaseAdmin.js', () => ({ getSupabaseAdmin: () => state.db?.client }))

const { POST } = await import('./run.js')

function call(body: unknown, token: string | null = 'token'): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return POST(new Request('https://app.test/api/ai/run', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }))
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error
}

describe('POST /api/ai/run', () => {
  beforeEach(() => {
    state.db = new FakeSupabase()
    state.db.addUser('mael@sordulo.test', { token: 'token' })
  })
  afterEach(() => {
    state.db = null
  })

  it('refuse un corps qui n’est pas du JSON', async () => {
    const response = await call('pas du json')
    expect(response.status).toBe(400)
  })

  it('refuse une action inconnue avant même la session', async () => {
    const response = await call({ action: 'inconnue' }, null)
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toContain('action inconnue')
  })

  it('demande une session', async () => {
    const response = await call({ action: 'caseStudy' }, null)
    expect(response.status).toBe(401)
  })
})
