import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseStudyOutput } from '../../../../src/shared/ai/caseStudy.js'
import { FakeSupabase } from '../../testing/fake-supabase.js'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null }))
vi.mock('../../supabaseAdmin.js', () => ({
  getSupabaseAdmin: () => state.db?.client,
}))

const { POST } = await import('../../../ai/run.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const CLIENT = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const DELIVERABLE = '44444444-4444-4444-8444-444444444444'
const VERSION = '55555555-5555-4555-8555-555555555555'
const MAEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SACHA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FINANCE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

let db: FakeSupabase
let stream: ReturnType<typeof vi.spyOn>

function call(token: string | null = 'mael-token', projectId = PROJECT): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return POST(
    new Request('https://app.test/api/ai/run', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'caseStudy', projectId }),
    }),
  )
}

function claudeReturns(output: CaseStudyOutput): void {
  const message = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(output) }],
    usage: { input_tokens: 1, output_tokens: 1 },
  }
  stream.mockReturnValue({
    finalMessage: () => Promise.resolve(message),
  } as never)
}

const output: CaseStudyOutput = {
  title: 'Une app plus claire pour Ibé',
  hook: 'Ibé voulait une app que ses clients comprennent seuls.',
  context: 'Ibé est une jeune société.',
  challenge: 'Simplifier la page Finance.',
  solution: 'Refonte de la page Finance et du menu.',
  results: ['Page Finance refaite en 2 écrans', 'Taux de conversion multiplié par 3'],
  client_quote: { text: 'Le menu est enfin clair', author: 'Inventé' },
}

beforeEach(() => {
  db = new FakeSupabase()
  state.db = db
  vi.stubEnv('ANTHROPIC_API_KEY', 'test')
  vi.stubEnv('ANTHROPIC_MODEL', 'claude-test')
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  stream = vi.spyOn(Anthropic.Messages.prototype, 'stream')
  const mael = db.addUser('mael@sordulo.fr', { token: 'mael-token' })
  const sacha = db.addUser('sacha@sordulo.fr', { token: 'sacha-token' })
  const finance = db.addUser('compta@sordulo.fr', { token: 'finance-token' })
  db.seed('members', [
    {
      id: MAEL,
      organization_id: ORG,
      user_id: mael.id,
      name: 'Maël',
      email: 'mael@sordulo.fr',
      role: 'admin',
    },
    {
      id: SACHA,
      organization_id: ORG,
      user_id: sacha.id,
      name: 'Sacha',
      email: 'sacha@sordulo.fr',
      role: 'membre',
    },
    {
      id: FINANCE,
      organization_id: ORG,
      user_id: finance.id,
      name: 'Compta',
      email: 'compta@sordulo.fr',
      role: 'finance',
    },
  ])
  db.seed('clients', [{ id: CLIENT, organization_id: ORG, name: 'Ibé' }])
  db.seed('projects', [
    {
      id: PROJECT,
      organization_id: ORG,
      client_id: CLIENT,
      name: 'App Ibé',
      status: 'delivered',
      showcase: 'showable',
      case_study: null,
      start_date: null,
      due_date: null,
    },
  ])
  db.seed('tickets', [
    {
      id: crypto.randomUUID(),
      project_id: PROJECT,
      title: 'Revoir la page Finance',
      description: 'Page refaite en 2 écrans',
      status: 'done',
    },
    {
      id: crypto.randomUUID(),
      project_id: PROJECT,
      title: 'Ticket pas fini',
      description: 'Encore en cours',
      status: 'validated',
    },
  ])
  db.seed('deliverables', [
    {
      id: DELIVERABLE,
      project_id: PROJECT,
      title: 'Maquettes Finance',
      description: null,
      status: 'approved',
      position: 1,
    },
  ])
  db.seed('deliverable_versions', [{ id: VERSION, deliverable_id: DELIVERABLE }])
  db.seed('deliverable_comments', [
    {
      id: crypto.randomUUID(),
      version_id: VERSION,
      body: 'Super boulot, le menu est enfin clair !',
      author_name: 'Claire',
      from_client: true,
    },
    {
      id: crypto.randomUUID(),
      version_id: VERSION,
      body: 'Note interne',
      author_name: null,
      from_client: false,
    },
  ])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('action caseStudy', () => {
  it('enregistre l’étude : résultats sans chiffre inventé, citation vérifiée, livrables de la base', async () => {
    claudeReturns(output)
    const response = await call()
    expect(response.status).toBe(200)
    const saved = db.rows('projects')[0]!.case_study as Record<string, unknown>
    expect(saved).toMatchObject({
      title: 'Une app plus claire pour Ibé',
      summary: 'Ibé voulait une app que ses clients comprennent seuls.',
      status: 'draft',
      deliverables: ['Maquettes Finance'],
      results: '- Page Finance refaite en 2 écrans',
      client_quote: { text: 'Le menu est enfin clair', author: 'Claire' },
    })
    expect(JSON.stringify(saved)).not.toContain('multiplié par 3')
  })

  it('écarte une citation qui n’est pas dans les commentaires du client', async () => {
    claudeReturns({
      ...output,
      client_quote: { text: 'Un travail exceptionnel', author: 'Claire' },
    })
    await call()
    expect((db.rows('projects')[0]!.case_study as { client_quote: unknown }).client_quote).toBeNull()
  })

  it('refuse un projet sous NDA, sans appeler Claude ni écrire', async () => {
    db.rows('projects')[0]!.showcase = 'nda'
    const response = await call()
    expect(response.status).toBe(403)
    expect(((await response.json()) as { error: string }).error).toContain('NDA')
    expect(stream).not.toHaveBeenCalled()
    expect(db.rows('projects')[0]!.case_study).toBeNull()
  })

  it('refuse un projet à définir ou pas encore livré', async () => {
    db.rows('projects')[0]!.showcase = 'unknown'
    expect((await call()).status).toBe(409)
    db.rows('projects')[0]!.showcase = 'showable'
    db.rows('projects')[0]!.status = 'in_progress'
    expect((await call()).status).toBe(409)
    expect(stream).not.toHaveBeenCalled()
  })

  it('droits : admin et membre oui ; finance non ; sans session 401 ; projet inconnu 404', async () => {
    claudeReturns(output)
    expect((await call('sacha-token')).status).toBe(200)
    expect((await call('finance-token')).status).toBe(403)
    expect((await call(null)).status).toBe(401)
    expect((await call('mael-token', '66666666-6666-4666-8666-666666666666')).status).toBe(404)
  })
})
