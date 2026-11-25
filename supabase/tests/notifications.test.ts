/**
 * Tests de la migration 0013 : notifications (RPC create_notification, dédoublonnage, lecture par le seul
 * destinataire, déclencheurs des passages de main), propositions de l'IA (appliquer, refuser, annuler,
 * « Toujours »), relances.
 * Lancer : npm run test:rls
 */
import { describe, expect, it } from 'vitest'
import {
  ADMIN_A1,
  ADMIN_A2,
  ADMIN_B,
  CLIENT_A_FULL,
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

setupDatabase(`
  insert into auth.users (id, email, email_confirmed_at) values ('${FIN_A.user}', '${FIN_A.email}', now());
  insert into public.members (id, organization_id, user_id, name, email, role)
    values ('${FIN_A.member}', '${ORG_A}', '${FIN_A.user}', 'Finance A', '${FIN_A.email}', 'finance');
`)

interface Notif {
  member_id: string
  kind: string
  title: string
  body: string | null
  link: string | null
  payload: Record<string, unknown>
}

const notifs = (kind?: string) =>
  q<Notif>(
    'postgres',
    `select member_id, kind, title, body, link, payload from public.notifications ${kind ? 'where kind = $1' : ''} order by member_id, created_at`,
    kind ? [kind] : [],
  )

const notify = (who: Who, member: string, extra: Partial<{ link: string; dedupe: string; kind: string }> = {}) =>
  q<{ id: string | null }>(
    who,
    `select public.create_notification($1, $2, 'Récap du lundi', 'Trois tâches cette semaine', $3, '{"n": 3}', $4) as id`,
    [member, extra.kind ?? 'recap.weekly', extra.link ?? '/', extra.dedupe ?? null],
  ).then((rows) => rows[0]!.id)

describe('0013 : schéma', () => {
  it('a les colonnes de src/shared/types.ts', async () => {
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
    expect(await columns('notifications')).toEqual(
      ['id', 'organization_id', 'member_id', 'kind', 'title', 'body', 'link', 'payload', 'dedupe_key', 'read_at', 'created_at'].sort(),
    )
    expect(await columns('ai_proposals')).toEqual(
      [
        'id', 'organization_id', 'project_id', 'kind', 'title', 'explanation', 'payload', 'status', 'rule_id', 'decided_by',
        'decided_at', 'created_at',
      ].sort(),
    )
    expect(await columns('ai_autonomy_rules')).toEqual(
      ['id', 'organization_id', 'kind', 'scope', 'created_by', 'created_at', 'revoked_at'].sort(),
    )
    expect(await columns('followups')).toEqual(
      ['id', 'organization_id', 'target_type', 'target_id', 'draft', 'status', 'sent_at', 'created_by', 'created_at', 'updated_at'].sort(),
    )
  })
})

describe('0013 : notifications', () => {
  it('create_notification : soi-même, un admin pour son organisation, le serveur ; dédoublonnage silencieux', async () => {
    const id = await notify(ADMIN_A1, WORKER_A.member, { dedupe: 'recap:2026-W48' })
    expect(id).not.toBeNull()
    expect(await notify(ADMIN_A2, WORKER_A.member, { dedupe: 'recap:2026-W48' })).toBeNull()
    expect(await notify(MEMBRE_A, MEMBRE_A.member, { dedupe: 'recap:2026-W48' })).not.toBeNull() // autre destinataire
    expect(await notify('service_role', ADMIN_B.member)).not.toBeNull()
    expect(await count('postgres', 'public.notifications')).toBe(3)

    await expectCode(notify(ADMIN_B, MEMBRE_A.member), '42501')
    await expectCode(notify('anon', MEMBRE_A.member), '42501')
    await expectCode(notify(MEMBRE_A, MEMBRE_A.member, { link: 'https://ailleurs.test' }), '22023')
    await expectCode(notify(MEMBRE_A, MEMBRE_A.member, { kind: 'Pas Bon' }), '22023')
  })

  it('0019 : un non-admin ne notifie que lui-même (pas de titre libre envoyé à un autre : hameçonnage)', async () => {
    await expectCode(notify(MEMBRE_A, WORKER_A.member), '42501', /toi-même/)
    await expectCode(notify(MEMBRE_A, ADMIN_A1.member), '42501')
    await expectCode(notify(PROSP_A, ADMIN_A1.member), '42501') // l'apporteur vers un admin
    await expectCode(notify(FIN_A, WORKER_A.member), '42501')
    expect(await notify(PROSP_A, PROSP_A.member)).not.toBeNull()
    expect(await notify(FIN_A, FIN_A.member)).not.toBeNull()
    expect(await notify(ADMIN_A1, PROSP_A.member)).not.toBeNull()
    expect(await count('postgres', 'public.notifications')).toBe(3)
  })

  it('lues et marquées lues par le seul destinataire ; jamais insérées directement', async () => {
    const id = await notify(ADMIN_A2, WORKER_A.member)
    expect(await count(WORKER_A, 'public.notifications')).toBe(1)
    for (const who of [MEMBRE_A, ADMIN_A1, ADMIN_B]) expect(await count(who, 'public.notifications')).toBe(0)

    expect(await q(ADMIN_A1, `update public.notifications set read_at = now() where id = $1 returning id`, [id])).toEqual([])
    await q(WORKER_A, `update public.notifications set read_at = now() where id = $1`, [id])
    await expectCode(q(WORKER_A, `update public.notifications set title = 'x' where id = $1`, [id]), '42501')
    await expectCode(
      q(WORKER_A, `insert into public.notifications (organization_id, member_id, kind, title) values ($1, $2, 'x', 'x')`, [
        ORG_A,
        WORKER_A.member,
      ]),
      '42501',
    )
    await expectCode(q(WORKER_A, `delete from public.notifications where id = $1`, [id]), '42501')
  })

  it('un membre retiré ne reçoit rien', async () => {
    await q('postgres', `update public.members set removed_at = now() where id = $1`, [WORKER_A.member])
    await expectCode(notify(MEMBRE_A, WORKER_A.member), '42501')
  })
})

describe('0013 : déclencheurs des notifications', () => {
  it('prospect ajouté par un apporteur → tous les admins, une seule fois', async () => {
    const [prospect] = await q<{ id: string }>(
      PROSP_A,
      `insert into public.prospects (organization_id, company, website) values ($1, 'Boulangerie Dupont', 'https://dupont.test') returning id`,
      [ORG_A],
    )
    const rows = await notifs('prospect.created')
    expect(rows.map((r) => r.member_id).sort()).toEqual([ADMIN_A1.member, ADMIN_A2.member].sort())
    expect(rows[0]).toMatchObject({
      title: 'Prosp A a ajouté un site : Boulangerie Dupont',
      body: 'https://dupont.test',
      link: `/prospects/${prospect!.id}`,
    })

    // Créé par un admin : personne n'est notifié.
    await q(ADMIN_A1, `insert into public.prospects (organization_id, company) values ($1, 'Autre')`, [ORG_A])
    expect(await notifs('prospect.created')).toHaveLength(2)
  })

  it('étape changée par quelqu’un d’autre → l’apporteur ; « Offre prête » a son propre message', async () => {
    const [prospect] = await q<{ id: string }>(
      PROSP_A,
      `insert into public.prospects (organization_id, company) values ($1, 'Garage Martin') returning id`,
      [ORG_A],
    )
    await q(MEMBRE_A, `update public.prospects set stage = 'offer_ready' where id = $1`, [prospect!.id])
    expect(await notifs('prospect.offer_ready')).toEqual([
      expect.objectContaining({ member_id: PROSP_A.member, title: 'Offre prête pour Garage Martin' }),
    ])
    await q(PROSP_A, `update public.prospects set stage = 'contacted' where id = $1`, [prospect!.id]) // lui-même : rien
    await q(ADMIN_A1, `update public.prospects set stage = 'meeting' where id = $1`, [prospect!.id])
    expect(await notifs('prospect.stage')).toEqual([
      expect.objectContaining({ member_id: PROSP_A.member, title: 'Garage Martin : Rendez-vous', body: 'Étape précédente : Contacté' }),
    ])
  })

  it('tâche attribuée par quelqu’un d’autre → la personne attribuée ; pas pendant la proposition', async () => {
    await q(ADMIN_A1, `update public.tasks set assignee_member_id = $2 where id = $1`, [TASK_OTHER, WORKER_A.member])
    expect(await notifs('task.assigned')).toEqual([
      expect.objectContaining({
        member_id: WORKER_A.member,
        title: 'Admin A1 t\'a attribué une tâche : Autre',
        link: `/projects/${PROJECT_A_ACTIVE}/tasks`,
      }),
    ])
    await q(MEMBRE_A, `update public.tasks set assignee_member_id = $2 where id = $1`, [TASK_OTHER, MEMBRE_A.member]) // soi-même
    expect(await notifs('task.assigned')).toHaveLength(1)

    // Ticket proposé (IA) : attribution suggérée, notifiée à la validation.
    const [ticket] = await q<{ id: string }>(
      'postgres',
      `insert into public.tickets (project_id, title, type) values ($1, 'Refonte', 'modification') returning id`,
      [PROJECT_A_ACTIVE],
    )
    await q('service_role', `insert into public.tasks (project_id, ticket_id, title, skill, assignee_member_id) values ($1, $2, 'Maquette', 'design', $3)`, [
      PROJECT_A_ACTIVE,
      ticket!.id,
      WORKER_A.member,
    ])
    expect(await notifs('task.assigned')).toHaveLength(1)
    await q(ADMIN_A1, `update public.tickets set status = 'validated' where id = $1`, [ticket!.id])
    const rows = await notifs('task.assigned')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ member_id: WORKER_A.member, title: 'Admin A1 t\'a attribué une tâche : Maquette', body: 'Refonte' })
  })

  it('entrée prête avec des tickets proposés → son créateur', async () => {
    const [input] = await q<{ id: string }>(
      MEMBRE_A,
      `insert into public.inputs (project_id, kind, title, raw_text, status, created_by)
       values ($1, 'written', 'Retour Ibé', 'Texte', 'analyzing', $2) returning id`,
      [PROJECT_A_ACTIVE, MEMBRE_A.member],
    )
    await q('service_role', `insert into public.tickets (project_id, input_id, title, type) values ($1, $2, 'A', 'bug'), ($1, $2, 'B', 'bug')`, [
      PROJECT_A_ACTIVE,
      input!.id,
    ])
    await q('service_role', `update public.inputs set status = 'ready' where id = $1`, [input!.id])
    expect(await notifs('input.ready')).toEqual([
      expect.objectContaining({
        member_id: MEMBRE_A.member,
        title: 'Tickets à valider : Retour Ibé',
        body: '2 tickets proposés',
        link: `/projects/${PROJECT_A_ACTIVE}/inputs/${input!.id}/review`,
      }),
    ])
  })

  it('dépôt prêt à ranger, ou rangé seul par une règle → son créateur', async () => {
    const [intake] = await q<{ id: string }>(
      MEMBRE_A,
      `insert into public.file_intakes (organization_id, storage_path, name) values ($1, $2, 'Devis-Ibe.pdf') returning id`,
      [ORG_A, `${ORG_A}/inbox/${MEMBRE_A.member}/1-devis.pdf`],
    )
    await q('service_role', `update public.file_intakes set status = 'classifying' where id = $1`, [intake!.id])
    await q('service_role', `update public.file_intakes set status = 'ready', confidence = 0.8 where id = $1`, [intake!.id])
    expect(await notifs('file.ready')).toEqual([
      expect.objectContaining({ member_id: MEMBRE_A.member, title: 'Fichier prêt à ranger : Devis-Ibe.pdf', body: 'Confiance : 80 %' }),
    ])

    const [file] = await q<{ id: string }>(
      'postgres',
      `insert into public.project_files (project_id, name, storage_path) values ($1, 'Devis-Ibe.pdf', $2) returning id`,
      [PROJECT_A_ACTIVE, `${ORG_A}/${PROJECT_A_ACTIVE}/1-devis.pdf`],
    )
    await q('service_role', `update public.file_intakes set status = 'filed', auto_filed = true, filed_file_id = $2 where id = $1`, [
      intake!.id,
      file!.id,
    ])
    expect(await notifs('file.auto_filed')).toEqual([
      expect.objectContaining({ member_id: MEMBRE_A.member, link: `/files/intake/${intake!.id}` }),
    ])
  })
})

describe('0013 : propositions de l’IA', () => {
  async function newProposal(who: Who = MEMBRE_A, payload: Record<string, unknown> = {}) {
    const [row] = await q<{ id: string; organization_id: string; status: string }>(
      who,
      `insert into public.ai_proposals (project_id, kind, title, explanation, payload)
       values ($1, 'reassign_task', 'Passer « À faire » à Membre A', 'Worker A est surchargé', $2::jsonb) returning id, organization_id, status`,
      [PROJECT_A_ACTIVE, JSON.stringify(payload)],
    )
    return row!
  }
  const reassign = {
    operations: [
      {
        task_id: TASK_TODO,
        before: { assignee_member_id: WORKER_A.member, due_date: null },
        after: { assignee_member_id: MEMBRE_A.member, due_date: '2026-12-10' },
      },
    ],
  }
  const taskState = async () =>
    (
      await q<{ assignee_member_id: string | null; due_date: string | null }>(
        'postgres',
        `select assignee_member_id, due_date::text from public.tasks where id = $1`,
        [TASK_TODO],
      )
    )[0]

  it('nouvelle proposition → membres visés, sinon les admins', async () => {
    const proposal = await newProposal(MEMBRE_A, { member_ids: [WORKER_A.member] })
    expect(proposal).toMatchObject({ organization_id: ORG_A, status: 'pending' })
    expect((await notifs('proposal.created')).map((r) => r.member_id)).toEqual([WORKER_A.member])
    await newProposal(MEMBRE_A)
    expect((await notifs('proposal.created')).map((r) => r.member_id).sort()).toEqual(
      [WORKER_A.member, ADMIN_A1.member, ADMIN_A2.member].sort(),
    )
    for (const who of [FIN_A, PROSP_A, ADMIN_B]) expect(await count(who, 'public.ai_proposals')).toBe(0)
    await expectCode(newProposal(FIN_A), '42501')
  })

  it('0019 : payload.member_ids ne contient que des membres actifs de l’organisation', async () => {
    await expectCode(newProposal(MEMBRE_A, { member_ids: [ADMIN_B.member] }), '23514', /membres actifs/) // autre organisation
    await expectCode(newProposal(MEMBRE_A, { member_ids: [WORKER_A.member, 'pas-un-id'] }), '23514')
    await expectCode(newProposal(MEMBRE_A, { member_ids: [42] }), '23514')
    await expectCode(newProposal(MEMBRE_A, { member_ids: ['a0000000-0000-4000-8000-000000000999'] }), '23514') // inconnu
    await q('postgres', `update public.members set removed_at = now() where id = $1`, [WORKER_A.member])
    await expectCode(newProposal(MEMBRE_A, { member_ids: [WORKER_A.member] }), '23514') // retiré
    await expectCode(newProposal('service_role', { member_ids: [ADMIN_B.member] }), '23514') // le serveur aussi
    expect(await notifs('proposal.created')).toEqual([])

    await newProposal(MEMBRE_A, { member_ids: [ADMIN_A2.member, FIN_A.member] })
    expect((await notifs('proposal.created')).map((r) => r.member_id).sort()).toEqual([ADMIN_A2.member, FIN_A.member].sort())
    // Une mise à jour qui ne touche pas le payload (décision) n'est pas recontrôlée.
    const [kept] = await q<{ id: string }>('postgres', `select id from public.ai_proposals limit 1`)
    await q('postgres', `update public.members set removed_at = now() where id = $1`, [ADMIN_A2.member])
    await q(ADMIN_A1, `select public.refuse_ai_proposal($1)`, [kept!.id])
  })

  it('appliquer puis annuler remet les valeurs d’avant', async () => {
    const proposal = await newProposal(MEMBRE_A, reassign)
    const [applied] = await q<{ status: string; decided_by: string; rule_id: string | null }>(
      ADMIN_A1,
      `select status, decided_by, rule_id from public.apply_ai_proposal($1)`,
      [proposal.id],
    )
    expect(applied).toEqual({ status: 'accepted', decided_by: ADMIN_A1.member, rule_id: null })
    expect(await taskState()).toEqual({ assignee_member_id: MEMBRE_A.member, due_date: '2026-12-10' })
    // L'attribution par la proposition notifie la personne attribuée (par celui qui a validé).
    expect(await notifs('task.assigned')).toEqual([expect.objectContaining({ member_id: MEMBRE_A.member })])

    await expectCode(q(ADMIN_A1, `select public.apply_ai_proposal($1)`, [proposal.id]), 'P0001')
    const [undone] = await q<{ status: string }>(MEMBRE_A, `select status from public.undo_ai_proposal($1)`, [proposal.id])
    expect(undone?.status).toBe('undone')
    expect(await taskState()).toEqual({ assignee_member_id: WORKER_A.member, due_date: null })
    await expectCode(q(MEMBRE_A, `select public.undo_ai_proposal($1)`, [proposal.id]), 'P0001')
  })

  it('« Toujours » crée la règle d’autonomie du projet', async () => {
    const proposal = await newProposal(MEMBRE_A, reassign)
    const [applied] = await q<{ rule_id: string }>(MEMBRE_A, `select rule_id from public.apply_ai_proposal($1, true)`, [proposal.id])
    const [rule] = await q<{ kind: string; scope: Record<string, string>; created_by: string }>(
      MEMBRE_A,
      `select kind, scope, created_by from public.ai_autonomy_rules where id = $1`,
      [applied!.rule_id],
    )
    expect(rule).toEqual({ kind: 'reassign_task', scope: { project_id: PROJECT_A_ACTIVE }, created_by: MEMBRE_A.member })
    await q(MEMBRE_A, `update public.ai_autonomy_rules set revoked_at = now() where id = $1`, [applied!.rule_id])
    await expectCode(q(MEMBRE_A, `update public.ai_autonomy_rules set kind = 'other' where id = $1`, [applied!.rule_id]), '42501')
  })

  it('refuser ; décisions réservées à admin et membre de l’organisation, jamais en direct', async () => {
    const proposal = await newProposal(MEMBRE_A, reassign)
    for (const who of [FIN_A, PROSP_A, ADMIN_B]) {
      await expectCode(q(who, `select public.apply_ai_proposal($1)`, [proposal.id]), '42501')
      await expectCode(q(who, `select public.refuse_ai_proposal($1)`, [proposal.id]), '42501')
    }
    await expectCode(q(MEMBRE_A, `update public.ai_proposals set status = 'accepted' where id = $1`, [proposal.id]), '42501')
    const [refused] = await q<{ status: string }>(WORKER_A, `select status from public.refuse_ai_proposal($1)`, [proposal.id])
    expect(refused?.status).toBe('refused')
    expect(await taskState()).toEqual({ assignee_member_id: WORKER_A.member, due_date: null })
  })

  it('une opération sur une tâche d’une autre organisation annule tout', async () => {
    const [taskB] = await q<{ id: string }>(
      'postgres',
      `insert into public.tasks (project_id, title, skill) values ($1, 'B', 'dev') returning id`,
      [PROJECT_B],
    )
    const proposal = await newProposal(MEMBRE_A, {
      operations: [...reassign.operations, { task_id: taskB!.id, before: {}, after: { priority: 'high' } }],
    })
    await expectCode(q(ADMIN_A1, `select public.apply_ai_proposal($1)`, [proposal.id]), 'P0001')
    expect(await taskState()).toEqual({ assignee_member_id: WORKER_A.member, due_date: null })
  })
})

describe('0013 : relances', () => {
  async function newQuote() {
    const [row] = await q<{ id: string }>(
      FIN_A,
      `insert into public.quotes (client_id, title) values ($1, 'Devis') returning id`,
      [CLIENT_A_FULL],
    )
    return row!.id
  }

  it('un brouillon par document, sent_at posé à l’envoi, admin et finance seulement', async () => {
    const quoteId = await newQuote()
    const [draft] = await q<{ id: string; organization_id: string; created_by: string }>(
      FIN_A,
      `insert into public.followups (target_type, target_id, draft) values ('quote', $1, 'Bonjour…') returning id, organization_id, created_by`,
      [quoteId],
    )
    expect(draft).toMatchObject({ organization_id: ORG_A, created_by: FIN_A.member })
    await expectCode(
      q(ADMIN_A1, `insert into public.followups (target_type, target_id) values ('quote', $1)`, [quoteId]),
      '23505',
    )
    const [sent] = await q<{ sent: boolean }>(
      ADMIN_A1,
      `update public.followups set status = 'sent' where id = $1 returning sent_at is not null as sent`,
      [draft!.id],
    )
    expect(sent?.sent).toBe(true)
    await q(FIN_A, `insert into public.followups (target_type, target_id) values ('quote', $1)`, [quoteId])

    for (const who of [MEMBRE_A, PROSP_A, ADMIN_B]) expect(await count(who, 'public.followups')).toBe(0)
    await expectCode(q(MEMBRE_A, `insert into public.followups (target_type, target_id) values ('quote', $1)`, [quoteId]), '42501')
    await expectCode(
      q(FIN_A, `insert into public.followups (target_type, target_id) values ('invoice', $1)`, [quoteId]),
      '23503',
    )
  })
})
