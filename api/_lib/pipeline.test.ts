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
    assignee_member_id: null,
    assignment_reason: null,
    tasks: [{ title, skill: 'dev', estimate_hours: 1, depends_on_index: null }],
  }
}

function seed(toneOfVoice: string | null, aiInstructions: string | null = null): void {
  db.seed('projects', [
    {
      id: PROJECT,
      organization_id: ORG,
      client_id: null,
      name: 'App Ibé',
      status: 'in_progress',
      tone_of_voice: toneOfVoice,
      ai_instructions: aiInstructions,
    },
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

describe('processInput : mémoire du projet', () => {
  it('transmet les consignes du projet et l’équipe attribuable à l’analyse', async () => {
    seed(null, '- Maël s’occupe des pages Finance')
    await processInput(INPUT)
    expect(state.contexts[0]?.aiInstructions).toBe('- Maël s’occupe des pages Finance')
    expect(state.contexts[0]?.team).toEqual([
      { id: MAEL, name: 'Maël' },
      { id: SACHA, name: 'Sacha' },
    ])
  })

  it('donne le ticket à la personne désignée par la consigne, avec la raison', async () => {
    seed(null, '- Sacha s’occupe des visuels')
    state.tickets = [
      { ...ticket('Refaire le logo'), assignee_member_id: SACHA, assignment_reason: 'Sacha s’occupe des visuels' },
      { ...ticket('Changer la bannière'), assignee_member_id: SACHA, assignment_reason: null },
      ticket('Corriger le menu'),
    ]
    await processInput(INPUT)
    const rows = db.rows('tickets')
    const byTitle = (title: string) => rows.find((t) => t.title === title)
    expect(byTitle('Refaire le logo')?.assignment_note).toBe('Consigne du projet : Sacha s’occupe des visuels')
    expect(byTitle('Changer la bannière')?.assignment_note).toBe('Consigne du projet : attribution demandée')
    // La charge de Sacha a augmenté : le ticket suivant, sans consigne, va à Maël.
    const taskOf = (title: string) => db.rows('tasks').find((t) => t.ticket_id === byTitle(title)?.id)
    expect(taskOf('Refaire le logo')?.assignee_member_id).toBe(SACHA)
    expect(taskOf('Changer la bannière')?.assignee_member_id).toBe(SACHA)
    expect(taskOf('Corriger le menu')?.assignee_member_id).toBe(MAEL)
  })

  it('ignore une consigne qui désigne une personne hors des candidats', async () => {
    seed(null)
    state.tickets = [{ ...ticket('Refaire le logo'), assignee_member_id: PAUL, assignment_reason: 'Paul fait les logos' }]
    await processInput(INPUT)
    expect(db.rows('tasks')[0]?.assignee_member_id).not.toBe(PAUL)
    expect(String(db.rows('tickets')[0]?.assignment_note)).not.toContain('Consigne')
  })
})
