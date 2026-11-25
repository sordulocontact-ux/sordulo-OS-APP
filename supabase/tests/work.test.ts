/**
 * Tests de la migration 0012 : échéance et priorité des tâches, suivi du temps (un seul minuteur en cours,
 * durée calculée, entrée manuelle), absences, compétences ouvertes et affinités, barème de commission.
 * Lancer : npm run test:rls
 */
import { describe, expect, it } from 'vitest'
import {
  ADMIN_A1,
  ADMIN_B,
  MEMBRE_A,
  ORG_A,
  PROJECT_A_ACTIVE,
  PROJECT_B,
  PROSP_A,
  TASK_OTHER,
  TASK_TODO,
  WORKER_A,
  count,
  expectCode,
  person,
  q,
  setupDatabase,
  type Who,
} from './harness'

const FIN_A = person(6, 'a', 'finance@a.test')
const TIERS = JSON.stringify([
  { up_to_cents: 300000, rate: 12 },
  { up_to_cents: 1000000, rate: 10 },
  { up_to_cents: null, rate: 8 },
])

setupDatabase(`
  insert into auth.users (id, email, email_confirmed_at) values ('${FIN_A.user}', '${FIN_A.email}', now());
  insert into public.members (id, organization_id, user_id, name, email, role)
    values ('${FIN_A.member}', '${ORG_A}', '${FIN_A.user}', 'Finance A', '${FIN_A.email}', 'finance');
`)

interface Entry {
  id: string
  member_id: string
  organization_id: string
  ended_at: string | null
  duration_minutes: number | null
}

const start = async (who: Who, extra = '') =>
  (
    await q<Entry>(
      who,
      `insert into public.time_entries (project_id${extra ? ', task_id' : ''}) values ($1${extra ? ', $2' : ''}) returning *`,
      extra ? [PROJECT_A_ACTIVE, extra] : [PROJECT_A_ACTIVE],
    )
  )[0]!

describe('0012 : tâches', () => {
  it('échéance et priorité (moyenne par défaut)', async () => {
    const [task] = await q<{ due_date: string | null; priority: string }>(
      MEMBRE_A,
      `update public.tasks set due_date = '2026-12-05' where id = $1 returning due_date::text, priority`,
      [TASK_TODO],
    )
    expect(task).toEqual({ due_date: '2026-12-05', priority: 'medium' })
    await q(MEMBRE_A, `update public.tasks set priority = 'high' where id = $1`, [TASK_TODO])
    await expectCode(q(MEMBRE_A, `update public.tasks set priority = 'urgent' where id = $1`, [TASK_TODO]), '23514')
  })
})

describe('0016 : date de fin des tâches', () => {
  it('posée au passage à « Fait », gardée ensuite, effacée à la sortie, jamais écrite par le client', async () => {
    const [done] = await q<{ done_at: string | null }>(
      MEMBRE_A,
      `update public.tasks set status = 'done', done_at = '2000-01-01' where id = $1 returning done_at::text`,
      [TASK_TODO],
    )
    expect(done?.done_at).not.toBeNull()
    expect(done?.done_at?.startsWith('2000')).toBe(false)
    const [kept] = await q<{ done_at: string | null }>(
      MEMBRE_A,
      `update public.tasks set position = position + 1 where id = $1 returning done_at::text`,
      [TASK_TODO],
    )
    expect(kept?.done_at).toBe(done?.done_at)
    const [reopened] = await q<{ done_at: string | null }>(
      MEMBRE_A,
      `update public.tasks set status = 'in_progress' where id = $1 returning done_at::text`,
      [TASK_TODO],
    )
    expect(reopened?.done_at).toBeNull()
  })
})

describe('0012 : time_entries', () => {
  it('un seul minuteur en cours par membre ; durée calculée à l’arrêt', async () => {
    const entry = await start(MEMBRE_A, TASK_OTHER)
    expect(entry).toMatchObject({ member_id: MEMBRE_A.member, organization_id: ORG_A, ended_at: null, duration_minutes: null })
    await expectCode(start(MEMBRE_A), '23505')
    await start(WORKER_A) // un autre membre peut avoir le sien

    const [stopped] = await q<Entry>(
      MEMBRE_A,
      `update public.time_entries set started_at = now() - interval '95 minutes', ended_at = now() where id = $1 returning *`,
      [entry.id],
    )
    expect(stopped?.duration_minutes).toBe(95)
    await start(MEMBRE_A) // nouveau minuteur possible
  })

  it('entrée manuelle : début + durée, la fin est posée par la base', async () => {
    const [manual] = await q<{ ended_at: string; duration_minutes: number }>(
      MEMBRE_A,
      `insert into public.time_entries (project_id, started_at, duration_minutes, note)
       values ($1, '2026-11-20 09:00+01', 90, 'Atelier') returning ended_at::text, duration_minutes`,
      [PROJECT_A_ACTIVE],
    )
    expect(manual?.duration_minutes).toBe(90)
    const [check] = await q<{ ok: boolean }>(
      'postgres',
      `select ended_at = '2026-11-20 10:30+01'::timestamptz as ok from public.time_entries where note = 'Atelier'`,
    )
    expect(check?.ok).toBe(true)
    // Plusieurs entrées manuelles en plus d'un minuteur en cours.
    await start(MEMBRE_A)
    await q(MEMBRE_A, `insert into public.time_entries (project_id, started_at, duration_minutes) values ($1, now() - interval '1 day', 30)`, [
      PROJECT_A_ACTIVE,
    ])
  })

  it('lecture admin / membre / finance ; écriture de ses propres entrées, ou par un admin', async () => {
    const entry = await start(MEMBRE_A)
    for (const who of [ADMIN_A1, WORKER_A, FIN_A]) expect(await count(who, 'public.time_entries')).toBe(1)
    for (const who of [PROSP_A, ADMIN_B]) expect(await count(who, 'public.time_entries')).toBe(0)

    expect(await q(WORKER_A, `update public.time_entries set note = 'x' where id = $1 returning id`, [entry.id])).toEqual([])
    await q(ADMIN_A1, `update public.time_entries set note = 'Corrigé' where id = $1`, [entry.id])
    await expectCode(
      q(WORKER_A, `insert into public.time_entries (project_id, member_id) values ($1, $2)`, [PROJECT_A_ACTIVE, MEMBRE_A.member]),
      '42501',
    )
    await q(ADMIN_A1, `insert into public.time_entries (project_id, member_id) values ($1, $2)`, [PROJECT_A_ACTIVE, WORKER_A.member])
    await expectCode(q(FIN_A, `insert into public.time_entries (project_id) values ($1)`, [PROJECT_A_ACTIVE]), '42501')
    // Autre organisation : pas de membre dans l'organisation du projet (refusé par le trigger, avant la RLS).
    await expectCode(q(ADMIN_B, `insert into public.time_entries (project_id) values ($1)`, [PROJECT_A_ACTIVE]), '23514')
    expect(await count(ADMIN_B, 'public.time_entries')).toBe(0)
    await expectCode(q(MEMBRE_A, `update public.time_entries set member_id = $2 where id = $1`, [entry.id, WORKER_A.member]), '42501')
  })

  it('tâche du même projet, fin après le début', async () => {
    await expectCode(start(MEMBRE_A, 'a0000000-0000-4000-8000-00000000dead'), '23514')
    const [taskB] = await q<{ id: string }>(
      'postgres',
      `insert into public.tasks (project_id, title, skill) values ($1, 'B', 'dev') returning id`,
      [PROJECT_B],
    )
    await expectCode(start(MEMBRE_A, taskB!.id), '23514')
    const entry = await start(MEMBRE_A)
    await expectCode(
      q(MEMBRE_A, `update public.time_entries set ended_at = started_at - interval '1 hour' where id = $1`, [entry.id]),
      '23514',
    )
  })
})

describe('0012 : member_absences', () => {
  it('lues par l’organisation ; écrites par soi-même ou un admin', async () => {
    const [absence] = await q<{ id: string; organization_id: string }>(
      MEMBRE_A,
      `insert into public.member_absences (member_id, start_date, end_date, kind) values ($1, '2026-12-01', '2026-12-05', 'school')
       returning id, organization_id`,
      [MEMBRE_A.member],
    )
    expect(absence?.organization_id).toBe(ORG_A)
    for (const who of [ADMIN_A1, WORKER_A, FIN_A, PROSP_A]) expect(await count(who, 'public.member_absences')).toBe(1)
    expect(await count(ADMIN_B, 'public.member_absences')).toBe(0)

    await expectCode(
      q(WORKER_A, `insert into public.member_absences (member_id, start_date, end_date) values ($1, '2026-12-01', '2026-12-01')`, [
        MEMBRE_A.member,
      ]),
      '42501',
    )
    expect(await q(WORKER_A, `delete from public.member_absences where id = $1 returning id`, [absence!.id])).toEqual([])
    await q(ADMIN_A1, `update public.member_absences set kind = 'leave' where id = $1`, [absence!.id])
    await expectCode(
      q(MEMBRE_A, `insert into public.member_absences (member_id, start_date, end_date) values ($1, '2026-12-05', '2026-12-01')`, [
        MEMBRE_A.member,
      ]),
      '23514',
    )
    await expectCode(
      q(ADMIN_B, `insert into public.member_absences (member_id, start_date, end_date) values ($1, '2026-12-01', '2026-12-01')`, [
        MEMBRE_A.member,
      ]),
      '42501',
    )
  })
})

describe('0012 : compétences ouvertes et affinités', () => {
  it('toute compétence de 0 à 5, clés de 30 caractères au plus', async () => {
    await q(ADMIN_A1, `update public.members set skills = '{"design": 4, "motion": 2.5, "rédaction": 0}' where id = $1`, [
      MEMBRE_A.member,
    ])
    await expectCode(q(ADMIN_A1, `update public.members set skills = '{"motion": 6}' where id = $1`, [MEMBRE_A.member]), '23514')
    await expectCode(q(ADMIN_A1, `update public.members set skills = '{"motion": "3"}' where id = $1`, [MEMBRE_A.member]), '23514')
    await expectCode(q(ADMIN_A1, `update public.members set skills = '{"": 3}' where id = $1`, [MEMBRE_A.member]), '23514')
    await expectCode(
      q(ADMIN_A1, `update public.members set skills = $2::jsonb where id = $1`, [MEMBRE_A.member, JSON.stringify({ ['x'.repeat(31)]: 1 })]),
      '23514',
    )
    await expectCode(q(ADMIN_A1, `update public.members set skills = '[]' where id = $1`, [MEMBRE_A.member]), '23514')
  })

  it('affinités modifiables par un admin seulement, 30 au plus', async () => {
    const [row] = await q<{ affinities: string[] }>(
      ADMIN_A1,
      `update public.members set affinities = '{illustration,e-commerce}' where id = $1 returning affinities`,
      [MEMBRE_A.member],
    )
    expect(row?.affinities).toEqual(['illustration', 'e-commerce'])
    expect(await q(MEMBRE_A, `update public.members set affinities = '{}' where id = $1 returning id`, [MEMBRE_A.member])).toEqual([])
    await expectCode(
      q(ADMIN_A1, `update public.members set affinities = $2 where id = $1`, [MEMBRE_A.member, Array.from({ length: 31 }, (_, i) => `a${i}`)]),
      '23514',
    )
  })
})

describe('0012 : commission_plans', () => {
  const insertPlan = (who: Who, member = PROSP_A.member, tiers = TIERS) =>
    q(who, `insert into public.commission_plans (member_id, tiers, followup_rate) values ($1, $2::jsonb, 5)`, [member, tiers])

  it('écrit par un admin ; lu par admin, finance et l’apporteur concerné', async () => {
    await insertPlan(ADMIN_A1)
    const [plan] = await q<{ organization_id: string; sign_window_months: number; followup_window_months: number; active: boolean }>(
      PROSP_A,
      `select organization_id, sign_window_months, followup_window_months, active from public.commission_plans`,
    )
    expect(plan).toEqual({ organization_id: ORG_A, sign_window_months: 6, followup_window_months: 12, active: true })
    expect(await count(FIN_A, 'public.commission_plans')).toBe(1)
    for (const who of [MEMBRE_A, WORKER_A, ADMIN_B]) expect(await count(who, 'public.commission_plans')).toBe(0)

    await expectCode(insertPlan(FIN_A, WORKER_A.member), '42501')
    await expectCode(insertPlan(PROSP_A, PROSP_A.member), '42501')
    expect(await q(PROSP_A, `update public.commission_plans set followup_rate = 50 returning member_id`)).toEqual([])
    await expectCode(insertPlan(ADMIN_B, MEMBRE_A.member), '42501')
  })

  it('barème contrôlé : tranches croissantes, dernière sans plafond, taux de 0 à 100', async () => {
    await expectCode(insertPlan(ADMIN_A1, PROSP_A.member, '[]'), '23514')
    await expectCode(insertPlan(ADMIN_A1, PROSP_A.member, '[{"up_to_cents": 1000, "rate": 10}]'), '23514')
    await expectCode(
      insertPlan(ADMIN_A1, PROSP_A.member, '[{"up_to_cents": 1000, "rate": 10}, {"up_to_cents": 500, "rate": 5}, {"up_to_cents": null, "rate": 1}]'),
      '23514',
    )
    await expectCode(insertPlan(ADMIN_A1, PROSP_A.member, '[{"up_to_cents": null, "rate": 101}]'), '23514')
    await expectCode(insertPlan(ADMIN_A1, PROSP_A.member, '[{"up_to_cents": null, "rate": 10}, {"up_to_cents": null, "rate": 5}]'), '23514')
    await insertPlan(ADMIN_A1, PROSP_A.member, '[{"rate": 10}]')
  })
})
