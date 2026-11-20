import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSupabase } from './testing/fake-supabase.js'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null }))
vi.mock('./supabaseAdmin.js', () => ({ getSupabaseAdmin: () => state.db?.client }))

const { requireOrgAdmin, requireOrgMember } = await import('./auth.js')
const { HttpError } = await import('./http.js')

const ORG = '11111111-1111-4111-8111-111111111111'
let db: FakeSupabase

beforeEach(() => {
  db = new FakeSupabase()
  state.db = db
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function statusOf(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise
    return 'ok'
  } catch (error) {
    if (error instanceof HttpError) return error.status
    throw error
  }
}

describe('requireOrgMember', () => {
  it('refuse un membre retiré relié à son compte', async () => {
    const user = db.addUser('ancien@sordulo.fr')
    db.seed('members', [{ organization_id: ORG, user_id: user.id, name: 'Ancien', email: 'ancien@sordulo.fr', removed_at: '2026-11-10T10:00:00Z' }])
    expect(await statusOf(requireOrgMember({ id: user.id, email: user.email }, ORG))).toBe(403)
  })

  it('ne relie pas par email un membre retiré', async () => {
    const user = db.addUser('ancien@sordulo.fr')
    db.seed('members', [{ organization_id: ORG, name: 'Ancien', email: 'Ancien@sordulo.fr', removed_at: '2026-11-10T10:00:00Z' }])
    expect(await statusOf(requireOrgMember({ id: user.id, email: user.email }, ORG))).toBe(403)
    expect(db.rows('members')[0]?.user_id).toBeNull()
  })

  it('relie par email un membre actif à sa première connexion', async () => {
    const user = db.addUser('lea@example.com')
    db.seed('members', [{ organization_id: ORG, name: 'Léa', email: 'Lea@Example.com' }])
    const member = await requireOrgMember({ id: user.id, email: user.email }, ORG)
    expect(member.user_id).toBe(user.id)
  })
})

describe('requireOrgAdmin', () => {
  it('accepte un admin actif, refuse un membre ou un admin retiré', async () => {
    const admin = db.addUser('mael@sordulo.fr')
    const membre = db.addUser('sacha@sordulo.fr')
    const ancien = db.addUser('ancien@sordulo.fr')
    db.seed('members', [
      { organization_id: ORG, user_id: admin.id, name: 'Maël', email: 'mael@sordulo.fr', role: 'admin' },
      { organization_id: ORG, user_id: membre.id, name: 'Sacha', email: 'sacha@sordulo.fr', role: 'membre' },
      { organization_id: ORG, user_id: ancien.id, name: 'Ancien', email: 'ancien@sordulo.fr', role: 'admin', removed_at: '2026-11-10T10:00:00Z' },
    ])
    expect(await statusOf(requireOrgAdmin({ id: admin.id, email: admin.email }, ORG))).toBe('ok')
    expect(await statusOf(requireOrgAdmin({ id: membre.id, email: membre.email }, ORG))).toBe(403)
    expect(await statusOf(requireOrgAdmin({ id: ancien.id, email: ancien.email }, ORG))).toBe(403)
  })
})
