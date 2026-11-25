import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReplanOutput, ReplanResponse } from '../../../../src/shared/ai/replan.js'
import { FakeSupabase } from '../../testing/fake-supabase.js'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null }))
vi.mock('../../supabaseAdmin.js', () => ({ getSupabaseAdmin: () => state.db?.client }))

const { POST } = await import('../../../ai/run.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const OTHER_PROJECT = '33333333-3333-4333-8333-333333333333'
const MAEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SACHA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FINANCE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const LATE = '44444444-4444-4444-8444-444444444441'
const FINE = '44444444-4444-4444-8444-444444444442'
const PROPOSED = '44444444-4444-4444-8444-444444444443'
const PROPOSED_TICKET = '55555555-5555-4555-8555-555555555555'
const RULE = '66666666-6666-4666-8666-666666666666'

// Mercredi 25 novembre 2026, Paris.
const NOW = new Date('2026-11-25T10:00:00Z')
const REASSIGN = `reassign:${LATE}:${SACHA}`
const MOVE = `due:${LATE}:2026-11-25`

let db: FakeSupabase
let stream: ReturnType<typeof vi.spyOn>

function call(body: Record<string, unknown> = {}, token: string | null = 'mael-token'): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return POST(new Request('https://app.test/api/ai/run', { method: 'POST', headers, body: JSON.stringify({ action: 'replan', ...body }) }))
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error
}

function claudeReturns(output: ReplanOutput): void {
  const message = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(output) }], usage: { input_tokens: 1, output_tokens: 1 } }
  stream.mockReturnValue({ finalMessage: () => Promise.resolve(message) } as never)
}

function taskRow(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organization_id: ORG,
    project_id: PROJECT,
    ticket_id: null,
    title: 'Maquette de l’accueil',
    skill: 'dev',
    estimate_hours: 2,
    assignee_member_id: MAEL,
    status: 'todo',
    depends_on_task_id: null,
    due_date: null,
    priority: 'medium',
    position: 1,
    ...overrides,
  }
}

const taskById = (id: string) => db.rows('tasks').find((t) => t.id === id)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
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
    { id: MAEL, organization_id: ORG, user_id: mael.id, name: 'Maël', email: 'mael@sordulo.fr', role: 'admin', skills: { dev: 4 } },
    { id: SACHA, organization_id: ORG, user_id: sacha.id, name: 'Sacha', email: 'sacha@sordulo.fr', role: 'membre', skills: { dev: 3, design: 5 } },
    { id: FINANCE, organization_id: ORG, user_id: finance.id, name: 'Compta', email: 'compta@sordulo.fr', role: 'finance' },
  ])
  db.seed('projects', [
    { id: PROJECT, organization_id: ORG, name: 'App Ibé' },
    { id: OTHER_PROJECT, organization_id: OTHER_ORG, name: 'Ailleurs' },
  ])
  db.seed('tickets', [{ id: PROPOSED_TICKET, organization_id: ORG, project_id: PROJECT, status: 'proposed' }])
  db.seed('tasks', [
    // Urgence : priorité haute en retard.
    taskRow(LATE, { priority: 'high', due_date: '2026-11-20' }),
    taskRow(FINE, { due_date: '2026-11-27', title: 'Tâche tranquille' }),
    // Tâche d'un ticket encore proposé : ignorée (pas du travail engagé).
    taskRow(PROPOSED, { ticket_id: PROPOSED_TICKET, priority: 'high', due_date: '2026-11-01' }),
  ])
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  state.db = null
})

describe('action replan', () => {
  it('refuse un rôle qui n’est ni admin ni membre', async () => {
    const response = await call({ projectId: PROJECT }, 'finance-token')
    expect(response.status).toBe(403)
    expect(stream).not.toHaveBeenCalled()
  })

  it('refuse un projet d’une autre organisation et un projet inconnu', async () => {
    expect((await call({ projectId: OTHER_PROJECT })).status).toBe(403)
    expect((await call({ projectId: '77777777-7777-4777-8777-777777777777' })).status).toBe(404)
  })

  it('refuse un projectId invalide', async () => {
    const response = await call({ projectId: 'pas-un-uuid' })
    expect(response.status).toBe(400)
    expect(await errorOf(response)).toContain('projectId')
  })

  it('aucun problème : ni Claude ni proposition', async () => {
    taskById(LATE)!.status = 'done'
    const response = await call()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ proposals: [], issueCount: 0 })
    expect(stream).not.toHaveBeenCalled()
    expect(db.rows('ai_proposals')).toEqual([])
  })

  it('Claude choisit parmi les candidats : proposition en attente avec avant / après exacts', async () => {
    claudeReturns({ proposals: [{ candidate_ids: [REASSIGN], title: 'Confier la maquette à Sacha', explanation: 'Elle est en retard. Sacha a de la place.' }] })
    const response = await call({ projectId: PROJECT })
    expect(response.status).toBe(200)
    const body = (await response.json()) as ReplanResponse
    expect(body.issueCount).toBe(1)
    expect(body.proposals).toHaveLength(1)

    const [row] = db.rows('ai_proposals')
    expect(row).toMatchObject({
      organization_id: ORG,
      project_id: PROJECT,
      kind: 'reassign_task',
      status: 'pending',
      title: 'Confier la maquette à Sacha',
      payload: {
        operations: [{ task_id: LATE, before: { assignee_member_id: MAEL }, after: { assignee_member_id: SACHA } }],
        member_ids: [MAEL, SACHA],
      },
    })
    // Rien n'est appliqué tant que personne n'a validé.
    expect(taskById(LATE)?.assignee_member_id).toBe(MAEL)

    // Le message donne les ids des candidats, jamais la tâche du ticket proposé.
    const request = stream.mock.calls[0]![0] as { messages: { content: string }[] }
    const message = request.messages[0]!.content
    expect(message).toContain(`[${REASSIGN}]`)
    expect(message).toContain(`[${MOVE}]`)
    expect(message).not.toContain(PROPOSED)
  })

  it('une opération hors liste rejette la proposition', async () => {
    claudeReturns({
      proposals: [
        { candidate_ids: [`reassign:${FINE}:${SACHA}`], title: 'Inventée', explanation: 'Hors liste.' },
        { candidate_ids: [REASSIGN, `due:${LATE}:2027-01-01`], title: 'Mélange', explanation: 'Une est inventée.' },
      ],
    })
    const response = await call()
    expect(response.status).toBe(200)
    expect(((await response.json()) as ReplanResponse).proposals).toEqual([])
    expect(db.rows('ai_proposals')).toEqual([])
  })

  it('ne recrée pas une proposition identique en attente, et exclut ses tâches', async () => {
    db.seed('ai_proposals', [
      {
        id: crypto.randomUUID(),
        organization_id: ORG,
        project_id: PROJECT,
        kind: 'reassign_task',
        title: 'Déjà proposée',
        status: 'pending',
        payload: { operations: [{ task_id: LATE, before: { assignee_member_id: MAEL }, after: { assignee_member_id: SACHA } }] },
      },
    ])
    const response = await call()
    expect(await response.json()).toEqual({ proposals: [], issueCount: 0 })
    expect(stream).not.toHaveBeenCalled()
    expect(db.rows('ai_proposals')).toHaveLength(1)
  })

  it('règle « Toujours » active : appliquée tout de suite, enregistrée appliquée automatiquement', async () => {
    db.seed('ai_autonomy_rules', [
      { id: RULE, organization_id: ORG, kind: 'move_due_date', scope: { project_id: PROJECT }, created_by: MAEL, revoked_at: null },
    ])
    claudeReturns({ proposals: [{ candidate_ids: [MOVE], title: 'Ramener l’échéance à aujourd’hui', explanation: 'En retard.' }] })
    const response = await call()
    expect(response.status).toBe(200)
    const [row] = db.rows('ai_proposals')
    expect(row).toMatchObject({ status: 'auto_applied', rule_id: RULE, kind: 'move_due_date' })
    expect(typeof row?.decided_at).toBe('string')
    expect(taskById(LATE)?.due_date).toBe('2026-11-25')
  })

  it('une règle révoquée ou d’un autre type ne s’applique pas', async () => {
    db.seed('ai_autonomy_rules', [
      { id: RULE, organization_id: ORG, kind: 'reassign_task', scope: {}, created_by: MAEL, revoked_at: null },
      { id: crypto.randomUUID(), organization_id: ORG, kind: 'move_due_date', scope: {}, created_by: MAEL, revoked_at: '2026-11-01T00:00:00Z' },
    ])
    claudeReturns({ proposals: [{ candidate_ids: [MOVE], title: 'Ramener l’échéance', explanation: 'En retard.' }] })
    await call()
    expect(db.rows('ai_proposals')[0]).toMatchObject({ status: 'pending' })
    expect(taskById(LATE)?.due_date).toBe('2026-11-20')
  })

  it('l’échec de l’enregistrement d’une proposition appliquée remet les tâches comme avant', async () => {
    db.seed('ai_autonomy_rules', [{ id: RULE, organization_id: ORG, kind: 'move_due_date', scope: {}, created_by: MAEL, revoked_at: null }])
    claudeReturns({ proposals: [{ candidate_ids: [MOVE], title: 'Ramener l’échéance', explanation: 'En retard.' }] })
    db.failNext('ai_proposals', 'insert', { message: 'boum' })
    const response = await call()
    expect(response.status).toBe(500)
    expect(taskById(LATE)?.due_date).toBe('2026-11-20')
  })
})
