/**
 * Tests de la migration 0011 : catalogue de prestations (lignes et tâches types), clés service_id / rebilled
 * des lignes de devis, briefs, nouvelles colonnes des projets, propose_tasks_from_quote (idempotente,
 * dépendances résolues).
 * Lancer : npm run test:rls
 */
import { describe, expect, it } from 'vitest'
import {
  ADMIN_A1,
  ADMIN_B,
  CLIENT_A_FULL,
  MEMBRE_A,
  ORG_A,
  ORG_B,
  PROJECT_A_ACTIVE,
  PROJECT_A_ODD,
  PROSP_A,
  count,
  expectCode,
  person,
  q,
  setupDatabase,
  type Who,
} from './harness'

const FIN_A = person(6, 'a', 'finance@a.test')
const SERVICE = 'a0000000-0000-4000-8000-000000000801'
const SERVICE_EMPTY = 'a0000000-0000-4000-8000-000000000802'
const INPUT = 'a0000000-0000-4000-8000-000000000901'

const TEMPLATES = [
  { title: 'Maquettes', skill: 'design', estimate_hours: 8, depends_on: null },
  { title: 'Intégration', skill: 'dev', estimate_hours: 12, depends_on: 0 },
  { title: 'Recette', skill: 'dev', estimate_hours: null, depends_on: 1 },
]

setupDatabase(`
  insert into auth.users (id, email, email_confirmed_at) values ('${FIN_A.user}', '${FIN_A.email}', now());
  insert into public.members (id, organization_id, user_id, name, email, role)
    values ('${FIN_A.member}', '${ORG_A}', '${FIN_A.user}', 'Finance A', '${FIN_A.email}', 'finance');
  insert into public.services (id, organization_id, name, unit, unit_price_cents, task_templates) values
    ('${SERVICE}', '${ORG_A}', 'Site vitrine', 'flat', 500000, '${JSON.stringify(TEMPLATES)}'),
    ('${SERVICE_EMPTY}', '${ORG_A}', 'Conseil', 'hour', 9000, '[]');
  insert into public.inputs (id, project_id, kind, title, raw_text) values ('${INPUT}', '${PROJECT_A_ACTIVE}', 'written', 'Brief', 'Texte');
`)

const line = (label: string, unit_price_cents: number, extra: Record<string, unknown> = {}) => ({
  label,
  description: null,
  quantity: 1,
  unit: 'flat',
  unit_price_cents,
  vat_rate: 20,
  ...extra,
})

async function newQuote(lines: unknown[], projectId: string | null = PROJECT_A_ACTIVE) {
  const [row] = await q<{ id: string; number: string; total_ht_cents: number }>(
    FIN_A,
    `insert into public.quotes (client_id, project_id, title, lines) values ($1, $2, 'Devis', $3::jsonb) returning id, number, total_ht_cents`,
    [CLIENT_A_FULL, projectId, JSON.stringify(lines)],
  )
  return row!
}

const accept = (id: string) => q(FIN_A, `update public.quotes set status = 'accepted' where id = $1`, [id])
const propose = async (who: Who, quoteId: string) =>
  (await q<{ id: string }>(who, `select public.propose_tasks_from_quote($1) as id`, [quoteId]))[0]!.id

const columns = async (table: string) =>
  (
    await q<{ column_name: string }>(
      'postgres',
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
      [table],
    )
  )
    .map((r) => r.column_name)
    .sort()

describe('0011 : schéma', () => {
  it('a les colonnes de src/shared/types.ts', async () => {
    expect(await columns('services')).toEqual(
      [
        'id', 'organization_id', 'name', 'description', 'category', 'unit', 'unit_price_cents', 'vat_rate', 'lines',
        'task_templates', 'active', 'position', 'created_at', 'updated_at',
      ].sort(),
    )
    expect(await columns('briefs')).toEqual(
      ['id', 'organization_id', 'project_id', 'input_id', 'content', 'quote_id', 'created_by', 'created_at', 'updated_at'].sort(),
    )
    expect(await columns('inputs')).toContain('quote_id')
  })

  it('projets : valeurs par défaut et contraintes (rounds, diffusion, étude de cas, jeton du portail)', async () => {
    const [project] = await q<Record<string, unknown>>(
      'postgres',
      `select feedback_rounds_included, showcase, case_study, portal_token from public.projects where id = $1`,
      [PROJECT_A_ACTIVE],
    )
    expect(project).toEqual({ feedback_rounds_included: 2, showcase: 'unknown', case_study: null, portal_token: null })

    const token = 'tok_' + 'x'.repeat(40)
    await q(MEMBRE_A, `update public.projects set portal_token = $2, showcase = 'nda', case_study = '{"title": "Ibé"}' where id = $1`, [
      PROJECT_A_ACTIVE,
      token,
    ])
    await expectCode(q('postgres', `update public.projects set portal_token = $2 where id = $1`, [PROJECT_A_ODD, token]), '23505')
    await expectCode(q('postgres', `update public.projects set portal_token = 'court' where id = $1`, [PROJECT_A_ODD]), '23514')
    await expectCode(q('postgres', `update public.projects set showcase = 'public' where id = $1`, [PROJECT_A_ODD]), '23514')
    await expectCode(q('postgres', `update public.projects set feedback_rounds_included = 21 where id = $1`, [PROJECT_A_ODD]), '23514')
    await expectCode(q('postgres', `update public.projects set case_study = '[]' where id = $1`, [PROJECT_A_ODD]), '23514')
    // La finance lit les projets sans les modifier.
    expect(await q(FIN_A, `update public.projects set portal_token = null where id = $1 returning id`, [PROJECT_A_ACTIVE])).toEqual([])
  })
})

describe('0011 : services', () => {
  it('lus par toute l’organisation (apporteur compris), écrits par admin, membre et finance', async () => {
    for (const who of [ADMIN_A1, MEMBRE_A, FIN_A, PROSP_A]) expect(await count(who, 'public.services')).toBe(2)
    expect(await count(ADMIN_B, 'public.services')).toBe(0)

    await q(MEMBRE_A, `insert into public.services (organization_id, name) values ($1, 'Logo')`, [ORG_A])
    await q(FIN_A, `update public.services set unit_price_cents = 120000 where id = $1`, [SERVICE])
    await expectCode(q(PROSP_A, `insert into public.services (organization_id, name) values ($1, 'X')`, [ORG_A]), '42501')
    await expectCode(q(ADMIN_B, `insert into public.services (organization_id, name) values ($1, 'X')`, [ORG_A]), '42501')
    await expectCode(q(ADMIN_A1, `update public.services set organization_id = $2 where id = $1`, [SERVICE, ORG_B]), '42501')
  })

  it('contrôle les lignes types et les tâches types', async () => {
    const insert = (field: string, value: unknown) =>
      q(ADMIN_A1, `insert into public.services (organization_id, name, ${field}) values ($1, 'X', $2::jsonb)`, [
        ORG_A,
        JSON.stringify(value),
      ])
    await insert('lines', [line('Design', 1000)])
    await expectCode(insert('lines', [line('Design', -1000)]), '23514')
    await expectCode(insert('lines', [{ label: 'Sans prix' }]), '23514')
    await insert('task_templates', TEMPLATES)
    await expectCode(insert('task_templates', [{ title: 'X', skill: 'motion', estimate_hours: 1, depends_on: null }]), '23514')
    await expectCode(insert('task_templates', [{ title: ' ', skill: 'dev' }]), '23514')
    await expectCode(insert('task_templates', [{ title: 'X', skill: 'dev', depends_on: 0 }]), '23514') // elle-même
    await expectCode(insert('task_templates', [{ title: 'X', skill: 'dev', depends_on: 3 }]), '23514') // hors liste
    await expectCode(insert('task_templates', [{ title: 'X', skill: 'dev', estimate_hours: -2 }]), '23514')
    await expectCode(insert('task_templates', {}), '23514')
  })
})

describe('0011 : lignes de devis (service_id, rebilled)', () => {
  it('acceptées et comptées dans les totaux ; types contrôlés', async () => {
    const quote = await newQuote([line('Site', 500000, { service_id: SERVICE }), line('Hébergement', 20000, { rebilled: true })])
    expect(quote.total_ht_cents).toBe(520000)
    await expectCode(newQuote([line('Site', 1000, { service_id: 'pas-un-uuid' })]), '23514')
    await expectCode(newQuote([line('Site', 1000, { service_id: 12 })]), '23514')
    await expectCode(newQuote([line('Frais', 1000, { rebilled: 'oui' })]), '23514')
    await newQuote([line('Site', 1000, { service_id: null, rebilled: null })])
  })
})

describe('0011 : briefs', () => {
  it('admin et membre, une entrée = un brief, entrée du même projet', async () => {
    const [brief] = await q<{ organization_id: string; created_by: string }>(
      MEMBRE_A,
      `insert into public.briefs (project_id, input_id, content) values ($1, $2, '{"contexte": "Refonte"}')
       returning organization_id, created_by`,
      [PROJECT_A_ACTIVE, INPUT],
    )
    expect(brief).toEqual({ organization_id: ORG_A, created_by: MEMBRE_A.member })
    expect(await count(ADMIN_A1, 'public.briefs')).toBe(1)
    for (const who of [FIN_A, PROSP_A, ADMIN_B]) expect(await count(who, 'public.briefs')).toBe(0)

    await expectCode(
      q(ADMIN_A1, `insert into public.briefs (project_id, input_id) values ($1, $2)`, [PROJECT_A_ACTIVE, INPUT]),
      '23505',
    )
    await expectCode(q(ADMIN_A1, `insert into public.briefs (project_id, input_id) values ($1, $2)`, [PROJECT_A_ODD, INPUT]), '23514')
    await expectCode(q(FIN_A, `insert into public.briefs (project_id) values ($1)`, [PROJECT_A_ACTIVE]), '42501')
    await expectCode(q(ADMIN_A1, `insert into public.briefs (project_id, content) values ($1, '[]')`, [PROJECT_A_ACTIVE]), '23514')
  })
})

describe('0011 : propose_tasks_from_quote', () => {
  it('crée l’entrée, les tickets proposés et leurs tâches avec les dépendances ; idempotente', async () => {
    const quote = await newQuote([
      line('Site vitrine', 500000, { service_id: SERVICE, description: 'Cinq pages' }),
      line('Conseil', 90000, { service_id: SERVICE_EMPTY }),
      line('Hébergement', 20000, { rebilled: true }),
    ])
    await accept(quote.id)

    const inputId = await propose(MEMBRE_A, quote.id) // un membre peut lancer la proposition sans lire les devis
    const [input] = await q<Record<string, unknown>>(
      'postgres',
      `select kind, title, status, quote_id, created_by, project_id, raw_text from public.inputs where id = $1`,
      [inputId],
    )
    expect(input).toMatchObject({
      kind: 'written',
      title: `Devis ${quote.number} accepté`,
      status: 'ready',
      quote_id: quote.id,
      created_by: MEMBRE_A.member,
      project_id: PROJECT_A_ACTIVE,
    })
    expect(input?.raw_text).toContain('- Site vitrine : 1 forfait')

    const tickets = await q<Record<string, unknown>>(
      'postgres',
      `select id, title, description, type, priority, status, source_quote from public.tickets where input_id = $1`,
      [inputId],
    )
    expect(tickets).toEqual([
      expect.objectContaining({
        title: 'Site vitrine',
        description: 'Cinq pages',
        type: 'new_request',
        priority: 'medium',
        status: 'proposed',
        source_quote: 'Site vitrine',
      }),
    ])

    const tasks = await q<{ id: string; title: string; skill: string; estimate_hours: string | null; depends_on_task_id: string | null; assignee_member_id: string | null }>(
      'postgres',
      `select id, title, skill, estimate_hours::text, depends_on_task_id, assignee_member_id from public.tasks
       where ticket_id = $1 order by position`,
      [tickets[0]!.id],
    )
    expect(tasks.map((t) => [t.title, t.skill, t.estimate_hours, t.assignee_member_id])).toEqual([
      ['Maquettes', 'design', '8', null],
      ['Intégration', 'dev', '12', null],
      ['Recette', 'dev', null, null],
    ])
    expect(tasks.map((t) => t.depends_on_task_id)).toEqual([null, tasks[0]!.id, tasks[1]!.id])

    // Deuxième appel (autre rôle) : même entrée, rien de recréé.
    expect(await propose(FIN_A, quote.id)).toBe(inputId)
    expect(await count('postgres', `public.tickets where input_id = '${inputId}'`)).toBe(1)
    expect(await count('postgres', `public.inputs where quote_id = '${quote.id}'`)).toBe(1)
  })

  it('le serveur peut aussi la lancer', async () => {
    const quote = await newQuote([line('Site vitrine', 500000, { service_id: SERVICE })])
    await accept(quote.id)
    const inputId = await propose('service_role', quote.id)
    const [input] = await q<{ created_by: string | null }>('postgres', `select created_by from public.inputs where id = $1`, [inputId])
    expect(input?.created_by).toBeNull()
  })

  it('refuse un devis non accepté, sans projet, ou d’un autre rôle / d’une autre organisation', async () => {
    const draft = await newQuote([line('Site vitrine', 500000, { service_id: SERVICE })])
    await expectCode(propose(ADMIN_A1, draft.id), 'P0001', /accepté/)
    const noProject = await newQuote([line('Site vitrine', 500000, { service_id: SERVICE })], null)
    await accept(noProject.id)
    await expectCode(propose(ADMIN_A1, noProject.id), 'P0001', /projet/)

    await accept(draft.id)
    await expectCode(propose(PROSP_A, draft.id), '42501')
    await expectCode(propose(ADMIN_B, draft.id), '42501')
    await expectCode(propose('anon', draft.id), '42501')
  })

  it('une entrée par devis (unicité de inputs.quote_id)', async () => {
    const quote = await newQuote([line('Site vitrine', 500000)])
    await accept(quote.id)
    await q(ADMIN_A1, `insert into public.inputs (project_id, kind, quote_id) values ($1, 'written', $2)`, [PROJECT_A_ACTIVE, quote.id])
    await expectCode(
      q(ADMIN_A1, `insert into public.inputs (project_id, kind, quote_id) values ($1, 'written', $2)`, [PROJECT_A_ACTIVE, quote.id]),
      '23505',
    )
  })
})
