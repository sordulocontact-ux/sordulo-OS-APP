import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { RevisionSchema, type Revision, type RevisionTicket } from '../../src/shared/analysis-schema.js'
import { emptyWorkload } from '../../src/shared/assignment.js'
import type { Input, Member } from '../../src/shared/types.js'
import { ANALYSIS_SYSTEM_PROMPT } from './analysis.js'
import {
  buildRevisionMessage,
  currentTickets,
  normalizeInstructions,
  planRevision,
  REVISION_INPUT_MAX_CHARS,
  REVISION_SYSTEM_PROMPT,
  reviseTickets,
  truncateForPrompt,
  type CurrentTicket,
  type RevisionPromptContext,
  type RevisionTaskRow,
} from './revision.js'
import { FakeSupabase } from './testing/fake-supabase.js'

const MAEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SACHA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const OUTSIDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const T1 = '44444444-4444-4444-8444-444444444441'
const T2 = '44444444-4444-4444-8444-444444444442'
const TODAY = new Date('2026-11-18T10:00:00Z') // mercredi

function member(id: string, name: string): Member {
  return {
    id,
    organization_id: 'org',
    user_id: null,
    name,
    email: `${name}@sordulo.fr`,
    role: 'membre',
    skills: {},
    weekly_capacity_hours: 35,
    unavailable_weekdays: [],
    invited_at: null,
    removed_at: null,
    created_at: '',
    updated_at: '',
  }
}
const candidates = [member(MAEL, 'Maël'), member(SACHA, 'Sacha')]

function current(overrides: Partial<CurrentTicket> = {}): CurrentTicket {
  return {
    id: T1,
    title: 'Revoir la page Finance',
    description: 'Description',
    type: 'modification',
    priority: 'medium',
    area: 'Finance',
    source_quote: 'citation',
    assigneeMemberId: MAEL,
    dbAssigneeMemberId: MAEL,
    assignmentNote: 'Maël : le moins de travail en cours (0 h)',
    estimateHours: 1,
    skill: 'dev',
    taskIds: ['task-1'],
    ...overrides,
  }
}

function out(overrides: Partial<RevisionTicket> = {}): RevisionTicket {
  return {
    id: T1,
    title: 'Revoir la page Finance',
    description: 'Description',
    type: 'modification',
    priority: 'medium',
    area: 'Finance',
    source_quote: 'citation',
    assignee_member_id: MAEL,
    assignment_reason: null,
    skill: 'dev',
    estimate_hours: 1,
    ...overrides,
  }
}

const revision = (tickets: RevisionTicket[]): Revision => ({ tickets, project_instructions: '' })

describe('REVISION_SYSTEM_PROMPT', () => {
  it('reprend les règles de l’analyse puis ajoute celles de la révision', () => {
    expect(REVISION_SYSTEM_PROMPT.startsWith(ANALYSIS_SYSTEM_PROMPT)).toBe(true)
    for (const fragment of ['id null', 'project_instructions', 'préférences durables', 'moins de 3000 caractères', 'assignee_member_id']) {
      expect(REVISION_SYSTEM_PROMPT).toContain(fragment)
    }
  })

  it('reste stable (aucune date ni identifiant) pour le cache', () => {
    expect(REVISION_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(REVISION_SYSTEM_PROMPT).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i)
    expect(REVISION_SYSTEM_PROMPT).not.toContain('—')
  })

  it('a une sortie structurée sans contrainte non prise en charge par l’API', () => {
    const schema = JSON.stringify(zodOutputFormat(RevisionSchema).schema)
    for (const keyword of ['"format"', '"minimum"', '"maximum"', '"minLength"', '"maxLength"', '"pattern"']) {
      expect(schema).not.toContain(keyword)
    }
  })
})

describe('currentTickets', () => {
  const row = {
    id: T1,
    title: 'Titre en base',
    description: 'Description en base',
    type: 'bug' as const,
    priority: 'low' as const,
    area: 'Finance',
    source_quote: 'citation',
    assignment_note: 'Maël : raison',
  }
  const task = (overrides: Partial<RevisionTaskRow>): RevisionTaskRow => ({
    id: 'task-1',
    ticket_id: T1,
    title: 'Titre en base',
    skill: 'design',
    estimate_hours: 1.5,
    assignee_member_id: MAEL,
    ...overrides,
  })

  it('lit la base quand l’écran n’envoie rien', () => {
    expect(currentTickets([row], [task({})], [])[0]).toMatchObject({
      title: 'Titre en base',
      assigneeMemberId: MAEL,
      dbAssigneeMemberId: MAEL,
      assignmentNote: 'Maël : raison',
      estimateHours: 1.5,
      skill: 'design',
      taskIds: ['task-1'],
    })
  })

  it('prend l’état de l’écran, et oublie la raison si la personne a changé', () => {
    const screen = {
      id: T1.toUpperCase(),
      title: 'Titre écran',
      description: 'Description écran',
      type: 'modification' as const,
      priority: 'high' as const,
      area: '  Page   Finance ',
      assigneeMemberId: SACHA,
      estimateHours: Number.NaN,
    }
    const [ticket] = currentTickets([row], [task({})], [screen])
    expect(ticket).toMatchObject({
      title: 'Titre écran',
      priority: 'high',
      area: 'Page Finance',
      assigneeMemberId: SACHA,
      dbAssigneeMemberId: MAEL,
      assignmentNote: null,
      estimateHours: null,
    })
  })

  it('n’a pas de personne commune quand les tâches sont partagées, et additionne les durées connues', () => {
    const [ticket] = currentTickets(
      [row],
      [task({}), task({ id: 'task-2', assignee_member_id: SACHA, estimate_hours: null }), task({ id: 'x', ticket_id: T2 })],
      [],
    )
    expect(ticket).toMatchObject({ assigneeMemberId: null, dbAssigneeMemberId: null, estimateHours: 1.5, taskIds: ['task-1', 'task-2'] })
  })
})

describe('planRevision', () => {
  it('garde un ticket non concerné tel quel, sans le compter comme modifié', () => {
    const plan = planRevision(revision([out()]), [current()], candidates, emptyWorkload(), TODAY)
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0]).toMatchObject({
      changed: false,
      assigneeMemberId: MAEL,
      fields: { assignment_note: 'Maël : le moins de travail en cours (0 h)' },
    })
    expect(plan.inserts).toEqual([])
    expect(plan.deleteIds).toEqual([])
  })

  it('réattribue avec la raison de la consigne, ou « Demandé dans la note »', () => {
    const withReason = planRevision(
      revision([out({ assignee_member_id: SACHA, assignment_reason: ' Sacha fait la Finance ' })]),
      [current()],
      candidates,
      emptyWorkload(),
      TODAY,
    )
    expect(withReason.updates[0]).toMatchObject({ assigneeMemberId: SACHA, changed: true, fields: { assignment_note: 'Consigne : Sacha fait la Finance' } })
    const withoutReason = planRevision(revision([out({ assignee_member_id: SACHA })]), [current()], candidates, emptyWorkload(), TODAY)
    expect(withoutReason.updates[0]?.fields.assignment_note).toBe('Demandé dans la note')
    const sameWithReason = planRevision(
      revision([out({ assignee_member_id: MAEL, assignment_reason: 'Maël fait la Finance' })]),
      [current()],
      candidates,
      emptyWorkload(),
      TODAY,
    )
    expect(sameWithReason.updates[0]?.fields.assignment_note).toBe('Consigne : Maël fait la Finance')
  })

  it('garde la personne courante si l’id renvoyé est hors des candidats ou null', () => {
    for (const id of [OUTSIDER, null, 'n’importe quoi']) {
      const plan = planRevision(revision([out({ assignee_member_id: id, assignment_reason: 'x' })]), [current()], candidates, emptyWorkload(), TODAY)
      expect(plan.updates[0]).toMatchObject({ assigneeMemberId: MAEL, fields: { assignment_note: 'Maël : le moins de travail en cours (0 h)' } })
    }
  })

  it('garde le titre, la description et la citation actuels si la sortie les laisse vides', () => {
    const plan = planRevision(
      revision([out({ title: '  ', description: '', source_quote: ' ', estimate_hours: -1, area: '' })]),
      [current()],
      candidates,
      emptyWorkload(),
      TODAY,
    )
    expect(plan.updates[0]).toMatchObject({
      fields: { title: 'Revoir la page Finance', description: 'Description', source_quote: 'citation', area: null },
      estimateHours: null,
    })
  })

  it('crée les tickets sans id, inconnus ou en double, et supprime les absents', () => {
    const plan = planRevision(
      revision([out({ id: T1 }), out({ id: T1, title: 'Copie' }), out({ id: 'inconnu', title: '' }), out({ id: null, title: 'Nouveau' })]),
      [current(), current({ id: T2 })],
      candidates,
      emptyWorkload(),
      TODAY,
    )
    expect(plan.updates.map((u) => u.current.id)).toEqual([T1])
    expect(plan.inserts.map((t) => t.fields.title)).toEqual(['Copie', 'Nouveau ticket', 'Nouveau'])
    expect(plan.deleteIds).toEqual([T2])
  })

  it('attribue un nouveau ticket par la charge, après celle des tickets gardés', () => {
    const plan = planRevision(
      revision([out({ estimate_hours: 3 }), out({ id: null, area: 'Export', assignee_member_id: null, estimate_hours: 1 })]),
      [current()],
      candidates,
      emptyWorkload(),
      TODAY,
    )
    expect(plan.inserts[0]).toMatchObject({ assigneeMemberId: SACHA, estimateHours: 1 })
    expect(plan.inserts[0]?.fields.assignment_note).toMatch(/^Sacha : /)
  })

  it('laisse un nouveau ticket sans personne s’il n’y a aucun candidat', () => {
    const plan = planRevision(revision([out({ id: null, assignee_member_id: MAEL })]), [current()], [], emptyWorkload(), TODAY)
    expect(plan.inserts[0]).toMatchObject({ assigneeMemberId: null, fields: { assignment_note: null } })
  })
})

describe('buildRevisionMessage', () => {
  function ctx(overrides: Partial<RevisionPromptContext> = {}): RevisionPromptContext {
    return {
      clientName: 'Ibé',
      projectName: 'App Ibé',
      toneOfVoice: null,
      aiInstructions: null,
      team: [{ id: MAEL, name: 'Maël' }],
      knownAreas: ['Finance'],
      tickets: [current(), current({ id: T2, assigneeMemberId: OUTSIDER, estimateHours: null, skill: null })],
      input: { kind: 'written', title: null, rawText: 'La page Finance est confuse.', transcript: null, speakerNames: {} },
      note: '  Fusionne tout.  ',
      ...overrides,
    }
  }

  it('contient le projet, l’équipe, les tickets, l’entrée puis la note', () => {
    const message = buildRevisionMessage(ctx())
    expect(message).toContain("Consignes de l'équipe : aucune")
    expect(message).toContain(`<ticket id="${T1}">`)
    expect(message).toContain(`Personne : Maël (id: ${MAEL})`)
    expect(message).toContain('Personne : une personne hors de <equipe>')
    expect(message).toContain('Estimation : inconnue')
    expect(message).toContain('Compétence : non renseignée')
    expect(message).toContain('<note>\nFusionne tout.\n</note>')
    expect(message.indexOf('<tickets_proposes>')).toBeLessThan(message.indexOf('<entree'))
    expect(message.indexOf('<entree')).toBeLessThan(message.indexOf('<note>'))
  })

  it('met en forme une réunion et tronque une entrée trop longue', () => {
    const utterances = Array.from({ length: 4000 }, (_, i) => ({ speaker: 0, start: i, end: i + 1, text: `Phrase numéro ${i} assez longue pour remplir.` }))
    const message = buildRevisionMessage(
      ctx({ input: { kind: 'meeting', title: 'Réunion', rawText: null, transcript: { provider: 'x', language: 'fr', duration_seconds: 1, utterances }, speakerNames: { '0': 'Ibé' } } }),
    )
    expect(message).toContain('[0:00] Ibé : Phrase numéro 0')
    expect(message).toContain("[… suite de l'entrée tronquée]")
    expect(message.length).toBeLessThan(REVISION_INPUT_MAX_CHARS + 5000)
  })

  it('ne casse pas sur une entrée vide', () => {
    expect(buildRevisionMessage(ctx({ input: { kind: 'written', title: null, rawText: ' ', transcript: null, speakerNames: {} } }))).toContain(
      "(texte de l'entrée indisponible)",
    )
  })
})

describe('truncateForPrompt et normalizeInstructions', () => {
  it('coupe à une fin de ligne proche de la limite', () => {
    expect(truncateForPrompt('court', 10)).toBe('court')
    expect(truncateForPrompt('aaaaaaaaa\nbbbbbbbbbb', 11)).toBe("aaaaaaaaa\n[… suite de l'entrée tronquée]")
  })

  it('normalise la mémoire du projet', () => {
    expect(normalizeInstructions('  - a  ')).toBe('- a')
    expect(normalizeInstructions('   ')).toBeNull()
    expect(normalizeInstructions(null)).toBeNull()
    expect(normalizeInstructions('x'.repeat(5000))).toHaveLength(4000)
  })
})

describe('reviseTickets : ticket à plusieurs tâches', () => {
  const ORG = '11111111-1111-4111-8111-111111111111'
  const PROJECT = '22222222-2222-4222-8222-222222222222'
  const INPUT = '33333333-3333-4333-8333-333333333333'
  let db: FakeSupabase

  beforeEach(() => {
    db = new FakeSupabase()
    vi.stubEnv('ANTHROPIC_API_KEY', 'test')
    vi.stubEnv('ANTHROPIC_MODEL', 'claude-test')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    db.seed('members', [
      { id: MAEL, organization_id: ORG, name: 'Maël', email: 'mael@sordulo.fr', role: 'admin' },
      { id: SACHA, organization_id: ORG, name: 'Sacha', email: 'sacha@sordulo.fr', role: 'membre' },
    ])
    db.seed('projects', [{ id: PROJECT, organization_id: ORG, client_id: null, name: 'App Ibé', tone_of_voice: null, ai_instructions: null }])
    db.seed('tickets', [
      {
        id: T1,
        organization_id: ORG,
        project_id: PROJECT,
        input_id: INPUT,
        title: 'Revoir la page Finance',
        description: 'Description',
        type: 'modification',
        priority: 'medium',
        source_quote: 'citation',
        status: 'proposed',
        area: 'Finance',
        assignment_note: null,
        created_at: '2026-11-20T10:00:00Z',
      },
    ])
    db.seed('tasks', [
      { id: 'task-1', organization_id: ORG, project_id: PROJECT, ticket_id: T1, title: 'Maquette', skill: 'design', estimate_hours: 1, assignee_member_id: SACHA, position: 0 },
      { id: 'task-2', organization_id: ORG, project_id: PROJECT, ticket_id: T1, title: 'Intégration', skill: 'dev', estimate_hours: 1, assignee_member_id: MAEL, position: 1 },
    ])
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const input = {
    id: INPUT,
    organization_id: ORG,
    project_id: PROJECT,
    kind: 'written',
    title: null,
    raw_text: 'La page Finance est confuse.',
    transcript: null,
    speaker_names: {},
    status: 'ready',
    updated_at: '2026-11-20T10:00:00Z',
  } as unknown as Input

  function claudeReturns(output: Revision): void {
    db.seed('inputs', [input as unknown as Record<string, unknown>])
    const message = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(output) }], usage: { input_tokens: 1, output_tokens: 1 } }
    vi.spyOn(Anthropic.Messages.prototype, 'stream').mockReturnValue({ finalMessage: () => Promise.resolve(message) } as never)
  }

  it('met la personne désignée sur toutes les tâches, sans toucher leurs titres', async () => {
    claudeReturns({ tickets: [out({ title: 'Revoir la page Finance', assignee_member_id: MAEL, assignment_reason: 'Maël fait la Finance' })], project_instructions: '- Maël fait la Finance' })
    const result = await reviseTickets(db.client as unknown as SupabaseClient, input, { note: 'Tout à Maël', tickets: [] })
    expect(result).toMatchObject({ updated: 1, created: 0, deleted: 0, memoryChanged: true, aiInstructions: '- Maël fait la Finance' })
    expect(db.rows('tasks').map((t) => [t.title, t.assignee_member_id])).toEqual([
      ['Maquette', MAEL],
      ['Intégration', MAEL],
    ])
  })

  it('ne retire pas les personnes d’un ticket partagé quand rien n’est désigné', async () => {
    claudeReturns({ tickets: [out({ title: 'Nouveau titre', assignee_member_id: null })], project_instructions: '' })
    await reviseTickets(db.client as unknown as SupabaseClient, input, { note: 'Renomme', tickets: [] })
    expect(db.rows('tasks').map((t) => t.assignee_member_id)).toEqual([SACHA, MAEL])
    expect(db.rows('tickets')[0]?.title).toBe('Nouveau titre')
  })
})
