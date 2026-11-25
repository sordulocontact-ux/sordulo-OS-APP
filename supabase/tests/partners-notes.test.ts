/**
 * Tests de la migration 0020 : réseau de partenaires (partners, partner_projects) et notes rattachées.
 * Isolation d'organisation, droits par rôle (apporteur exclu des partenaires), note perso invisible aux
 * autres, auteur posé par la base, contrôles de même organisation.
 * Lancer : npm run test:rls
 */
import { describe, expect, it } from 'vitest'
import {
  ADMIN_A1,
  ADMIN_A2,
  ADMIN_B,
  CLIENT_A_FULL,
  CLIENT_B,
  MEMBRE_A,
  ORG_A,
  ORG_B,
  PROJECT_A_ACTIVE,
  PROJECT_B,
  PROSP_A,
  WORKER_A,
  count,
  expectCode,
  person,
  q,
  setupDatabase,
  type Who,
} from './harness'

const FIN_A = person(6, 'a', 'finance@a.test')
const PARTNER_A = 'a0000000-0000-4000-8000-000000000a01'
const PARTNER_B = 'b0000000-0000-4000-8000-000000000a01'

setupDatabase(`
  insert into auth.users (id, email, email_confirmed_at) values ('${FIN_A.user}', '${FIN_A.email}', now());
  insert into public.members (id, organization_id, user_id, name, email, role)
    values ('${FIN_A.member}', '${ORG_A}', '${FIN_A.user}', 'Finance A', '${FIN_A.email}', 'finance');
  insert into public.partners (id, organization_id, name, category, day_rate_cents) values
    ('${PARTNER_A}', '${ORG_A}', 'Léa Photo', 'photographer', 45000),
    ('${PARTNER_B}', '${ORG_B}', 'Imprimerie B', 'printer', null);
`)

async function newNote(who: Who, values: Record<string, unknown> = {}) {
  const row = { organization_id: ORG_A, title: 'Note', body: 'Texte', visibility: 'personal', ...values }
  const keys = Object.keys(row)
  const [note] = await q<{ id: string; author_id: string; updated_at: string }>(
    who,
    `insert into public.notes (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id, author_id, updated_at`,
    Object.values(row),
  )
  return note!
}

const visibleNotes = async (who: Who) => (await q<{ id: string }>(who, 'select id from public.notes')).map((r) => r.id)

describe('partners', () => {
  it('isole les organisations', async () => {
    expect((await q<{ id: string }>(ADMIN_A1, 'select id from public.partners')).map((r) => r.id)).toEqual([PARTNER_A])
    expect((await q<{ id: string }>(ADMIN_B, 'select id from public.partners')).map((r) => r.id)).toEqual([PARTNER_B])
    await expectCode(q(ADMIN_A1, `insert into public.partners (organization_id, name) values ($1, 'X')`, [ORG_B]), '42501')
    expect(await q(ADMIN_A1, `update public.partners set name = 'Piraté' where id = $1 returning id`, [PARTNER_B])).toEqual([])
  })

  it('lecture admin, membre, finance ; apporteur exclu ; anon rien', async () => {
    for (const who of [ADMIN_A1, MEMBRE_A, FIN_A]) {
      const [row] = await q<{ day_rate_cents: number }>(who, 'select day_rate_cents from public.partners where id = $1', [PARTNER_A])
      expect(row?.day_rate_cents).toBe(45000)
    }
    expect(await count(PROSP_A, 'public.partners')).toBe(0)
    await expectCode(q('anon', 'select id from public.partners'), '42501')
  })

  it('écriture admin et membre ; finance et apporteur refusés', async () => {
    const [created] = await q<{ id: string; created_by: string }>(
      MEMBRE_A,
      `insert into public.partners (organization_id, name, category, skills) values ($1, 'Max Dev', 'developer', $2) returning id, created_by`,
      [ORG_A, ['React', ' react ', '', 'Rust']],
    )
    expect(created?.created_by).toBe(MEMBRE_A.member)
    const [skills] = await q<{ skills: string[] }>('postgres', 'select skills from public.partners where id = $1', [created!.id])
    expect(skills?.skills).toEqual(['React', 'Rust'])

    await expectCode(q(FIN_A, `insert into public.partners (organization_id, name) values ($1, 'X')`, [ORG_A]), '42501')
    await expectCode(q(PROSP_A, `insert into public.partners (organization_id, name) values ($1, 'X')`, [ORG_A]), '42501')
    expect(await q(FIN_A, `update public.partners set rating = 5 where id = $1 returning id`, [PARTNER_A])).toEqual([])
    expect(await q(FIN_A, `delete from public.partners where id = $1 returning id`, [PARTNER_A])).toEqual([])

    await q(ADMIN_A1, `update public.partners set rating = 4, archived_at = now() where id = $1`, [PARTNER_A])
    const [row] = await q<{ rating: number }>('postgres', 'select rating from public.partners where id = $1', [PARTNER_A])
    expect(row?.rating).toBe(4)
  })

  it('auteur posé par la base, colonnes protégées, contrôles de valeurs', async () => {
    await expectCode(
      q(ADMIN_A1, `insert into public.partners (organization_id, name, created_by) values ($1, 'X', $2)`, [ORG_A, ADMIN_A2.member]),
      '42501',
    )
    await expectCode(q(ADMIN_A1, `update public.partners set organization_id = $1 where id = $2`, [ORG_B, PARTNER_A]), '42501')
    await expectCode(q(ADMIN_A1, `update public.partners set website = 'javascript:alert(1)' where id = $1`, [PARTNER_A]), '23514')
    await expectCode(q(ADMIN_A1, `update public.partners set rating = 6 where id = $1`, [PARTNER_A]), '23514')
    await expectCode(q(ADMIN_A1, `update public.partners set skills = $1 where id = $2`, [['x'.repeat(41)], PARTNER_A]), '23514')
    await q(ADMIN_A1, `update public.partners set website = 'https://lea.photo', email = 'lea@photo.test' where id = $1`, [PARTNER_A])
  })
})

describe('partner_projects', () => {
  it('organisation copiée du partenaire, projet de la même organisation', async () => {
    const [link] = await q<{ organization_id: string }>(
      MEMBRE_A,
      `insert into public.partner_projects (partner_id, project_id, role, amount_cents) values ($1, $2, 'Shooting', 120000) returning organization_id`,
      [PARTNER_A, PROJECT_A_ACTIVE],
    )
    expect(link?.organization_id).toBe(ORG_A)
    await expectCode(
      q(MEMBRE_A, `insert into public.partner_projects (partner_id, project_id) values ($1, $2)`, [PARTNER_A, PROJECT_A_ACTIVE]),
      '23505',
    )
    await expectCode(q('postgres', `insert into public.partner_projects (partner_id, project_id) values ($1, $2)`, [PARTNER_A, PROJECT_B]), '23514')
    // Le partenaire de B n'est pas visible : la RLS refuse la ligne copiée dans l'organisation B.
    await expectCode(q(ADMIN_A1, `insert into public.partner_projects (partner_id, project_id) values ($1, $2)`, [PARTNER_B, PROJECT_B]), '42501')
  })

  it('lecture finance, écriture refusée à finance et à l’apporteur', async () => {
    await q('postgres', `insert into public.partner_projects (partner_id, project_id) values ($1, $2)`, [PARTNER_A, PROJECT_A_ACTIVE])
    expect(await count(FIN_A, 'public.partner_projects')).toBe(1)
    expect(await count(PROSP_A, 'public.partner_projects')).toBe(0)
    expect(await count(ADMIN_B, 'public.partner_projects')).toBe(0)
    expect(await q(FIN_A, `update public.partner_projects set role = 'X' returning id`)).toEqual([])
    await expectCode(
      q(FIN_A, `insert into public.partner_projects (partner_id, project_id) values ($1, $2)`, [PARTNER_A, PROJECT_A_ACTIVE]),
      '42501',
    )
    await expectCode(q(MEMBRE_A, `update public.partner_projects set project_id = $1`, [PROJECT_A_ACTIVE]), '42501')
    expect(await q(MEMBRE_A, `delete from public.partner_projects returning id`)).toHaveLength(1)
  })

  it('suppression du partenaire : liaisons supprimées', async () => {
    await q('postgres', `insert into public.partner_projects (partner_id, project_id) values ($1, $2)`, [PARTNER_A, PROJECT_A_ACTIVE])
    await q(ADMIN_A1, 'delete from public.partners where id = $1', [PARTNER_A])
    expect(await count('postgres', 'public.partner_projects')).toBe(0)
  })
})

describe('notes', () => {
  it('auteur posé par la base ; note perso invisible aux autres, admins compris', async () => {
    const note = await newNote(MEMBRE_A)
    expect(note.author_id).toBe(MEMBRE_A.member)
    expect(await visibleNotes(MEMBRE_A)).toEqual([note.id])
    for (const who of [ADMIN_A1, WORKER_A, FIN_A, PROSP_A, ADMIN_B]) expect(await visibleNotes(who)).toEqual([])
    expect(await q(ADMIN_A1, `update public.notes set body = 'x' where id = $1 returning id`, [note.id])).toEqual([])
    expect(await q(ADMIN_A1, `delete from public.notes where id = $1 returning id`, [note.id])).toEqual([])
    await expectCode(q(MEMBRE_A, `insert into public.notes (organization_id, author_id) values ($1, $2)`, [ORG_A, ADMIN_A1.member]), '42501')
  })

  it('note d’équipe : lue par admin, membre, finance ; pas par l’apporteur ni une autre organisation', async () => {
    const note = await newNote(WORKER_A, { visibility: 'team', project_id: PROJECT_A_ACTIVE, client_id: CLIENT_A_FULL })
    for (const who of [ADMIN_A1, MEMBRE_A, FIN_A, WORKER_A]) expect(await visibleNotes(who)).toEqual([note.id])
    expect(await visibleNotes(PROSP_A)).toEqual([])
    expect(await visibleNotes(ADMIN_B)).toEqual([])
  })

  it('note d’équipe : modifiée par l’auteur et les admins seulement', async () => {
    const note = await newNote(WORKER_A, { visibility: 'team' })
    expect(await q(MEMBRE_A, `update public.notes set body = 'x' where id = $1 returning id`, [note.id])).toEqual([])
    expect(await q(FIN_A, `delete from public.notes where id = $1 returning id`, [note.id])).toEqual([])
    expect(await q(ADMIN_A2, `update public.notes set body = 'par admin' where id = $1 returning id`, [note.id])).toHaveLength(1)
    // Un admin ne peut pas rendre perso la note d'un autre (elle disparaîtrait pour l'équipe).
    await expectCode(q(ADMIN_A2, `update public.notes set visibility = 'personal' where id = $1`, [note.id]), '42501')
    expect(await q(WORKER_A, `update public.notes set visibility = 'personal' where id = $1 returning id`, [note.id])).toHaveLength(1)
    expect(await visibleNotes(ADMIN_A2)).toEqual([])
  })

  it('apporteur : notes perso seulement, sans projet ni client', async () => {
    const note = await newNote(PROSP_A)
    expect(await visibleNotes(PROSP_A)).toEqual([note.id])
    await expectCode(newNote(PROSP_A, { visibility: 'team' }), '42501')
    await expectCode(newNote(PROSP_A, { project_id: PROJECT_A_ACTIVE }), '42501')
    await expectCode(q(PROSP_A, `update public.notes set client_id = $1 where id = $2`, [CLIENT_A_FULL, note.id]), '42501')
    await expectCode(q(PROSP_A, `update public.notes set visibility = 'team' where id = $1`, [note.id]), '42501')
  })

  it('isolation : autre organisation, projet ou client d’une autre organisation', async () => {
    await expectCode(newNote(ADMIN_A1, { organization_id: ORG_B }), '42501')
    await expectCode(newNote(ADMIN_A1, { project_id: PROJECT_B }), '23514')
    await expectCode(newNote(ADMIN_A1, { client_id: CLIENT_B }), '23514')
    const note = await newNote(ADMIN_A1)
    await expectCode(q(ADMIN_A1, `update public.notes set organization_id = $1 where id = $2`, [ORG_B, note.id]), '42501')
    await expectCode(q(ADMIN_A1, `update public.notes set author_id = $1 where id = $2`, [MEMBRE_A.member, note.id]), '42501')
  })

  it('épingler ne change pas la date de modification, le contenu oui', async () => {
    const note = await newNote(ADMIN_A1)
    // Recule la date sans passer par la garde (tout le test tourne dans une transaction : now() est fixe).
    await q('postgres', 'set local session_replication_role = replica')
    await q('postgres', `update public.notes set updated_at = now() - interval '1 day' where id = $1`, [note.id])
    await q('postgres', 'set local session_replication_role = origin')
    const [before] = await q<{ updated_at: string }>('postgres', 'select updated_at from public.notes where id = $1', [note.id])
    await q(ADMIN_A1, 'update public.notes set pinned = true where id = $1', [note.id])
    const [pinned] = await q<{ updated_at: string; pinned: boolean }>('postgres', 'select updated_at, pinned from public.notes where id = $1', [note.id])
    expect(pinned?.pinned).toBe(true)
    expect(String(pinned?.updated_at)).toBe(String(before?.updated_at))
    await q(ADMIN_A1, `update public.notes set body = 'nouveau' where id = $1`, [note.id])
    const [edited] = await q<{ newer: boolean }>(
      'postgres',
      `select updated_at > $2::timestamptz as newer from public.notes where id = $1`,
      [note.id, before?.updated_at],
    )
    expect(edited?.newer).toBe(true)
  })

  it('suppression du projet : la note reste, sans rattachement', async () => {
    const note = await newNote(ADMIN_A1, { visibility: 'team', project_id: PROJECT_A_ACTIVE })
    await q('postgres', 'delete from public.projects where id = $1', [PROJECT_A_ACTIVE])
    const [row] = await q<{ project_id: string | null }>('postgres', 'select project_id from public.notes where id = $1', [note.id])
    expect(row?.project_id).toBeNull()
  })
})
