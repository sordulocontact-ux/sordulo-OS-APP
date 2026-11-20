import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InviteMemberResponse } from '../../src/shared/api-contract.js'
import { FakeSupabase } from '../_lib/testing/fake-supabase.js'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null }))
vi.mock('../_lib/supabaseAdmin.js', () => ({ getSupabaseAdmin: () => state.db?.client }))

const { POST } = await import('./invite.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const APP = 'https://sordulo-os-app.vercel.app'

let db: FakeSupabase

function invite(body: unknown, options: { token?: string | null; origin?: string } = {}): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' })
  const token = options.token === undefined ? 'admin-token' : options.token
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (options.origin) headers.set('origin', options.origin)
  return POST(new Request(`${APP}/api/members/invite`, { method: 'POST', headers, body: JSON.stringify(body) }))
}

const valid = { organizationId: ORG, name: '  Léa Martin ', email: ' Lea.Martin@Example.com ', role: 'membre' }

beforeEach(() => {
  db = new FakeSupabase()
  state.db = db
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const admin = db.addUser('mael@sordulo.fr', { token: 'admin-token', lastSignInAt: '2026-11-01T10:00:00Z' })
  const member = db.addUser('sacha@sordulo.fr', { token: 'member-token', lastSignInAt: '2026-11-01T10:00:00Z' })
  db.seed('members', [
    { organization_id: ORG, user_id: admin.id, name: 'Maël', email: 'mael@sordulo.fr', role: 'admin' },
    { organization_id: ORG, user_id: member.id, name: 'Sacha', email: 'sacha@sordulo.fr', role: 'membre' },
    { organization_id: ORG, name: 'Ancien', email: 'ancien@sordulo.fr', role: 'membre', removed_at: '2026-11-10T10:00:00Z' },
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('POST /api/members/invite', () => {
  it('401 sans session', async () => {
    const response = await invite(valid, { token: null })
    expect(response.status).toBe(401)
    expect(db.rows('members')).toHaveLength(3)
  })

  it('400 pour un email ou un rôle invalide', async () => {
    expect((await invite({ ...valid, email: 'pas-un-email' })).status).toBe(400)
    expect((await invite({ ...valid, role: 'superadmin' })).status).toBe(400)
    expect((await invite({ ...valid, name: '   ' })).status).toBe(400)
  })

  it('403 pour un membre qui n’est pas admin', async () => {
    const response = await invite(valid, { token: 'member-token' })
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: string }).error).toContain('admins')
    expect(db.rows('members')).toHaveLength(3)
  })

  it('403 pour un admin d’une autre organisation', async () => {
    const response = await invite({ ...valid, organizationId: OTHER_ORG })
    expect(response.status).toBe(403)
  })

  it('403 pour un admin retiré', async () => {
    const mael = db.rows('members').find((m) => m.name === 'Maël')!
    mael.removed_at = '2026-11-15T10:00:00Z'
    expect((await invite(valid)).status).toBe(403)
  })

  it('409 si l’email est déjà dans l’équipe (sans tenir compte de la casse)', async () => {
    const response = await invite({ ...valid, email: 'SACHA@sordulo.fr' })
    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: string }).error).toContain('fait déjà partie')
    expect(db.users).toHaveLength(2)
  })

  it('409 avec la marche à suivre pour un membre retiré', async () => {
    const response = await invite({ ...valid, email: 'ancien@sordulo.fr' })
    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: string }).error).toContain("retiré : réintègre-le depuis l'équipe")
  })

  it('201 : crée le compte, le membre relié et un lien qui revient sur l’app', async () => {
    const response = await invite(valid, { origin: APP })
    expect(response.status).toBe(201)
    const body = (await response.json()) as InviteMemberResponse
    const account = db.users.find((u) => u.email === 'lea.martin@example.com')
    expect(account).toBeDefined()
    expect(body.member).toMatchObject({
      organization_id: ORG,
      name: 'Léa Martin',
      email: 'lea.martin@example.com',
      role: 'membre',
      skills: {},
      user_id: account!.id,
      removed_at: null,
    })
    expect(body.member.invited_at).toEqual(expect.any(String))
    expect(body.link).toContain(`redirect_to=${encodeURIComponent(APP)}`)
    expect(db.rows('members')).toHaveLength(4)
  })

  it('redirige vers APP_URL quand l’origine de la requête n’est pas autorisée', async () => {
    vi.stubEnv('APP_URL', 'https://os.sordulo.fr/')
    const body = (await (await invite(valid, { origin: 'https://pirate.example' })).json()) as InviteMemberResponse
    expect(body.link).toContain(`redirect_to=${encodeURIComponent('https://os.sordulo.fr')}`)
  })

  it('reprend un compte existant jamais connecté et le relie au membre', async () => {
    const existing = db.addUser('lea.martin@example.com')
    const response = await invite(valid)
    expect(response.status).toBe(201)
    const body = (await response.json()) as InviteMemberResponse
    expect(body.member.user_id).toBe(existing.id)
    expect(body.link).toContain('type=magiclink')
    expect(db.users).toHaveLength(3)
  })

  it('201 sans lien pour un compte existant déjà utilisé : membre créé et relié à ce compte', async () => {
    const existing = db.addUser('lea.martin@example.com', { lastSignInAt: '2026-11-19T08:00:00Z' })
    const response = await invite(valid)
    expect(response.status).toBe(201)
    const body = (await response.json()) as InviteMemberResponse
    expect(body.link).toBeNull()
    expect(body.member).toMatchObject({ email: 'lea.martin@example.com', user_id: existing.id, role: 'membre', removed_at: null })
    expect(body.member.invited_at).toEqual(expect.any(String))
    expect(db.rows('members')).toHaveLength(4)
    expect(db.rows('members').find((m) => m.email === 'lea.martin@example.com')?.user_id).toBe(existing.id)
    // Aucun lien généré : le jeton de connexion en attente de ce compte n'est pas remplacé.
    expect(db.generatedLinks).toBe(0)
    expect(db.users).toHaveLength(3)
  })

  it('échec du lien : aucun membre créé, le compte créé est supprimé', async () => {
    db.authFailures.generateLink = { message: 'Service indisponible', status: 503 }
    const response = await invite(valid)
    expect(response.status).toBe(502)
    expect(((await response.json()) as { error: string }).error).toContain('lien de connexion')
    expect(db.rows('members')).toHaveLength(3)
    expect(db.users.some((u) => u.email === 'lea.martin@example.com')).toBe(false)
  })

  it('échec de la création du compte : aucun membre créé', async () => {
    db.authFailures.createUser = { message: 'Service indisponible', status: 503 }
    const response = await invite(valid)
    expect(response.status).toBe(502)
    expect(db.rows('members')).toHaveLength(3)
  })

  it('échec de l’insertion : le compte créé est supprimé, aucun lien renvoyé', async () => {
    db.failNext('members', 'insert', { message: 'connexion perdue' })
    const response = await invite(valid)
    expect(response.status).toBe(500)
    expect(db.users.some((u) => u.email === 'lea.martin@example.com')).toBe(false)
  })
})
