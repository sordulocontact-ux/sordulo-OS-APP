import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisContext } from './analysis.js'
import type { ProcessedTicket } from './analysis-postprocess.js'
import { FakeSupabase } from './testing/fake-supabase.js'

const state = vi.hoisted(() => ({
  db: null as FakeSupabase | null,
  contexts: [] as AnalysisContext[],
  tickets: [] as ProcessedTicket[],
}))
vi.mock('./supabaseAdmin.js', () => ({ getSupabaseAdmin: () => state.db?.client }))
vi.mock('./analysis.js', () => ({
  analyzeInput: async (ctx: AnalysisContext) => {
    state.contexts.push(ctx)
    return state.tickets
  },
}))

const { processInput } = await import('./pipeline.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const INPUT = '33333333-3333-4333-8333-333333333333'
const MAEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SACHA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PAUL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ZOE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

let db: FakeSupabase

function ticket(title: string): ProcessedTicket {
  return {
    title,
    description: title,
    type: 'modification',
    priority: 'medium',
    source_quote: null,
    area: null,
    related_ticket_id: null,
    tasks: [{ title, skill: 'dev', estimate_hours: 1, depends_on_index: null }],
  }
}

function seed(toneOfVoice: string | null): void {
  db.seed('projects', [
    { id: PROJECT, organization_id: ORG, client_id: null, name: 'App Ibé', status: 'in_progress', tone_of_voice: toneOfVoice },
  ])
  db.seed('inputs', [
    {
      id: INPUT,
      organization_id: ORG,
      project_id: PROJECT,
      kind: 'written',
      title: null,
      raw_text: 'Le bouton est trop petit.',
      transcript: null,
      speaker_names: {},
      status: 'analyzing',
      updated_at: '2026-11-20T10:00:00Z',
    },
  ])
  // Paul (prospection) et Zoé (retirée) sont les moins chargés, mais ne doivent jamais être choisis.
  db.seed('members', [
    { id: MAEL, organization_id: ORG, name: 'Maël', email: 'mael@sordulo.fr', role: 'admin' },
    { id: SACHA, organization_id: ORG, name: 'Sacha', email: 'sacha@sordulo.fr', role: 'membre' },
    { id: PAUL, organization_id: ORG, name: 'Aaron', email: 'paul@sordulo.fr', role: 'prospection' },
    { id: ZOE, organization_id: ORG, name: 'Abel', email: 'zoe@sordulo.fr', role: 'membre', removed_at: '2026-11-10T10:00:00Z' },
  ])
}

const assignees = () => db.rows('tasks').map((task) => task.assignee_member_id)

beforeEach(() => {
  db = new FakeSupabase()
  state.db = db
  state.contexts = []
  state.tickets = [ticket('Agrandir le bouton'), ticket('Changer la couleur'), ticket('Revoir le menu')]
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('processInput : ton de voix', () => {
  it('transmet le ton de voix du projet à l’analyse', async () => {
    seed('Chaleureux, tutoiement')
    await processInput(INPUT)
    expect(state.contexts).toHaveLength(1)
    expect(state.contexts[0]?.toneOfVoice).toBe('Chaleureux, tutoiement')
    expect(db.rows('inputs')[0]?.status).toBe('ready')
  })

  it('transmet null quand le projet n’a pas de ton de voix', async () => {
    seed(null)
    await processInput(INPUT)
    expect(state.contexts[0]?.toneOfVoice).toBeNull()
  })
})

describe('processInput : attribution', () => {
  it('écarte les membres retirés et le rôle prospection', async () => {
    seed(null)
    await processInput(INPUT)
    expect(db.rows('tickets')).toHaveLength(3)
    expect(new Set(assignees())).toEqual(new Set([MAEL, SACHA]))
  })

  it('se limite aux membres affectés au projet', async () => {
    seed(null)
    db.seed('project_members', [
      { project_id: PROJECT, member_id: SACHA, organization_id: ORG },
      { project_id: PROJECT, member_id: PAUL, organization_id: ORG },
    ])
    await processInput(INPUT)
    expect(assignees()).toEqual([SACHA, SACHA, SACHA])
  })

  it('retombe sur toute l’équipe active si aucun membre du projet n’est attribuable', async () => {
    seed(null)
    db.seed('project_members', [
      { project_id: PROJECT, member_id: PAUL, organization_id: ORG },
      { project_id: PROJECT, member_id: ZOE, organization_id: ORG },
    ])
    await processInput(INPUT)
    expect(new Set(assignees())).toEqual(new Set([MAEL, SACHA]))
  })

  it('laisse les tâches sans personne s’il n’y a aucun candidat', async () => {
    seed(null)
    for (const member of db.rows('members')) member.role = 'prospection'
    await processInput(INPUT)
    expect(db.rows('inputs')[0]?.status).toBe('ready')
    expect(assignees()).toEqual([null, null, null])
    expect(db.rows('tickets').map((t) => t.assignment_note)).toEqual([null, null, null])
  })
})
