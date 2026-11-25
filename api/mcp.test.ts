import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashMcpToken } from './_lib/mcp/auth.js'
import { LATEST_PROTOCOL_VERSION } from './_lib/mcp/server.js'
import { FakeSupabase } from './_lib/testing/fake-supabase.js'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null }))
vi.mock('./_lib/supabaseAdmin.js', () => ({ getSupabaseAdmin: () => state.db?.client }))

const { POST, GET, DELETE } = await import('./mcp.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const MEMBRE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const FINANCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const APPORTEUR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'
const REMOVED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'
const STRANGER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9'
const CLIENT = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
const OTHER_CLIENT = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc9'
const PROJECT = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'
const OTHER_PROJECT = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd9'
const TASK = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'
const TASK_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
const OTHER_TASK = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9'

/** Jeton au bon format, distinct par nom. */
const tokenFor = (name: string) => `sdo_${name.padEnd(43, 'x').slice(0, 43)}`
const TOKENS = {
  admin: tokenFor('admin'),
  membre: tokenFor('membre'),
  finance: tokenFor('finance'),
  apporteur: tokenFor('apporteur'),
  removed: tokenFor('removed'),
  revoked: tokenFor('revoked'),
  stranger: tokenFor('stranger'),
}

let db: FakeSupabase

async function seedToken(token: string, memberId: string, organizationId: string, revoked = false) {
  db.seed('api_tokens', [
    {
      id: crypto.randomUUID(),
      organization_id: organizationId,
      member_id: memberId,
      name: 'Claude Code',
      token_hash: await hashMcpToken(token),
      prefix: token.slice(0, 12),
      last_used_at: null,
      created_at: '2026-11-01T10:00:00Z',
      revoked_at: revoked ? '2026-11-02T10:00:00Z' : null,
    },
  ])
}

function post(body: unknown, token: string | null = TOKENS.membre): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json', accept: 'application/json, text/event-stream' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return POST(new Request('https://app.test/api/mcp', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }))
}

interface RpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

async function rpc(method: string, params: unknown = {}, token: string | null = TOKENS.membre): Promise<RpcResponse> {
  const response = await post({ jsonrpc: '2.0', id: 1, method, params }, token)
  expect(response.status).toBe(200)
  return (await response.json()) as RpcResponse
}

interface ToolCallResult {
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

async function call(name: string, args: Record<string, unknown> = {}, token: string = TOKENS.membre): Promise<ToolCallResult> {
  const response = await rpc('tools/call', { name, arguments: args }, token)
  expect(response.error).toBeUndefined()
  return response.result as unknown as ToolCallResult
}

async function toolNames(token: string): Promise<string[]> {
  const response = await rpc('tools/list', {}, token)
  return (response.result?.tools as { name: string }[]).map((t) => t.name)
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T10:00:00Z'))
  db = new FakeSupabase()
  state.db = db
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})

  db.seed('members', [
    { id: ADMIN, organization_id: ORG, name: 'Sacha', email: 'sacha@sordulo.test', role: 'admin' },
    { id: MEMBRE, organization_id: ORG, name: 'Maël', email: 'mael@sordulo.test', role: 'membre' },
    { id: FINANCE, organization_id: ORG, name: 'Fanny', email: 'fanny@sordulo.test', role: 'finance' },
    { id: APPORTEUR, organization_id: ORG, name: 'Gabriela', email: 'gabriela@sordulo.test', role: 'prospection' },
    { id: REMOVED, organization_id: ORG, name: 'Ancien', email: 'ancien@sordulo.test', role: 'membre', removed_at: '2026-10-01T10:00:00Z' },
    { id: STRANGER, organization_id: OTHER_ORG, name: 'Autre', email: 'autre@autre.test', role: 'admin' },
  ])
  await seedToken(TOKENS.admin, ADMIN, ORG)
  await seedToken(TOKENS.membre, MEMBRE, ORG)
  await seedToken(TOKENS.finance, FINANCE, ORG)
  await seedToken(TOKENS.apporteur, APPORTEUR, ORG)
  await seedToken(TOKENS.removed, REMOVED, ORG)
  await seedToken(TOKENS.revoked, MEMBRE, ORG, true)
  await seedToken(TOKENS.stranger, STRANGER, OTHER_ORG)

  db.seed('clients', [
    { id: CLIENT, organization_id: ORG, name: 'Ibé', website: 'https://ibe.test', archived_at: null, created_at: '2026-01-01T00:00:00Z' },
    { id: OTHER_CLIENT, organization_id: OTHER_ORG, name: 'Ibé Autre', website: null, archived_at: null, created_at: '2026-01-01T00:00:00Z' },
  ])
  db.seed('projects', [
    { id: PROJECT, organization_id: ORG, client_id: CLIENT, name: 'App Ibé', status: 'in_progress', start_date: null, due_date: '2026-12-15', created_at: '2026-02-01T00:00:00Z' },
    { id: OTHER_PROJECT, organization_id: OTHER_ORG, client_id: OTHER_CLIENT, name: 'Site Ibé Autre', status: 'in_progress', start_date: null, due_date: null, created_at: '2026-02-01T00:00:00Z' },
  ])
  const task = (id: string, org: string, project: string, title: string, over: Record<string, unknown> = {}) => ({
    id,
    organization_id: org,
    project_id: project,
    ticket_id: null,
    title,
    skill: 'dev',
    estimate_hours: 2,
    assignee_member_id: null,
    status: 'todo',
    depends_on_task_id: null,
    position: 1,
    due_date: null,
    priority: 'medium',
    created_at: '2026-11-01T00:00:00Z',
    ...over,
  })
  db.seed('tasks', [
    task(TASK, ORG, PROJECT, 'Écran de connexion Ibé', { assignee_member_id: MEMBRE, due_date: '2026-11-25', position: 1 }),
    task(TASK_2, ORG, PROJECT, 'Menu principal', { assignee_member_id: MEMBRE, due_date: '2026-11-18', priority: 'high', position: 2 }),
    task(OTHER_TASK, OTHER_ORG, OTHER_PROJECT, 'Tâche Ibé Autre', { position: 7 }),
  ])
  db.seed('tickets', [
    { id: crypto.randomUUID(), organization_id: ORG, project_id: PROJECT, title: 'Connexion', type: 'new_request', priority: 'high', status: 'validated', area: 'Compte', created_at: '2026-11-01T00:00:00Z' },
    { id: crypto.randomUUID(), organization_id: ORG, project_id: PROJECT, title: 'Ancien ticket', type: 'bug', priority: 'low', status: 'done', area: null, created_at: '2026-10-01T00:00:00Z' },
  ])
  db.seed('quotes', [
    { id: crypto.randomUUID(), organization_id: ORG, client_id: CLIENT, project_id: PROJECT, number: '2026-012', title: 'App Ibé V1', status: 'accepted', total_ttc_cents: 600000, issue_date: '2026-10-01', created_at: '2026-10-01T00:00:00Z' },
    { id: crypto.randomUUID(), organization_id: OTHER_ORG, client_id: OTHER_CLIENT, project_id: OTHER_PROJECT, number: '2026-099', title: 'Ibé Autre', status: 'sent', total_ttc_cents: 100, issue_date: '2026-10-01', created_at: '2026-10-01T00:00:00Z' },
  ])
  const invoice = (org: string, over: Record<string, unknown>) => ({
    id: crypto.randomUUID(),
    organization_id: org,
    client_id: CLIENT,
    project_id: PROJECT,
    number: '2026-001',
    title: 'Acompte App Ibé',
    kind: 'invoice',
    status: 'paid',
    due_date: null,
    paid_at: null,
    total_ht_cents: 0,
    total_ttc_cents: 0,
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  })
  db.seed('invoices', [
    invoice(ORG, { kind: 'deposit', paid_at: '2026-11-05T09:00:00Z', total_ht_cents: 200000, total_ttc_cents: 240000 }),
    invoice(ORG, { number: '2026-002', paid_at: '2026-03-10T09:00:00Z', total_ht_cents: 100000, total_ttc_cents: 120000 }),
    invoice(ORG, { number: '2026-003', status: 'issued', due_date: '2026-11-01', total_ht_cents: 50000, total_ttc_cents: 60000 }),
    invoice(ORG, { number: 'A-2026-001', kind: 'credit_note', paid_at: '2026-11-06T09:00:00Z', total_ht_cents: -10000, total_ttc_cents: -12000 }),
    invoice(OTHER_ORG, { number: '2026-777', paid_at: '2026-11-07T09:00:00Z', total_ht_cents: 999900, total_ttc_cents: 999900 }),
  ])
  db.seed('prospects', [
    { id: crypto.randomUUID(), organization_id: ORG, company: 'Boulangerie Ibé', contact_name: null, contact_email: null, website: null, stage: 'to_contact', next_action_date: '2026-11-22', owner_member_id: APPORTEUR, created_by: APPORTEUR, do_not_contact: false, created_at: '2026-11-01T00:00:00Z' },
    { id: crypto.randomUUID(), organization_id: ORG, company: 'Garage Martin', contact_name: null, contact_email: null, website: null, stage: 'meeting', next_action_date: null, owner_member_id: ADMIN, created_by: ADMIN, do_not_contact: false, created_at: '2026-11-01T00:00:00Z' },
    { id: crypto.randomUUID(), organization_id: ORG, company: 'Fleuriste perdu', contact_name: null, contact_email: null, website: null, stage: 'lost', next_action_date: null, owner_member_id: ADMIN, created_by: ADMIN, do_not_contact: true, created_at: '2026-11-01T00:00:00Z' },
    { id: crypto.randomUUID(), organization_id: OTHER_ORG, company: 'Prospect Autre', contact_name: null, contact_email: null, website: null, stage: 'to_contact', next_action_date: null, owner_member_id: STRANGER, created_by: STRANGER, do_not_contact: false, created_at: '2026-11-01T00:00:00Z' },
  ])
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  state.db = null
})

describe('transport', () => {
  it('GET et DELETE : 405 (serveur sans état, sans flux)', async () => {
    for (const handler of [GET, DELETE]) {
      const response = await handler(new Request('https://app.test/api/mcp', { method: handler === GET ? 'GET' : 'DELETE' }))
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toContain('POST')
    }
  })

  it('notification seule : 202 sans corps', async () => {
    const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
  })

  it('corps qui n’est pas du JSON : erreur d’analyse -32700', async () => {
    const response = await post('{pas du json')
    expect(response.status).toBe(400)
    expect(((await response.json()) as RpcResponse).error?.code).toBe(-32700)
  })
})

describe('authentification', () => {
  it('sans jeton : 401 avec WWW-Authenticate', async () => {
    const response = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, null)
    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('Bearer')
    expect(((await response.json()) as RpcResponse).error?.message).toContain('Jeton manquant')
  })

  it('jeton mal formé, inconnu ou révoqué : 401', async () => {
    for (const token of ['pas-un-jeton', tokenFor('inconnu'), TOKENS.revoked]) {
      expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, token)).status).toBe(401)
    }
  })

  it('membre retiré : 403', async () => {
    expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, TOKENS.removed)).status).toBe(403)
  })

  it('jeton valide : last_used_at mis à jour', async () => {
    const response = await rpc('ping')
    expect(response.result).toEqual({})
    const row = db.rows('api_tokens').find((t) => t.member_id === MEMBRE && t.revoked_at === null)
    expect(row?.last_used_at).toBe('2026-11-20T10:00:00.000Z')
  })
})

describe('JSON-RPC', () => {
  it('initialize : version demandée si acceptée, capacités outils, serveur', async () => {
    const response = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '2' } })
    expect(response.id).toBe(1)
    expect(response.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'sordulo-os', version: '1.0.0' },
    })
  })

  it('initialize : version inconnue → la plus récente', async () => {
    const response = await rpc('initialize', { protocolVersion: '1999-01-01' })
    expect(response.result?.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
  })

  it('lot : réponses des requêtes seulement, dans l’ordre, avec leurs ids', async () => {
    const response = await post([
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'resources/list' },
      { jsonrpc: '1.0', id: 3, method: 'ping' },
    ])
    expect(response.status).toBe(200)
    const body = (await response.json()) as RpcResponse[]
    expect(body.map((r) => r.id)).toEqual(['a', 2, 3])
    expect(body[0]?.result).toEqual({})
    expect(body[1]?.error?.code).toBe(-32601)
    expect(body[2]?.error?.code).toBe(-32600)
  })

  it('lot vide : -32600', async () => {
    const response = await post([])
    expect(((await response.json()) as RpcResponse).error?.code).toBe(-32600)
  })

  it('lot de plus de 20 messages : une seule erreur -32600, rien n’est exécuté ; 20 passent', async () => {
    const createTask = (i: number) => ({
      jsonrpc: '2.0',
      id: i,
      method: 'tools/call',
      params: { name: 'create_task', arguments: { project_id: PROJECT, title: `Tâche ${i}`, skill: 'dev' } },
    })
    const tasksBefore = db.rows('tasks').length
    const tooMany = await post(Array.from({ length: 21 }, (_, i) => createTask(i)), TOKENS.admin)
    expect(tooMany.status).toBe(200)
    const refused = (await tooMany.json()) as RpcResponse
    expect(Array.isArray(refused)).toBe(false)
    expect(refused.id).toBeNull()
    expect(refused.error?.code).toBe(-32600)
    expect(refused.error?.message).toContain('20 au plus')
    expect(db.rows('tasks')).toHaveLength(tasksBefore)

    const twenty = await post(Array.from({ length: 20 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })))
    expect(((await twenty.json()) as RpcResponse[]).length).toBe(20)
  })

  it('corps de plus de 1 Mo : 413 et erreur JSON-RPC, même sans Content-Length fiable', async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(1024 * 1024) } })
    const declared = await post(big)
    expect(declared.status).toBe(413)
    const body = (await declared.json()) as RpcResponse
    expect(body.error?.code).toBe(-32600)
    expect(body.error?.message).toContain('trop volumineuse')

    // Flux sans Content-Length : la lecture s'arrête à la limite.
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 20; i += 1) controller.enqueue(encoder.encode('x'.repeat(64 * 1024)))
        controller.close()
      },
    })
    const headers = new Headers({ 'content-type': 'application/json', authorization: `Bearer ${TOKENS.membre}` })
    const streamed = await POST(new Request('https://app.test/api/mcp', { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit))
    expect(streamed.status).toBe(413)

    // Juste sous la limite : traité normalement.
    const fits = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(1000 * 1000) } })
    expect((await post(fits)).status).toBe(200)
  })

  it('outil inconnu : -32602', async () => {
    const response = await rpc('tools/call', { name: 'drop_database', arguments: {} })
    expect(response.error?.code).toBe(-32602)
  })

  it('tools/list : schémas JSON d’entrée et annotations', async () => {
    const response = await rpc('tools/list', {}, TOKENS.admin)
    const tools = response.result?.tools as { name: string; inputSchema: Record<string, unknown>; annotations: { readOnlyHint: boolean } }[]
    const create = tools.find((t) => t.name === 'create_task')
    expect(create?.inputSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['project_id', 'title', 'skill']) })
    expect(create?.inputSchema).not.toHaveProperty('$schema')
    expect(create?.annotations.readOnlyHint).toBe(false)
    expect(tools.find((t) => t.name === 'search')?.annotations.readOnlyHint).toBe(true)
  })

  it('arguments invalides : résultat en erreur, lisible', async () => {
    const result = await call('update_task', { task_id: TASK })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Rien à modifier')
  })
})

describe('droits par rôle', () => {
  it('chaque rôle ne voit que ses outils', async () => {
    expect(await toolNames(TOKENS.admin)).toEqual([
      'search',
      'list_projects',
      'get_project',
      'list_my_tasks',
      'create_task',
      'update_task',
      'finance_summary',
      'list_prospects',
    ])
    expect(await toolNames(TOKENS.membre)).toEqual(['search', 'list_projects', 'get_project', 'list_my_tasks', 'create_task', 'update_task', 'list_prospects'])
    expect(await toolNames(TOKENS.finance)).toEqual(['search', 'list_projects', 'get_project', 'finance_summary'])
    expect(await toolNames(TOKENS.apporteur)).toEqual(['search', 'list_prospects'])
  })

  it('un outil hors rôle est refusé à l’appel', async () => {
    expect((await call('finance_summary', {}, TOKENS.membre)).isError).toBe(true)
    expect((await call('create_task', { project_id: PROJECT, title: 'X', skill: 'dev' }, TOKENS.finance)).isError).toBe(true)
    expect((await call('list_projects', {}, TOKENS.apporteur)).isError).toBe(true)
    expect(db.rows('tasks')).toHaveLength(3)
  })

  it('search : catégories selon le rôle', async () => {
    const membre = (await call('search', { query: 'ibe' })).structuredContent?.results as Record<string, unknown[]>
    expect(Object.keys(membre).sort()).toEqual(['clients', 'projects', 'prospects', 'tasks'])
    const finance = (await call('search', { query: 'ibe' }, TOKENS.finance)).structuredContent?.results as Record<string, unknown[]>
    expect(Object.keys(finance).sort()).toEqual(['clients', 'invoices', 'projects', 'quotes'])
    expect(finance.quotes).toHaveLength(1)
    const apporteur = (await call('search', { query: 'ibe' }, TOKENS.apporteur)).structuredContent?.results as Record<string, unknown[]>
    expect(Object.keys(apporteur)).toEqual(['prospects'])
  })

  it('get_project : tâches pour le membre, devis et factures pour la finance', async () => {
    const membre = (await call('get_project', { project_id: PROJECT })).structuredContent!
    expect(membre.tasks).toHaveLength(2)
    expect(membre.open_tickets).toHaveLength(1)
    expect(membre).not.toHaveProperty('quotes')
    const finance = (await call('get_project', { project_id: PROJECT }, TOKENS.finance)).structuredContent!
    expect(finance).not.toHaveProperty('tasks')
    expect(finance.quotes).toHaveLength(1)
    expect(finance.invoices).toHaveLength(4)
  })

  it('list_prospects : l’apporteur ne voit que les siens, perdus exclus par défaut', async () => {
    const own = (await call('list_prospects', {}, TOKENS.apporteur)).structuredContent?.prospects as { company: string }[]
    expect(own.map((p) => p.company)).toEqual(['Boulangerie Ibé'])
    const all = (await call('list_prospects', {})).structuredContent?.prospects as { company: string }[]
    expect(all.map((p) => p.company)).toEqual(['Boulangerie Ibé', 'Garage Martin'])
    const closed = (await call('list_prospects', { include_closed: true })).structuredContent?.prospects as unknown[]
    expect(closed).toHaveLength(3)
  })

  it('finance_summary : encaissé du mois et de l’année, impayés', async () => {
    const result = await call('finance_summary', {}, TOKENS.finance)
    expect(result.structuredContent).toMatchObject({
      month: '2026-11',
      collectedMonthCents: 200000,
      collectedYearCents: 300000,
      unpaidCount: 1,
      unpaidCents: 60000,
      overdueCount: 1,
    })
    expect(result.content[0]?.text).toContain('novembre 2026')
  })
})

describe('isolation d’organisation', () => {
  it('search ne renvoie rien d’une autre organisation', async () => {
    const result = await call('search', { query: 'autre' }, TOKENS.admin)
    const results = result.structuredContent?.results as Record<string, unknown[]>
    for (const list of Object.values(results)) expect(list).toEqual([])
    expect(result.content[0]?.text).toContain('Aucun résultat')
  })

  it('get_project, update_task et create_task refusent les objets d’une autre organisation', async () => {
    expect((await call('get_project', { project_id: OTHER_PROJECT })).isError).toBe(true)
    const update = await call('update_task', { task_id: OTHER_TASK, status: 'done' })
    expect(update.isError).toBe(true)
    expect(db.rows('tasks').find((t) => t.id === OTHER_TASK)?.status).toBe('todo')
    expect((await call('create_task', { project_id: OTHER_PROJECT, title: 'Intrusion', skill: 'dev' })).isError).toBe(true)
    expect((await call('create_task', { project_id: PROJECT, title: 'X', skill: 'dev', assignee_member_id: STRANGER })).isError).toBe(true)
  })

  it('le jeton d’une autre organisation ne voit que la sienne', async () => {
    const projects = (await call('list_projects', {}, TOKENS.stranger)).structuredContent?.projects as { id: string }[]
    expect(projects.map((p) => p.id)).toEqual([OTHER_PROJECT])
    const summary = (await call('finance_summary', {}, TOKENS.stranger)).structuredContent
    expect(summary?.collectedMonthCents).toBe(999900)
  })
})

describe('tâches', () => {
  it('list_my_tasks : par échéance, retards comptés', async () => {
    const result = await call('list_my_tasks')
    const tasks = result.structuredContent?.tasks as { id: string }[]
    expect(tasks.map((t) => t.id)).toEqual([TASK_2, TASK])
    expect(result.content[0]?.text).toContain('dont 1 en retard')
  })

  it('create_task : crée sur le projet, attribuée, en dernière position', async () => {
    const result = await call('create_task', {
      project_id: PROJECT,
      title: '  Maquette du profil  ',
      skill: 'design',
      estimate_hours: 3,
      due_date: '2026-11-28',
      priority: 'high',
      assignee_member_id: ADMIN,
    })
    expect(result.isError).toBeUndefined()
    expect(result.content[0]?.text).toContain('attribuée à Sacha')
    const created = db.rows('tasks').find((t) => t.title === 'Maquette du profil')
    expect(created).toMatchObject({ organization_id: ORG, project_id: PROJECT, status: 'todo', skill: 'design', priority: 'high', position: 3, assignee_member_id: ADMIN })
  })

  it('create_task : refuse d’attribuer à la finance ou à un membre retiré', async () => {
    expect((await call('create_task', { project_id: PROJECT, title: 'X', skill: 'dev', assignee_member_id: FINANCE })).isError).toBe(true)
    expect((await call('create_task', { project_id: PROJECT, title: 'X', skill: 'dev', assignee_member_id: REMOVED })).isError).toBe(true)
    expect(db.rows('tasks')).toHaveLength(3)
  })

  it('update_task : statut, échéance retirée, attribution', async () => {
    const result = await call('update_task', { task_id: TASK, status: 'done', due_date: null, assignee_member_id: ADMIN })
    expect(result.isError).toBeUndefined()
    expect(db.rows('tasks').find((t) => t.id === TASK)).toMatchObject({ status: 'done', due_date: null, assignee_member_id: ADMIN })
  })
})
