/**
 * Tests RLS et intégrité des migrations 0001 à 0003, sur un Postgres en mémoire (PGlite).
 * Le harnais (harness.ts) applique toutes les migrations, 0004 comprise : ces tests vérifient
 * donc aussi que la 0004 ne retire rien à admin et membre. Les tests propres à la 0004 sont
 * dans finance.test.ts.
 *
 * Chaque test tourne dans une transaction annulée à la fin : les données de départ restent intactes.
 * Lancer : npm run test:rls
 */
import { describe, expect, it } from 'vitest'
import {
  ADMIN_A1,
  ADMIN_A2,
  ADMIN_B,
  CLIENT_A_EMAIL,
  CLIENT_A_FULL,
  CLIENT_A_NONE,
  CLIENT_B,
  INVITED_A,
  INVITED_A_USER,
  MEMBRE_A,
  ORG_A,
  ORG_B,
  PROJECT_A_ACTIVE,
  PROJECT_B,
  PROSP_A,
  TASK_DONE,
  TASK_OTHER,
  TASK_REVIEW,
  TASK_TODO,
  WORKER_A,
  count,
  expectCode,
  q,
  setupDatabase,
  type Person,
} from './harness'

setupDatabase()

describe('migration 0003 : schéma et reprise des données', () => {
  it('a les colonnes de src/shared/types.ts', async () => {
    const expected: Record<string, string[]> = {
      organizations: [
        'id', 'name', 'legal_name', 'legal_form', 'siret', 'address_street', 'address_postal_code',
        'address_city', 'address_country', 'vat_mention', 'default_daily_rate', 'default_hourly_rate',
        // 0004
        'default_vat_rate', 'payment_terms_days', 'quote_validity_days', 'bank_iban', 'bank_bic',
        'created_at', 'updated_at',
      ],
      members: [
        'id', 'organization_id', 'user_id', 'name', 'email', 'role', 'skills', 'weekly_capacity_hours',
        'unavailable_weekdays', 'invited_at', 'removed_at', 'created_at', 'updated_at',
      ],
      clients: [
        'id', 'organization_id', 'name', 'siret', 'billing_street', 'billing_postal_code', 'billing_city',
        'billing_country', 'website', 'notes', 'archived_at', 'contact_name', 'contact_email', 'created_at',
        'updated_at',
      ],
      client_contacts: [
        'id', 'organization_id', 'client_id', 'name', 'email', 'phone', 'role', 'is_primary', 'created_at',
        'updated_at',
      ],
      projects: [
        'id', 'organization_id', 'client_id', 'name', 'status', 'start_date', 'due_date', 'tone_of_voice',
        'ai_instructions',
        'created_at', 'updated_at',
      ],
      project_members: ['project_id', 'member_id', 'organization_id', 'created_at'],
    }
    for (const [table, columns] of Object.entries(expected)) {
      const rows = await q<{ column_name: string }>(
        'postgres',
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
        [table],
      )
      expect(rows.map((r) => r.column_name).sort(), table).toEqual([...columns].sort())
    }
  })

  it('reprend le contact existant en contact principal, une seule fois malgré le rejeu', async () => {
    const contacts = await q<{ client_id: string; name: string; email: string | null; is_primary: boolean }>(
      'postgres',
      `select client_id, name, email, is_primary, organization_id from public.client_contacts order by name`,
    )
    expect(contacts).toEqual([
      expect.objectContaining({ client_id: CLIENT_B, name: 'Bob', email: null, is_primary: true }),
      expect.objectContaining({ client_id: CLIENT_A_FULL, name: 'Camille', email: 'camille@ibe.test', is_primary: true }),
      expect.objectContaining({
        client_id: CLIENT_A_EMAIL,
        name: 'contact@client.test',
        email: 'contact@client.test',
        is_primary: true,
      }),
    ])
    // Les anciennes colonnes restent en base.
    const [ibe] = await q<{ contact_name: string }>('postgres', `select contact_name from public.clients where id = $1`, [
      CLIENT_A_FULL,
    ])
    expect(ibe?.contact_name).toBe('  Camille  ')
  })

  it('passe les statuts « active » et inconnus en « in_progress », avec contrainte et défaut', async () => {
    const rows = await q<{ status: string }>('postgres', `select status from public.projects order by id`)
    expect(rows.map((r) => r.status)).toEqual(['in_progress', 'in_progress', 'in_progress'])

    await expectCode(
      q('postgres', `insert into public.projects (organization_id, name, status) values ($1, 'X', 'active')`, [ORG_A]),
      '23514',
    )
    const [created] = await q<{ status: string }>(
      'postgres',
      `insert into public.projects (organization_id, name) values ($1, 'Défaut') returning status`,
      [ORG_A],
    )
    expect(created?.status).toBe('in_progress')
  })

  it('refuse des données invalides (SIRET, dates, jours, compétences, taux)', async () => {
    await expectCode(q('postgres', `update public.clients set siret = '123' where id = $1`, [CLIENT_A_FULL]), '23514')
    await expectCode(q('postgres', `update public.organizations set siret = '1234567890123a' where id = $1`, [ORG_A]), '23514')
    await expectCode(q('postgres', `update public.organizations set default_daily_rate = -1 where id = $1`, [ORG_A]), '23514')
    await expectCode(
      q('postgres', `update public.projects set start_date = '2026-12-01', due_date = '2026-11-01' where id = $1`, [
        PROJECT_A_ACTIVE,
      ]),
      '23514',
    )
    await expectCode(
      q('postgres', `update public.members set unavailable_weekdays = '{1,8}' where id = $1`, [MEMBRE_A.member]),
      '23514',
    )
    await expectCode(
      q('postgres', `update public.members set skills = '{"dev": 6}' where id = $1`, [MEMBRE_A.member]),
      '23514',
    )
    await expectCode(
      q('postgres', `update public.members set skills = '{"design": "5"}' where id = $1`, [MEMBRE_A.member]),
      '23514',
    )
    // Valeurs valides.
    await q('postgres', `update public.members set skills = '{"dev": 0, "design": 4}', unavailable_weekdays = '{3,5}' where id = $1`, [
      MEMBRE_A.member,
    ])
    await q('postgres', `update public.clients set siret = '73282932000074' where id = $1`, [CLIENT_A_FULL])
  })
})

describe('équipe et paramètres : écriture réservée aux admins', () => {
  it('un membre non admin ne modifie ni un autre membre, ni l’organisation', async () => {
    expect(await q(MEMBRE_A, `update public.members set name = 'Piraté' where id = $1 returning id`, [WORKER_A.member])).toEqual([])
    expect(await q(MEMBRE_A, `update public.members set role = 'admin' where id = $1 returning id`, [MEMBRE_A.member])).toEqual([])
    expect(await q(MEMBRE_A, `update public.organizations set legal_name = 'Piraté' where id = $1 returning id`, [ORG_A])).toEqual([])
    expect(await q(PROSP_A, `update public.organizations set name = 'Piraté' where id = $1 returning id`, [ORG_A])).toEqual([])
    const [org] = await q<{ name: string; legal_name: string | null }>('postgres', `select name, legal_name from public.organizations where id = $1`, [ORG_A])
    expect(org).toEqual({ name: 'Sordulo', legal_name: null })
  })

  it('un membre non admin ne peut appeler ni remove_member ni restore_member', async () => {
    await expectCode(q(MEMBRE_A, `select * from public.remove_member($1)`, [WORKER_A.member]), '42501')
    await expectCode(q(MEMBRE_A, `select * from public.restore_member($1)`, [WORKER_A.member]), '42501')
    await expectCode(q('anon', `select * from public.remove_member($1)`, [WORKER_A.member]), '42501')
  })

  it('un admin modifie l’organisation et les membres', async () => {
    const [org] = await q<{ legal_name: string; siret: string; default_daily_rate: string }>(
      ADMIN_A1,
      `update public.organizations
       set legal_name = 'Sordulo SAS', siret = '73282932000074', default_daily_rate = 450
       where id = $1 returning legal_name, siret, default_daily_rate`,
      [ORG_A],
    )
    expect(org).toMatchObject({ legal_name: 'Sordulo SAS', siret: '73282932000074' })
    expect(Number(org?.default_daily_rate)).toBe(450)

    const [member] = await q<{ role: string; unavailable_weekdays: number[]; skills: unknown }>(
      ADMIN_A1,
      `update public.members
       set role = 'admin', skills = '{"dev": 4, "design": 1}', weekly_capacity_hours = 28, unavailable_weekdays = '{3}'
       where id = $1 returning role, skills, unavailable_weekdays`,
      [MEMBRE_A.member],
    )
    expect(member).toEqual({ role: 'admin', skills: { dev: 4, design: 1 }, unavailable_weekdays: [3] })
  })

  it('un admin ne modifie pas directement removed_at, email, user_id ni organization_id', async () => {
    await expectCode(q(ADMIN_A1, `update public.members set removed_at = now() where id = $1`, [WORKER_A.member]), '42501')
    await expectCode(q(ADMIN_A1, `update public.members set email = 'x@a.test' where id = $1`, [WORKER_A.member]), '42501')
    await expectCode(q(ADMIN_A1, `update public.members set user_id = null where id = $1`, [WORKER_A.member]), '42501')
    await expectCode(q(ADMIN_A1, `update public.members set organization_id = $2 where id = $1`, [WORKER_A.member, ORG_B]), '42501')
    await expectCode(
      q(ADMIN_A1, `insert into public.members (organization_id, name, email) values ($1, 'Nouveau', 'n@a.test')`, [ORG_A]),
      '42501',
    )
  })

  it('un admin d’une autre organisation ne touche pas à l’équipe', async () => {
    expect(await q(ADMIN_B, `update public.members set name = 'Piraté' where id = $1 returning id`, [MEMBRE_A.member])).toEqual([])
    expect(await q(ADMIN_B, `update public.organizations set name = 'Piraté' where id = $1 returning id`, [ORG_A])).toEqual([])
    await expectCode(q(ADMIN_B, `select * from public.remove_member($1)`, [MEMBRE_A.member]), '42501')
    await expectCode(q(ADMIN_B, `select * from public.restore_member($1)`, [MEMBRE_A.member]), '42501')
  })

  it('le dernier admin actif ne peut être ni rétrogradé ni retiré, même en service_role', async () => {
    await expectCode(
      q(ADMIN_B, `update public.members set role = 'membre' where id = $1`, [ADMIN_B.member]),
      'P0001',
      /au moins un admin/,
    )
    await expectCode(q('service_role', `update public.members set role = 'membre' where id = $1`, [ADMIN_B.member]), 'P0001')
    await expectCode(q('service_role', `update public.members set removed_at = now() where id = $1`, [ADMIN_B.member]), 'P0001')

    // Organisation A : deux admins. A1 rétrograde A2, puis ne peut plus se rétrograder.
    await q(ADMIN_A1, `update public.members set role = 'membre' where id = $1`, [ADMIN_A2.member])
    await expectCode(q(ADMIN_A1, `update public.members set role = 'membre' where id = $1`, [ADMIN_A1.member]), 'P0001')
  })

  it('un admin ne peut pas se retirer lui-même, mais peut se rétrograder s’il reste un admin', async () => {
    await expectCode(q(ADMIN_A1, `select * from public.remove_member($1)`, [ADMIN_A1.member]), 'P0001', /toi-même/)
    const [me] = await q<{ role: string }>(ADMIN_A1, `update public.members set role = 'membre' where id = $1 returning role`, [
      ADMIN_A1.member,
    ])
    expect(me?.role).toBe('membre')
  })

  it('remove_member retire le membre, désattribue ses tâches non faites et révoque ses sessions', async () => {
    const [removed] = await q<{ id: string; removed_at: string | null }>(ADMIN_A1, `select * from public.remove_member($1)`, [
      WORKER_A.member,
    ])
    expect(removed?.id).toBe(WORKER_A.member)
    expect(removed?.removed_at).not.toBeNull()

    const tasks = await q<{ id: string; assignee_member_id: string | null }>(
      'postgres',
      `select id, assignee_member_id from public.tasks order by id`,
    )
    expect(tasks).toEqual([
      { id: TASK_DONE, assignee_member_id: WORKER_A.member },
      { id: TASK_TODO, assignee_member_id: null },
      { id: TASK_REVIEW, assignee_member_id: null },
      { id: TASK_OTHER, assignee_member_id: MEMBRE_A.member },
    ])

    const sessions = await q<{ user_id: string }>('postgres', `select user_id from auth.sessions`)
    expect(sessions).toEqual([{ user_id: MEMBRE_A.user }])

    // Rejouer le retrait ne change rien ; la ligne reste en base.
    const [again] = await q<{ removed_at: string }>(ADMIN_A2, `select * from public.remove_member($1)`, [WORKER_A.member])
    expect(again?.removed_at).toEqual(removed?.removed_at)

    const [restored] = await q<{ removed_at: string | null }>(ADMIN_A2, `select * from public.restore_member($1)`, [
      WORKER_A.member,
    ])
    expect(restored?.removed_at).toBeNull()
    expect(await count(WORKER_A, 'public.projects')).toBe(2)
  })

  it('un membre retiré ne voit plus rien et claim_membership ne le relie pas', async () => {
    expect(await count(WORKER_A, 'public.projects')).toBe(2)
    await q(ADMIN_A1, `select public.remove_member($1)`, [WORKER_A.member])

    for (const table of [
      'public.organizations',
      'public.members',
      'public.clients',
      'public.client_contacts',
      'public.projects',
      'public.project_members',
      'public.tasks',
      'public.tickets',
      'public.inputs',
    ]) {
      expect(await count(WORKER_A, table), table).toBe(0)
    }
    expect(await q(WORKER_A, `select * from public.claim_membership()`)).toEqual([])
    await expectCode(
      q(WORKER_A, `insert into public.clients (organization_id, name) values ($1, 'Après retrait')`, [ORG_A]),
      '42501',
    )

    // Invité jamais connecté puis retiré : ni le trigger auth.users ni claim_membership ne le relient.
    await q(ADMIN_A1, `select public.remove_member($1)`, [INVITED_A.member])
    await q('postgres', `insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [
      INVITED_A_USER,
      INVITED_A.email,
    ])
    const invited: Person = { user: INVITED_A_USER, member: INVITED_A.member, email: INVITED_A.email }
    expect(await q(invited, `select * from public.claim_membership()`)).toEqual([])
    const [row] = await q<{ user_id: string | null }>('postgres', `select user_id from public.members where id = $1`, [
      INVITED_A.member,
    ])
    expect(row?.user_id).toBeNull()
    expect(await count(invited, 'public.organizations')).toBe(0)
  })

  it('un invité actif est relié à sa première connexion', async () => {
    await q('postgres', `insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [
      INVITED_A_USER,
      'INVITE@a.test',
    ])
    const invited: Person = { user: INVITED_A_USER, member: INVITED_A.member, email: INVITED_A.email }
    const rows = await q<{ id: string }>(invited, `select id from public.claim_membership()`)
    expect(rows).toEqual([{ id: INVITED_A.member }])
  })
})

describe('clients, contacts, projets et membres de projet', () => {
  it('prospection ne lit (0004) ni ne crée client, projet, contact ou membre de projet', async () => {
    // Depuis la 0004, prospection ne voit que l'organisation, l'équipe et les prospects.
    expect(await count(PROSP_A, 'public.clients')).toBe(0)
    expect(await count(PROSP_A, 'public.projects')).toBe(0)
    await expectCode(q(PROSP_A, `insert into public.clients (organization_id, name) values ($1, 'X')`, [ORG_A]), '42501')
    await expectCode(q(PROSP_A, `insert into public.projects (organization_id, name) values ($1, 'X')`, [ORG_A]), '42501')
    await expectCode(
      q(PROSP_A, `insert into public.client_contacts (client_id, name) values ($1, 'X')`, [CLIENT_A_NONE]),
      '42501',
    )
    await expectCode(
      q(PROSP_A, `insert into public.project_members (project_id, member_id) values ($1, $2)`, [
        PROJECT_A_ACTIVE,
        PROSP_A.member,
      ]),
      '42501',
    )
    expect(await q(PROSP_A, `update public.clients set name = 'X' where id = $1 returning id`, [CLIENT_A_FULL])).toEqual([])
    expect(await q(PROSP_A, `update public.projects set name = 'X' where id = $1 returning id`, [PROJECT_A_ACTIVE])).toEqual([])
  })

  it('un membre crée un client, ses contacts, un projet et ses membres', async () => {
    const [client] = await q<{ id: string }>(
      MEMBRE_A,
      `insert into public.clients (organization_id, name, siret, billing_city) values ($1, 'Nouveau', '73282932000074', 'Lyon')
       returning id`,
      [ORG_A],
    )
    const contacts = await q<{ organization_id: string; is_primary: boolean }>(
      MEMBRE_A,
      `insert into public.client_contacts (client_id, name, email, is_primary)
       values ($1, 'Alice', 'alice@n.test', true), ($1, 'Bruno', null, false)
       returning organization_id, is_primary`,
      [client?.id],
    )
    expect(contacts.map((c) => c.organization_id)).toEqual([ORG_A, ORG_A])

    const [project] = await q<{ id: string; status: string; organization_id: string }>(
      MEMBRE_A,
      `insert into public.projects (organization_id, client_id, name, start_date, due_date)
       values ($1, $2, 'Site', '2026-12-01', '2027-02-01') returning id, status, organization_id`,
      [ORG_A, client?.id],
    )
    expect(project?.status).toBe('in_progress')

    const [link] = await q<{ organization_id: string }>(
      MEMBRE_A,
      `insert into public.project_members (project_id, member_id) values ($1, $2) returning organization_id`,
      [project?.id, WORKER_A.member],
    )
    expect(link?.organization_id).toBe(ORG_A)
    expect(await q(MEMBRE_A, `delete from public.project_members where project_id = $1 returning member_id`, [project?.id])).toHaveLength(1)

    const [archived] = await q<{ archived_at: string | null }>(
      MEMBRE_A,
      `update public.clients set archived_at = now() where id = $1 returning archived_at`,
      [client?.id],
    )
    expect(archived?.archived_at).not.toBeNull()
  })

  it('un seul contact principal par client', async () => {
    await expectCode(
      q(ADMIN_A1, `insert into public.client_contacts (client_id, name, is_primary) values ($1, 'Second', true)`, [
        CLIENT_A_FULL,
      ]),
      '23505',
    )
    // Changer de contact principal : l'ancien d'abord, puis le nouveau.
    const [second] = await q<{ id: string }>(
      ADMIN_A1,
      `insert into public.client_contacts (client_id, name) values ($1, 'Second') returning id`,
      [CLIENT_A_FULL],
    )
    await q(ADMIN_A1, `update public.client_contacts set is_primary = false where client_id = $1 and is_primary`, [CLIENT_A_FULL])
    await q(ADMIN_A1, `update public.client_contacts set is_primary = true where id = $1`, [second?.id])
    const primaries = await q<{ name: string }>(
      ADMIN_A1,
      `select name from public.client_contacts where client_id = $1 and is_primary`,
      [CLIENT_A_FULL],
    )
    expect(primaries).toEqual([{ name: 'Second' }])
  })

  it('project_members refuse un membre d’une autre organisation', async () => {
    await expectCode(
      q(ADMIN_A1, `insert into public.project_members (project_id, member_id) values ($1, $2)`, [
        PROJECT_A_ACTIVE,
        ADMIN_B.member,
      ]),
      '23514',
    )
    await expectCode(
      q('service_role', `insert into public.project_members (project_id, member_id) values ($1, $2)`, [
        PROJECT_A_ACTIVE,
        ADMIN_B.member,
      ]),
      '23514',
    )
  })

  it('isole les organisations sur les nouvelles tables', async () => {
    await q('postgres', `insert into public.project_members (project_id, member_id) values ($1, $2), ($3, $4)`, [
      PROJECT_A_ACTIVE,
      MEMBRE_A.member,
      PROJECT_B,
      ADMIN_B.member,
    ])
    const contactsB = await q<{ client_id: string }>(ADMIN_B, `select client_id from public.client_contacts`)
    expect(contactsB).toEqual([{ client_id: CLIENT_B }])
    const linksB = await q<{ project_id: string }>(ADMIN_B, `select project_id from public.project_members`)
    expect(linksB).toEqual([{ project_id: PROJECT_B }])
    expect(await count(MEMBRE_A, 'public.client_contacts')).toBe(2)
    expect(await count(MEMBRE_A, 'public.project_members')).toBe(1)

    // Écrire chez l'autre : l'organisation vient du client / projet, la RLS refuse.
    await expectCode(
      q(ADMIN_B, `insert into public.client_contacts (client_id, name) values ($1, 'Intrus')`, [CLIENT_A_NONE]),
      '42501',
    )
    await expectCode(
      q(ADMIN_B, `insert into public.project_members (project_id, member_id) values ($1, $2)`, [
        PROJECT_A_ACTIVE,
        WORKER_A.member,
      ]),
      '42501',
    )
    expect(await q(ADMIN_B, `update public.client_contacts set name = 'Intrus' where client_id = $1 returning id`, [CLIENT_A_FULL])).toEqual([])
    expect(await q(ADMIN_B, `delete from public.client_contacts where client_id = $1 returning id`, [CLIENT_A_FULL])).toEqual([])
    expect(await q(ADMIN_B, `delete from public.project_members where project_id = $1 returning member_id`, [PROJECT_A_ACTIVE])).toEqual([])

    // Déplacer un contact vers un client d'une autre organisation : refusé.
    await expectCode(
      q(ADMIN_A1, `update public.client_contacts set client_id = $1 where client_id = $2`, [CLIENT_B, CLIENT_A_FULL]),
      '42501',
    )
  })

  it('anon n’a accès à rien', async () => {
    for (const table of ['public.organizations', 'public.members', 'public.clients', 'public.client_contacts', 'public.projects', 'public.project_members']) {
      await expectCode(q('anon', `select * from ${table}`), '42501')
    }
  })
})
