import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberLinkResponse } from '../../src/shared/api-contract.js'
import { FakeSupabase } from '../_lib/testing/fake-supabase.js'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null }))
vi.mock('../_lib/supabaseAdmin.js', () => ({ getSupabaseAdmin: () => state.db?.client }))

const { POST } = await import('./link.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const APP = 'https://sordulo-os-app.vercel.app'
const INVITED = '33333333-3333-4333-8333-333333333333'
const UNLINKED = '44444444-4444-4444-8444-444444444444'
const REMOVED = '55555555-5555-4555-8555-555555555555'
const SACHA = '66666666-6666-4666-8666-666666666666'

let db: FakeSupabase

function link(memberId: string, token: string | null = 'admin-token'): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json', origin: APP })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return POST(new Request(`${APP}/api/members/link`, { method: 'POST', headers, body: JSON.stringify({ memberId }) }))
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error
}

beforeEach(() => {
  db = new FakeSupabase()
  state.db = db
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const admin = db.addUser('mael@sordulo.fr', { token: 'admin-token', lastSignInAt: '2026-11-01T10:00:00Z' })
  const sacha = db.addUser('sacha@sordulo.fr', { token: 'member-token', lastSignInAt: '2026-11-01T10:00:00Z' })
  const invited = db.addUser('lea@example.com')
  db.seed('members', [
    { organization_id: ORG, user_id: admin.id, name: 'Maël', email: 'mael@sordulo.fr', role: 'admin' },
    { id: SACHA, organization_id: ORG, user_id: sacha.id, name: 'Sacha', email: 'sacha@sordulo.fr', role: 'membre' },
    { id: INVITED, organization_id: ORG, user_id: invited.id, name: 'Léa', email: 'lea@example.com', invited_at: '2026-11-19T10:00:00Z' },
    { id: UNLINKED, organization_id: ORG, name: 'Hugo', email: 'Hugo@Example.com' },
    { id: REMOVED, organization_id: ORG, name: 'Ancien', email: 'ancien@sordulo.fr', removed_at: '2026-11-10T10:00:00Z' },
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/members/link', () => {
  it('401 sans session', async () => {
    expect((await link(INVITED, null)).status).toBe(401)
  })

  it('403 pour un membre qui n’est pas admin', async () => {
    const response = await link(INVITED, 'member-token')
    expect(response.status).toBe(403)
    expect(await errorOf(response)).toContain('admins')
  })

  it('404 pour un membre inconnu', async () => {
    expect((await link('77777777-7777-4777-8777-777777777777')).status).toBe(404)
  })

  it('409 pour un membre retiré', async () => {
    const response = await link(REMOVED)
    expect(response.status).toBe(409)
    expect(await errorOf(response)).toContain('réintègre-le')
  })

  it('409 si le membre s’est déjà connecté : aucun lien vers un compte utilisé', async () => {
    const response = await link(SACHA)
    expect(response.status).toBe(409)
    expect(db.generatedLinks).toBe(0)
    expect(await errorOf(response)).toContain("s'est déjà connecté")
  })

  it('409 si un compte non relié portant son email a déjà servi', async () => {
    db.addUser('hugo@example.com', { lastSignInAt: '2026-11-18T10:00:00Z' })
    expect((await link(UNLINKED)).status).toBe(409)
    expect(db.generatedLinks).toBe(0)
  })

  it('200 : nouveau lien pour un invité jamais connecté', async () => {
    const response = await link(INVITED)
    expect(response.status).toBe(200)
    const body = (await response.json()) as MemberLinkResponse
    expect(body.link).toContain('type=magiclink')
    expect(body.link).toContain(`redirect_to=${encodeURIComponent(APP)}`)
  })

  it('200 : crée le compte qui manque et le relie au membre', async () => {
    const response = await link(UNLINKED)
    expect(response.status).toBe(200)
    const account = db.users.find((u) => u.email === 'hugo@example.com')
    expect(account).toBeDefined()
    expect(db.rows('members').find((m) => m.id === UNLINKED)?.user_id).toBe(account!.id)
  })
})
