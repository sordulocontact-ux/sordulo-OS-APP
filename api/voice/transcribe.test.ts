import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VOICE_NOTE_MAX_BYTES, type TranscribeVoiceResponse } from '../../src/shared/api-contract.js'
import { FakeSupabase } from '../_lib/testing/fake-supabase.js'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null }))
vi.mock('../_lib/supabaseAdmin.js', () => ({ getSupabaseAdmin: () => state.db?.client }))

const { POST } = await import('./transcribe.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444'
const APP = 'https://sordulo-os-app.vercel.app'

let db: FakeSupabase
const fetchMock = vi.fn()

function send(
  options: { projectId?: string; token?: string | null; type?: string | null; body?: BodyInit; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers = new Headers(options.headers)
  const token = options.token === undefined ? 'member-token' : options.token
  if (token) headers.set('authorization', `Bearer ${token}`)
  const type = options.type === undefined ? 'audio/webm;codecs=opus' : options.type
  if (type) headers.set('content-type', type)
  const query = options.projectId === undefined ? PROJECT : options.projectId
  return POST(
    new Request(`${APP}/api/voice/transcribe?projectId=${query}`, {
      method: 'POST',
      headers,
      body: options.body === undefined ? new Uint8Array([1, 2, 3, 4]) : options.body,
    }),
  )
}

function deepgram(transcript: string): Response {
  return new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript }] }] } }), { status: 200 })
}

beforeEach(() => {
  db = new FakeSupabase()
  state.db = db
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('TRANSCRIPTION_API_KEY', 'dg-key')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  const member = db.addUser('sacha@sordulo.fr', { token: 'member-token', lastSignInAt: '2026-11-01T10:00:00Z' })
  const stranger = db.addUser('autre@example.com', { token: 'stranger-token', lastSignInAt: '2026-11-01T10:00:00Z' })
  db.seed('members', [
    { organization_id: ORG, user_id: member.id, name: 'Sacha', email: 'sacha@sordulo.fr', role: 'membre' },
    { organization_id: OTHER_ORG, user_id: stranger.id, name: 'Autre', email: 'autre@example.com', role: 'membre' },
  ])
  db.seed('projects', [{ id: PROJECT, organization_id: ORG, name: 'App Ibé' }])
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('POST /api/voice/transcribe', () => {
  it('400 si projectId invalide', async () => {
    const response = await send({ projectId: 'pas-un-guid' })
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('401 sans session', async () => {
    expect((await send({ token: null })).status).toBe(401)
  })

  it('404 si le projet est introuvable', async () => {
    expect((await send({ projectId: OTHER_PROJECT })).status).toBe(404)
  })

  it('403 pour un non-membre de l’organisation du projet', async () => {
    const response = await send({ token: 'stranger-token' })
    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('415 pour un type qui n’est pas de l’audio', async () => {
    const response = await send({ type: 'application/json' })
    expect(response.status).toBe(415)
    expect(((await response.json()) as { error: string }).error).toBe('Format audio non pris en charge.')
    expect((await send({ type: null })).status).toBe(415)
  })

  it('413 si Content-Length dépasse la limite', async () => {
    const response = await send({ headers: { 'content-length': String(VOICE_NOTE_MAX_BYTES + 1) } })
    expect(response.status).toBe(413)
    expect(((await response.json()) as { error: string }).error).toBe('Note vocale trop longue (4 Mo max).')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('413 si la taille réelle dépasse la limite', async () => {
    const response = await send({ body: new Uint8Array(VOICE_NOTE_MAX_BYTES + 1) })
    expect(response.status).toBe(413)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('400 si le corps est vide', async () => {
    const response = await send({ body: new Uint8Array(0) })
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('422 si aucune parole', async () => {
    fetchMock.mockResolvedValue(deepgram('   '))
    const response = await send()
    expect(response.status).toBe(422)
    expect(((await response.json()) as { error: string }).error).toBe("Aucune parole détectée dans l'enregistrement.")
  })

  it('502 si Deepgram échoue', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ err_msg: 'boom' }), { status: 500 }))
    const response = await send()
    expect(response.status).toBe(502)
    expect(((await response.json()) as { error: string }).error).toContain('transcription')
  })

  it('200 avec le texte transcrit, audio envoyé tel quel à Deepgram', async () => {
    fetchMock.mockResolvedValue(deepgram('  Ajoute un bouton de partage.  '))
    const response = await send()
    expect(response.status).toBe(200)
    expect((await response.json()) as TranscribeVoiceResponse).toEqual({ text: 'Ajoute un bouton de partage.' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const params = new URL(url).searchParams
    expect(params.get('model')).toBe('nova-3')
    expect(params.get('language')).toBe('fr')
    expect(params.get('diarize')).toBeNull()
    expect((init.headers as Record<string, string>).authorization).toBe('Token dg-key')
    expect((init.headers as Record<string, string>)['content-type']).toBe('audio/webm')
  })

  it('accepte video/webm', async () => {
    fetchMock.mockResolvedValue(deepgram('Bonjour.'))
    expect((await send({ type: 'video/webm' })).status).toBe(200)
  })
})
