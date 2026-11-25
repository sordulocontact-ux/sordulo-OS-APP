import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXTERNAL_REF_MAX_LENGTH, MARKERS_MAX, type CreateInputResponse } from '../../src/shared/api-contract.js'
import { FakeSupabase } from '../_lib/testing/fake-supabase.js'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null, processed: [] as string[] }))
vi.mock('../_lib/supabaseAdmin.js', () => ({ getSupabaseAdmin: () => state.db?.client }))
vi.mock('../_lib/pipeline.js', () => ({
  processInput: async (inputId: string) => {
    state.processed.push(inputId)
  },
}))
vi.mock('../_lib/storage.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../_lib/storage.js')>()),
  createSignedUpload: async (path: string) => ({ path, token: 'upload-token', bucket: 'audio' }),
}))

const { POST, cleanExternalRef, normalizeMarkers } = await import('./create.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const SECOND_PROJECT = '44444444-4444-4444-8444-444444444444'
const OTHER_PROJECT = '55555555-5555-4555-8555-555555555555'
const APP = 'https://sordulo-os-app.vercel.app'
const MESSAGE_ID = '<CAF=abc123@mail.gmail.com>'

let db: FakeSupabase

function create(body: unknown, token: string | null = 'member-token'): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return POST(new Request(`${APP}/api/inputs/create`, { method: 'POST', headers, body: JSON.stringify(body) }))
}

const written = (extra: Record<string, unknown> = {}) => ({ projectId: PROJECT, kind: 'written', rawText: 'Le bouton est trop petit.', ...extra })
const meeting = (extra: Record<string, unknown> = {}) => ({
  projectId: PROJECT,
  kind: 'meeting',
  title: 'Point hebdo',
  fileName: 'appel.mp3',
  contentType: 'audio/mpeg',
  sizeBytes: 1000,
  ...extra,
})

beforeEach(() => {
  db = new FakeSupabase()
  state.db = db
  state.processed = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const user = db.addUser('sacha@sordulo.fr', { token: 'member-token', lastSignInAt: '2026-11-01T10:00:00Z' })
  const other = db.addUser('bob@autre.fr', { token: 'other-token', lastSignInAt: '2026-11-01T10:00:00Z' })
  db.seed('members', [
    { organization_id: ORG, user_id: user.id, name: 'Sacha', email: 'sacha@sordulo.fr', role: 'membre' },
    { organization_id: OTHER_ORG, user_id: other.id, name: 'Bob', email: 'bob@autre.fr', role: 'admin' },
  ])
  db.seed('projects', [
    { id: PROJECT, organization_id: ORG, name: 'App Ibé' },
    { id: SECOND_PROJECT, organization_id: ORG, name: 'Site Ibé' },
    { id: OTHER_PROJECT, organization_id: OTHER_ORG, name: 'Projet B' },
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('normalizeMarkers', () => {
  it('arrondit au dixième, trie et retire les doublons', () => {
    expect(normalizeMarkers([75.26, 3.04, 12, 75.3, 0])).toEqual([0, 3, 12, 75.3])
  })
  it('sans repère : []', () => {
    expect(normalizeMarkers(undefined)).toEqual([])
    expect(normalizeMarkers([])).toEqual([])
  })
})

describe('cleanExternalRef', () => {
  it('retire les espaces, null si vide', () => {
    expect(cleanExternalRef(`  ${MESSAGE_ID} `)).toBe(MESSAGE_ID)
    expect(cleanExternalRef('   ')).toBeNull()
    expect(cleanExternalRef(undefined)).toBeNull()
  })
})

describe('POST /api/inputs/create : réunion avec moments marqués', () => {
  it('enregistre les repères triés et arrondis', async () => {
    const response = await create(meeting({ markers: [125.47, 12.04, 600] }))
    expect(response.status).toBe(201)
    const { input, upload } = (await response.json()) as CreateInputResponse
    expect(input.markers).toEqual([12, 125.5, 600])
    expect(upload?.token).toBe('upload-token')
    expect(db.rows('inputs')[0]?.markers).toEqual([12, 125.5, 600])
  })

  it('sans repère : []', async () => {
    const response = await create(meeting())
    expect(response.status).toBe(201)
    expect(db.rows('inputs')[0]?.markers).toEqual([])
  })

  it('400 pour un repère négatif, pas un nombre, ou trop de repères', async () => {
    for (const markers of [[-1], ['12'], [null], 12, Array.from({ length: MARKERS_MAX + 1 }, (_, i) => i)]) {
      const response = await create(meeting({ markers }))
      expect(response.status).toBe(400)
    }
    expect(db.rows('inputs')).toHaveLength(0)
  })

  it(`accepte ${MARKERS_MAX} repères`, async () => {
    const markers = Array.from({ length: MARKERS_MAX }, (_, i) => i * 10)
    expect((await create(meeting({ markers }))).status).toBe(201)
    expect(db.rows('inputs')[0]?.markers).toHaveLength(MARKERS_MAX)
  })
})

describe('POST /api/inputs/create : retour écrit avec origine externe', () => {
  it('sans origine : external_ref null et analyse lancée', async () => {
    const response = await create(written())
    expect(response.status).toBe(201)
    expect(db.rows('inputs')[0]?.external_ref).toBeNull()
    expect(state.processed).toHaveLength(1)
  })

  it('enregistre l’origine sans espaces autour', async () => {
    const response = await create(written({ externalRef: `  ${MESSAGE_ID}  ` }))
    expect(response.status).toBe(201)
    const { input } = (await response.json()) as CreateInputResponse
    expect(input.external_ref).toBe(MESSAGE_ID)
    expect(state.processed).toEqual([input.id])
  })

  it('origine blanche : ignorée', async () => {
    expect((await create(written({ externalRef: '   ' }))).status).toBe(201)
    expect(db.rows('inputs')[0]?.external_ref).toBeNull()
  })

  it('400 pour une origine trop longue', async () => {
    const response = await create(written({ externalRef: 'x'.repeat(EXTERNAL_REF_MAX_LENGTH + 1) }))
    expect(response.status).toBe(400)
    expect(db.rows('inputs')).toHaveLength(0)
    expect((await create(written({ externalRef: ` ${'x'.repeat(EXTERNAL_REF_MAX_LENGTH)} ` }))).status).toBe(201)
  })

  it('409 avec l’entrée existante quand le mail a déjà été analysé, même depuis un autre projet', async () => {
    const first = (await (await create(written({ externalRef: MESSAGE_ID }))).json()) as CreateInputResponse
    const response = await create(written({ projectId: SECOND_PROJECT, externalRef: ` ${MESSAGE_ID}` }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; inputId?: string; projectId?: string }
    expect(body.error).toContain('déjà été analysé')
    expect(body).toMatchObject({ inputId: first.input.id, projectId: PROJECT })
    expect(db.rows('inputs')).toHaveLength(1)
    expect(state.processed).toEqual([first.input.id])
  })

  it('la même origine dans une autre organisation crée une entrée', async () => {
    await create(written({ externalRef: MESSAGE_ID }))
    const response = await create(written({ projectId: OTHER_PROJECT, externalRef: MESSAGE_ID }), 'other-token')
    expect(response.status).toBe(201)
    expect(db.rows('inputs')).toHaveLength(2)
  })

  it('envoi simultané (index unique) : 409 sans analyse lancée', async () => {
    db.failNext('inputs', 'insert', { message: 'duplicate key value violates unique constraint', code: '23505' })
    const response = await create(written({ externalRef: MESSAGE_ID }))
    expect(response.status).toBe(409)
    expect(((await response.json()) as { error: string }).error).toContain('déjà été analysé')
    expect(state.processed).toEqual([])
  })

  it('403 hors de l’organisation, rien de révélé sur l’entrée existante', async () => {
    await create(written({ externalRef: MESSAGE_ID }))
    const response = await create(written({ externalRef: MESSAGE_ID }), 'other-token')
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain('inputId')
  })
})
