import Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Revision, RevisionTicket } from '../../src/shared/analysis-schema.js'
import type { ReviseTicketState, ReviseTicketsResponse } from '../../src/shared/api-contract.js'
import { REVISION_SYSTEM_PROMPT } from '../_lib/revision.js'
import { FakeSupabase } from '../_lib/testing/fake-supabase.js'

const state = vi.hoisted(() => ({ db: null as FakeSupabase | null }))
vi.mock('../_lib/supabaseAdmin.js', () => ({ getSupabaseAdmin: () => state.db?.client }))

const { POST } = await import('./revise.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '99999999-9999-4999-8999-999999999999'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const INPUT = '33333333-3333-4333-8333-333333333333'
const MAEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SACHA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FINANCE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const T1 = '44444444-4444-4444-8444-444444444441'
const T2 = '44444444-4444-4444-8444-444444444442'
const T3 = '44444444-4444-4444-8444-444444444443'
const VALIDATED = '44444444-4444-4444-8444-444444444449'
const UNKNOWN = '55555555-5555-4555-8555-555555555555'

let db: FakeSupabase
let stream: ReturnType<typeof vi.spyOn>

function revise(body: unknown, token: string | null = 'mael-token'): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (token) headers.set('authorization', `Bearer ${token}`)
  return POST(new Request('https://app.test/api/review/revise', { method: 'POST', headers, body: JSON.stringify(body) }))
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error
}

function claudeReturns(output: Revision | string): void {
  const text = typeof output === 'string' ? output : JSON.stringify(output)
  const message = { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }
  stream.mockReturnValue({ finalMessage: () => Promise.resolve(message) } as never)
}

function out(overrides: Partial<RevisionTicket>): RevisionTicket {
  return {
    id: null,
    title: 'Ticket',
    description: 'Description',
    type: 'modification',
    priority: 'medium',
    area: 'Général',
    source_quote: '',
    assignee_member_id: null,
    assignment_reason: null,
    skill: 'dev',
    estimate_hours: 1,
    ...overrides,
  }
}

function ticketRow(id: string, title: string, area: string, note: string, createdAt: string, status = 'proposed') {
  return {
    id,
    organization_id: ORG,
    project_id: PROJECT,
    input_id: INPUT,
    title,
    description: `Description de ${title}`,
    type: 'modification',
    priority: 'medium',
    source_quote: `citation ${title}`,
    status,
    related_ticket_id: null,
    area,
    assignment_note: note,
    created_at: createdAt,
  }
}

function taskRow(ticketId: string, title: string, assignee: string, position: number, estimate: number | null = 1) {
  return {
    id: crypto.randomUUID(),
    organization_id: ORG,
    project_id: PROJECT,
    ticket_id: ticketId,
    title,
    skill: 'dev',
    estimate_hours: estimate,
    assignee_member_id: assignee,
    status: 'todo',
    depends_on_task_id: null,
    position,
  }
}

const screenT1: ReviseTicketState = {
  id: T1,
  title: 'Revoir la page Finance (modifié à l’écran)',
  description: 'Description de Revoir la page Finance',
  type: 'modification',
  priority: 'high',
  area: 'Finance',
  assigneeMemberId: MAEL,
  estimateHours: 2,
}

const ticketById = (id: string) => db.rows('tickets').find((t) => t.id === id)
const tasksOf = (id: unknown) => db.rows('tasks').filter((t) => t.ticket_id === id)

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
    { id: MAEL, organization_id: ORG, user_id: mael.id, name: 'Maël', email: 'mael@sordulo.fr', role: 'admin' },
    { id: SACHA, organization_id: ORG, user_id: sacha.id, name: 'Sacha', email: 'sacha@sordulo.fr', role: 'membre' },
    { id: FINANCE, organization_id: ORG, user_id: finance.id, name: 'Compta', email: 'compta@sordulo.fr', role: 'finance' },
  ])
  db.seed('projects', [
    {
      id: PROJECT,
      organization_id: ORG,
      client_id: null,
      name: 'App Ibé',
      status: 'in_progress',
      tone_of_voice: null,
      ai_instructions: '- Sacha s’occupe de l’onboarding',
    },
  ])
  db.seed('inputs', [
    {
      id: INPUT,
      organization_id: ORG,
      project_id: PROJECT,
      kind: 'written',
      title: 'Retour du client',
      raw_text: 'La page Finance est confuse. Le logo est flou. Le menu ne s’ouvre pas.',
      transcript: null,
      speaker_names: {},
      status: 'ready',
      updated_at: '2026-11-20T10:00:00Z',
    },
  ])
  db.seed('tickets', [
    ticketRow(T1, 'Revoir la page Finance', 'Finance', 'Maël : le moins de travail en cours (0 h)', '2026-11-20T10:00:01Z'),
    ticketRow(T2, 'Refaire le logo', 'Logo', 'Sacha : le moins de travail en cours (0 h)', '2026-11-20T10:00:02Z'),
    ticketRow(T3, 'Corriger le menu', 'Menu', 'Maël : 1 h en cours', '2026-11-20T10:00:03Z'),
    ticketRow(VALIDATED, 'Ancien ticket validé', 'Accueil', 'Maël', '2026-11-19T10:00:00Z', 'validated'),
  ])
  db.seed('tasks', [
    taskRow(T1, 'Revoir la page Finance', MAEL, 4),
    taskRow(T2, 'Refaire le logo', SACHA, 5),
    taskRow(T3, 'Corriger le menu', MAEL, 6),
    { ...taskRow(VALIDATED, 'Ancien ticket validé', MAEL, 3), status: 'done' },
  ])
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

const valid = { inputId: INPUT, note: 'Maël s’occupe des pages Finance, et donne-lui le logo.', tickets: [screenT1] }

describe('POST /api/review/revise : validation et droits', () => {
  it('401 sans session', async () => {
    expect((await revise(valid, null)).status).toBe(401)
  })

  it('400 pour une entrée invalide, une note vide ou trop longue, trop de tickets', async () => {
    expect((await revise({ ...valid, inputId: 'abc' })).status).toBe(400)
    const empty = await revise({ ...valid, note: '   \n ' })
    expect(empty.status).toBe(400)
    expect(await errorOf(empty)).toContain('La note est vide.')
    expect((await revise({ ...valid, note: 'x'.repeat(4001) })).status).toBe(400)
    expect((await revise({ ...valid, tickets: Array.from({ length: 101 }, () => screenT1) })).status).toBe(400)
    expect((await revise({ ...valid, tickets: [{ ...screenT1, type: 'feature' }] })).status).toBe(400)
    expect(stream).not.toHaveBeenCalled()
  })

  it('404 pour une entrée introuvable', async () => {
    expect((await revise({ ...valid, inputId: UNKNOWN })).status).toBe(404)
  })

  it('403 pour le rôle finance et pour une autre organisation', async () => {
    const finance = await revise(valid, 'finance-token')
    expect(finance.status).toBe(403)
    expect(await errorOf(finance)).toMatch(/^Accès refusé : /)
    db.rows('inputs')[0]!.organization_id = OTHER_ORG
    expect((await revise(valid)).status).toBe(403)
    expect(stream).not.toHaveBeenCalled()
  })

  it('409 pendant un traitement en cours', async () => {
    Object.assign(db.rows('inputs')[0]!, { status: 'analyzing', updated_at: new Date().toISOString() })
    const response = await revise(valid)
    expect(response.status).toBe(409)
    expect(stream).not.toHaveBeenCalled()
  })

  it('409 sans ticket proposé', async () => {
    for (const t of db.rows('tickets')) t.status = 'validated'
    const response = await revise(valid)
    expect(response.status).toBe(409)
    expect(await errorOf(response)).toContain('Aucun ticket proposé')
    expect(stream).not.toHaveBeenCalled()
  })
})

describe('POST /api/review/revise : application', () => {
  const instructions = '- Sacha s’occupe de l’onboarding\n- Maël s’occupe des pages Finance'

  function happyOutput(): Revision {
    return {
      tickets: [
        // T1 revient à l'identique (état de l'écran), avec la personne actuelle.
        out({
          id: T1,
          title: screenT1.title,
          description: screenT1.description,
          priority: 'high',
          area: 'Finance',
          source_quote: 'citation Revoir la page Finance',
          assignee_member_id: MAEL,
          estimate_hours: 2,
        }),
        // T2 réattribué à Maël par la note, id en majuscules.
        out({
          id: T2.toUpperCase(),
          title: 'Refaire le logo en vectoriel',
          description: 'Le logo est flou.',
          area: 'Logo',
          source_quote: 'Le logo est flou.',
          assignee_member_id: MAEL,
          assignment_reason: 'Demandé dans la note',
          skill: 'design',
          estimate_hours: 0.5,
        }),
        // Nouveau ticket sans personne : calcul de charge.
        out({ id: null, title: 'Ajouter un export CSV', area: 'Export', estimate_hours: 1 }),
        // Id inconnu : traité comme un nouveau ticket.
        out({ id: UNKNOWN, title: 'Ajouter une aide', area: 'Aide', assignee_member_id: SACHA, assignment_reason: 'Sacha fait l’aide' }),
        // T3 absent : supprimé.
      ],
      project_instructions: `  ${instructions}  `,
    }
  }

  it('met à jour, crée, supprime, attribue et enregistre la mémoire', async () => {
    claudeReturns(happyOutput())
    const response = await revise(valid)
    expect(response.status).toBe(200)
    const body = (await response.json()) as ReviseTicketsResponse
    expect(body).toEqual({
      inputId: INPUT,
      updated: 1,
      created: 2,
      deleted: 1,
      aiInstructions: instructions,
      memoryChanged: true,
    } satisfies ReviseTicketsResponse)

    // T1 : l'état de l'écran est enregistré, la personne et sa raison sont gardées.
    expect(ticketById(T1)).toMatchObject({ title: screenT1.title, priority: 'high', assignment_note: 'Maël : le moins de travail en cours (0 h)' })
    expect(tasksOf(T1)[0]).toMatchObject({ title: screenT1.title, estimate_hours: 2, assignee_member_id: MAEL })

    // T2 : contenu et attribution modifiés, une seule tâche mise à jour.
    expect(ticketById(T2)).toMatchObject({
      title: 'Refaire le logo en vectoriel',
      source_quote: 'Le logo est flou.',
      assignment_note: 'Consigne : Demandé dans la note',
    })
    expect(tasksOf(T2)[0]).toMatchObject({ title: 'Refaire le logo en vectoriel', skill: 'design', estimate_hours: 0.5, assignee_member_id: MAEL })

    // T3 supprimé, le ticket validé n'est pas touché.
    expect(ticketById(T3)).toBeUndefined()
    expect(ticketById(VALIDATED)).toBeDefined()

    // Nouveaux tickets : proposés, sur l'entrée, une tâche à la fin des positions.
    const created = db.rows('tickets').filter((t) => ![T1, T2, T3, VALIDATED].includes(t.id as string))
    expect(created.map((t) => t.title)).toEqual(['Ajouter un export CSV', 'Ajouter une aide'])
    for (const t of created) expect(t).toMatchObject({ status: 'proposed', input_id: INPUT, related_ticket_id: null, project_id: PROJECT })
    const csvTask = tasksOf(created[0]!.id)[0]
    const helpTask = tasksOf(created[1]!.id)[0]
    expect(csvTask).toMatchObject({ status: 'todo', position: 7 })
    expect(helpTask).toMatchObject({ position: 8, assignee_member_id: SACHA })
    expect(created[1]!.assignment_note).toBe('Consigne : Sacha fait l’aide')
    // Maël a déjà T1 et T2 (2,5 h) : le nouveau ticket sans consigne va à Sacha.
    expect(csvTask!.assignee_member_id).toBe(SACHA)
    expect(String(created[0]!.assignment_note)).toMatch(/^Sacha : /)

    expect(db.rows('projects')[0]!.ai_instructions).toBe(instructions)
  })

  it('envoie à Claude le prompt de révision, l’état de l’écran, la mémoire, l’équipe et la note', async () => {
    claudeReturns(happyOutput())
    await revise({ ...valid, tickets: [screenT1, { ...screenT1, id: VALIDATED, title: 'Ne doit pas apparaître' }] })
    const request = stream.mock.calls[0]![0] as { system: { text: string }[]; messages: { content: string }[] }
    expect(request.system[0]?.text).toBe(REVISION_SYSTEM_PROMPT)
    const content = request.messages[0]!.content
    expect(content).toContain(`<ticket id="${T1}">\nTitre : ${screenT1.title}`)
    expect(content).toContain(`Personne : Maël (id: ${MAEL})`)
    expect(content).toContain('Estimation : 2 h')
    expect(content).toContain(`<ticket id="${T3}">`)
    expect(content).not.toContain('Ne doit pas apparaître')
    expect(content).toContain("Consignes de l'équipe :\n- Sacha s’occupe de l’onboarding")
    expect(content).toContain(`- id: ${SACHA} | nom: Sacha`)
    expect(content).not.toContain(FINANCE)
    expect(content).toContain('La page Finance est confuse.')
    expect(content).toContain(`<note>\n${valid.note}\n</note>`)
  })

  it('ne touche pas la mémoire si elle est identique', async () => {
    claudeReturns({ ...happyOutput(), project_instructions: '- Sacha s’occupe de l’onboarding\n' })
    const body = (await (await revise(valid)).json()) as ReviseTicketsResponse
    expect(body.memoryChanged).toBe(false)
    expect(body.aiInstructions).toBe('- Sacha s’occupe de l’onboarding')
  })

  it('ne vide jamais la mémoire si Claude renvoie un texte vide', async () => {
    const before = db.rows('projects')[0]!.ai_instructions
    claudeReturns({ ...happyOutput(), project_instructions: '  ' })
    const body = (await (await revise(valid)).json()) as ReviseTicketsResponse
    expect(body.memoryChanged).toBe(false)
    expect(db.rows('projects')[0]!.ai_instructions).toBe(before)
  })

  it('traite un id en double comme un nouveau ticket', async () => {
    claudeReturns({
      tickets: [out({ id: T1, title: 'Partie 1', area: 'Finance' }), out({ id: T1, title: 'Partie 2', area: 'Finance' })],
      project_instructions: '- Sacha s’occupe de l’onboarding',
    })
    const body = (await (await revise({ ...valid, tickets: [] })).json()) as ReviseTicketsResponse
    expect(body).toMatchObject({ updated: 1, created: 1, deleted: 2 })
    expect(ticketById(T1)?.title).toBe('Partie 1')
    expect(db.rows('tickets').some((t) => t.title === 'Partie 2' && t.status === 'proposed')).toBe(true)
  })

  it('502 avec un message français si Claude échoue, sans rien modifier', async () => {
    stream.mockReturnValue({
      finalMessage: () => Promise.reject(Anthropic.APIError.generate(429, { error: { message: 'rate' } }, 'rate', new Headers())),
    } as never)
    const response = await revise(valid)
    expect(response.status).toBe(502)
    expect(await errorOf(response)).toBe('Note non appliquée : limite de requêtes de l’API Claude atteinte, réessaie dans une minute.')
    expect(ticketById(T3)).toBeDefined()
    expect(db.rows('projects')[0]!.ai_instructions).toBe('- Sacha s’occupe de l’onboarding')
  })

  it('502 après deux réponses invalides', async () => {
    claudeReturns('{"tickets": 3}')
    const response = await revise(valid)
    expect(response.status).toBe(502)
    expect(await errorOf(response)).toContain('invalide deux fois')
    expect(stream).toHaveBeenCalledTimes(2)
  })
})
