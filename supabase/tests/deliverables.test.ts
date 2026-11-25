/**
 * Tests de la migration 0015 : contrats (organisation du client, signature, figement), livrables et versions
 * (numérotation, statut suivi), commentaires épinglés (membre ou client, notification), jetons MCP.
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
  PROJECT_A_ODD,
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
const FILE_A = 'a0000000-0000-4000-8000-000000000a01'
const FILE_A2 = 'a0000000-0000-4000-8000-000000000a02'
const FILE_ODD = 'a0000000-0000-4000-8000-000000000a03'

setupDatabase(`
  insert into auth.users (id, email, email_confirmed_at) values ('${FIN_A.user}', '${FIN_A.email}', now());
  insert into public.members (id, organization_id, user_id, name, email, role)
    values ('${FIN_A.member}', '${ORG_A}', '${FIN_A.user}', 'Finance A', '${FIN_A.email}', 'finance');
  insert into public.project_files (id, project_id, name, storage_path, kind) values
    ('${FILE_A}', '${PROJECT_A_ACTIVE}', 'Accueil-v1.png', '${ORG_A}/${PROJECT_A_ACTIVE}/1-accueil.png', 'deliverable'),
    ('${FILE_A2}', '${PROJECT_A_ACTIVE}', 'Accueil-v2.png', '${ORG_A}/${PROJECT_A_ACTIVE}/2-accueil.png', 'deliverable'),
    ('${FILE_ODD}', '${PROJECT_A_ODD}', 'Autre.png', '${ORG_A}/${PROJECT_A_ODD}/3-autre.png', 'deliverable');
`)

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

describe('0015 : schéma', () => {
  it('a les colonnes de src/shared/types.ts', async () => {
    expect(await columns('contracts')).toEqual(
      [
        'id', 'organization_id', 'project_id', 'client_id', 'quote_id', 'title', 'body', 'status', 'sent_at', 'signed_at',
        'signed_by_name', 'signed_via', 'file_id', 'created_by', 'created_at', 'updated_at',
      ].sort(),
    )
    expect(await columns('deliverables')).toEqual(
      ['id', 'organization_id', 'project_id', 'title', 'description', 'status', 'position', 'created_at', 'updated_at'].sort(),
    )
    expect(await columns('deliverable_versions')).toEqual(
      [
        'id', 'organization_id', 'deliverable_id', 'version', 'file_id', 'note', 'status', 'decided_at', 'decided_by_name',
        'created_by', 'created_at',
      ].sort(),
    )
    expect(await columns('deliverable_comments')).toEqual(
      ['id', 'organization_id', 'version_id', 'x', 'y', 'body', 'author_member_id', 'author_name', 'from_client', 'resolved_at', 'created_at'].sort(),
    )
    expect(await columns('api_tokens')).toEqual(
      ['id', 'organization_id', 'member_id', 'name', 'token_hash', 'prefix', 'last_used_at', 'created_at', 'revoked_at'].sort(),
    )
  })
})

describe('0015 : contrats (admin et finance seulement depuis la 0019)', () => {
  async function newContract(who: Who = FIN_A, extra: Record<string, unknown> = {}) {
    const fields: Record<string, unknown> = { client_id: CLIENT_A_FULL, project_id: PROJECT_A_ACTIVE, title: 'Contrat de prestation', body: '# Objet', ...extra }
    const keys = Object.keys(fields)
    const [row] = await q<{ id: string; organization_id: string; created_by: string; status: string }>(
      who,
      `insert into public.contracts (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})
       returning id, organization_id, created_by, status`,
      Object.values(fields),
    )
    return row!
  }

  it('admin et finance ; organisation du client ; projet de la même organisation', async () => {
    const contract = await newContract()
    expect(contract).toMatchObject({ organization_id: ORG_A, created_by: FIN_A.member, status: 'draft' })
    await newContract(ADMIN_A1)
    for (const who of [ADMIN_A1, FIN_A]) expect(await count(who, 'public.contracts')).toBe(2)
    for (const who of [MEMBRE_A, PROSP_A, ADMIN_B]) expect(await count(who, 'public.contracts')).toBe(0)
    await expectCode(newContract(PROSP_A), '42501')
    await expectCode(newContract(FIN_A, { project_id: PROJECT_B }), '23514')
    await expectCode(newContract(ADMIN_B, { client_id: CLIENT_B, project_id: PROJECT_B, file_id: FILE_A }), '23514')
  })

  it('0019 : le membre ne lit, ne crée, ne modifie ni ne supprime aucun contrat (il reprend les prix du devis)', async () => {
    const contract = await newContract()
    await expectCode(newContract(MEMBRE_A), '42501')
    expect(await q(MEMBRE_A, `select id, body from public.contracts`)).toEqual([])
    expect(await q(MEMBRE_A, `update public.contracts set title = 'Pris' where id = $1 returning id`, [contract.id])).toEqual([])
    expect(await q(MEMBRE_A, `delete from public.contracts where id = $1 returning id`, [contract.id])).toEqual([])
    const [kept] = await q<{ title: string }>('postgres', `select title from public.contracts where id = $1`, [contract.id])
    expect(kept?.title).toBe('Contrat de prestation')
  })

  it('envoi et signature horodatés ; signé = figé, seule l’annulation reste ; suppression des brouillons', async () => {
    const contract = await newContract()
    const [sent] = await q<{ sent: boolean }>(
      FIN_A,
      `update public.contracts set status = 'sent' where id = $1 returning sent_at is not null as sent`,
      [contract.id],
    )
    expect(sent?.sent).toBe(true)
    await expectCode(q(FIN_A, `delete from public.contracts where id = $1`, [contract.id]), 'P0001')

    const [signed] = await q<{ signed_at: string; signed_via: string; signed_by_name: string }>(
      FIN_A,
      `update public.contracts set status = 'signed', signed_by_name = 'Camille Ibé', signed_at = '2026-11-20 10:00+01'
       where id = $1 returning signed_at::text, signed_via, signed_by_name`,
      [contract.id],
    )
    expect(signed).toMatchObject({ signed_via: 'manual', signed_by_name: 'Camille Ibé' })
    await expectCode(q(FIN_A, `update public.contracts set body = 'Autre' where id = $1`, [contract.id]), 'P0001')
    await expectCode(q(ADMIN_A1, `update public.contracts set status = 'draft' where id = $1`, [contract.id]), 'P0001')
    await q(FIN_A, `update public.contracts set file_id = $2 where id = $1`, [contract.id, FILE_A]) // PDF signé rangé
    await q(ADMIN_A1, `update public.contracts set status = 'cancelled' where id = $1`, [contract.id])

    const draft = await newContract()
    await q(FIN_A, `delete from public.contracts where id = $1`, [draft.id])
  })
})

describe('0015 : livrables, versions, commentaires', () => {
  async function newDeliverable(who: Who = MEMBRE_A) {
    const [row] = await q<{ id: string; organization_id: string; status: string }>(
      who,
      `insert into public.deliverables (project_id, title) values ($1, 'Page d''accueil') returning id, organization_id, status`,
      [PROJECT_A_ACTIVE],
    )
    return row!
  }
  const addVersion = async (who: Who, deliverableId: string, fileId: string) =>
    (
      await q<{ id: string; version: number; organization_id: string; created_by: string }>(
        who,
        `insert into public.deliverable_versions (deliverable_id, file_id) values ($1, $2) returning id, version, organization_id, created_by`,
        [deliverableId, fileId],
      )
    )[0]!
  const deliverableStatus = async (id: string) =>
    (await q<{ status: string }>('postgres', `select status from public.deliverables where id = $1`, [id]))[0]!.status

  it('admin et membre seulement ; versions numérotées, fichier du même projet ; le livrable suit sa dernière version', async () => {
    const deliverable = await newDeliverable()
    expect(deliverable).toMatchObject({ organization_id: ORG_A, status: 'in_progress' })
    for (const who of [FIN_A, PROSP_A, ADMIN_B]) expect(await count(who, 'public.deliverables')).toBe(0)
    await expectCode(newDeliverable(FIN_A), '42501')

    const v1 = await addVersion(MEMBRE_A, deliverable.id, FILE_A)
    expect(v1).toMatchObject({ version: 1, organization_id: ORG_A, created_by: MEMBRE_A.member })
    expect(await deliverableStatus(deliverable.id)).toBe('in_review')
    await expectCode(addVersion(MEMBRE_A, deliverable.id, FILE_ODD), '23514')

    const [decided] = await q<{ decided: boolean }>(
      'service_role', // portail client
      `update public.deliverable_versions set status = 'changes_requested', decided_by_name = 'Camille' where id = $1
       returning decided_at is not null as decided`,
      [v1.id],
    )
    expect(decided?.decided).toBe(true)
    expect(await deliverableStatus(deliverable.id)).toBe('changes_requested')

    const v2 = await addVersion(ADMIN_A1, deliverable.id, FILE_A2)
    expect(v2.version).toBe(2)
    expect(await deliverableStatus(deliverable.id)).toBe('in_review')
    await q(MEMBRE_A, `update public.deliverable_versions set status = 'approved' where id = $1`, [v2.id])
    expect(await deliverableStatus(deliverable.id)).toBe('approved')
    // Une ancienne version ne pilote plus le statut.
    await q(MEMBRE_A, `update public.deliverable_versions set status = 'pending' where id = $1`, [v1.id])
    expect(await deliverableStatus(deliverable.id)).toBe('approved')

    // Un fichier utilisé par un livrable ne se supprime pas définitivement.
    await expectCode(q(MEMBRE_A, `delete from public.project_files where id = $1`, [FILE_A]), '23503')
  })

  it('commentaires : membre (auteur posé par la base) ou client (serveur) ; le client notifie le projet', async () => {
    const deliverable = await newDeliverable()
    const v1 = await addVersion(MEMBRE_A, deliverable.id, FILE_A)

    const [mine] = await q<{ author_member_id: string; from_client: boolean; organization_id: string }>(
      WORKER_A,
      `insert into public.deliverable_comments (version_id, x, y, body) values ($1, 0.25, 0.4, 'Logo trop petit')
       returning author_member_id, from_client, organization_id`,
      [v1.id],
    )
    expect(mine).toEqual({ author_member_id: WORKER_A.member, from_client: false, organization_id: ORG_A })
    await expectCode(
      q(WORKER_A, `insert into public.deliverable_comments (version_id, body, from_client, author_name) values ($1, 'x', true, 'Faux client')`, [
        v1.id,
      ]),
      '42501',
    )
    await expectCode(q(WORKER_A, `insert into public.deliverable_comments (version_id, x, body) values ($1, 0.5, 'x')`, [v1.id]), '23514')
    await expectCode(q(WORKER_A, `insert into public.deliverable_comments (version_id, x, y, body) values ($1, 1.5, 0.5, 'x')`, [v1.id]), '23514')
    expect(await count('postgres', `public.notifications where kind = 'deliverable.comment'`)).toBe(0)

    // Sans membre de projet : les admins. Avec : les membres du projet (admin, membre).
    await q('service_role', `insert into public.deliverable_comments (version_id, body, from_client, author_name) values ($1, 'Superbe', true, 'Camille')`, [
      v1.id,
    ])
    let notified = await q<{ member_id: string; title: string }>(
      'postgres',
      `select member_id, title from public.notifications where kind = 'deliverable.comment' order by member_id`,
    )
    expect(notified.map((n) => n.member_id).sort()).toEqual([ADMIN_A1.member, ADMIN_A2.member].sort())
    expect(notified[0]?.title).toBe('Camille a commenté « Page d\'accueil »')

    await q('postgres', `insert into public.project_members (project_id, member_id) values ($1, $2), ($1, $3)`, [
      PROJECT_A_ACTIVE,
      WORKER_A.member,
      FIN_A.member,
    ])
    await q('service_role', `insert into public.deliverable_comments (version_id, body, from_client, author_name) values ($1, 'Et ici ?', true, 'Camille')`, [
      v1.id,
    ])
    notified = await q('postgres', `select member_id, title from public.notifications where kind = 'deliverable.comment'`)
    expect(notified.filter((n) => n.member_id === WORKER_A.member)).toHaveLength(1)
    expect(notified).toHaveLength(3)

    for (const who of [FIN_A, ADMIN_B]) expect(await count(who, 'public.deliverable_comments')).toBe(0)
    await q(MEMBRE_A, `update public.deliverable_comments set resolved_at = now() where from_client`)
  })
})

describe('0015 : api_tokens', () => {
  const hash = (c: string) => c.repeat(64)
  const create = (who: Who, h = hash('a'), extra = '') =>
    q<{ id: string; member_id: string; organization_id: string }>(
      who,
      `insert into public.api_tokens (name, token_hash, prefix${extra ? ', organization_id' : ''}) values ('Claude Desktop', $1, 'sdo_abcd'${extra ? ', $2' : ''})
       returning id, member_id, organization_id`,
      extra ? [h, extra] : [h],
    )

  it('chacun crée, lit et révoque les siens ; les admins lisent ceux de l’organisation', async () => {
    const [token] = await create(MEMBRE_A)
    expect(token).toMatchObject({ member_id: MEMBRE_A.member, organization_id: ORG_A })
    expect(await count(MEMBRE_A, 'public.api_tokens')).toBe(1)
    expect(await count(ADMIN_A1, 'public.api_tokens')).toBe(1)
    for (const who of [WORKER_A, ADMIN_B]) expect(await count(who, 'public.api_tokens')).toBe(0)

    expect(await q(ADMIN_A1, `update public.api_tokens set revoked_at = now() where id = $1 returning id`, [token!.id])).toEqual([])
    await q(MEMBRE_A, `update public.api_tokens set revoked_at = now() where id = $1`, [token!.id])
    await q(MEMBRE_A, `update public.api_tokens set revoked_at = null where id = $1`, [token!.id]) // révoqué le reste
    const [row] = await q<{ revoked: boolean }>('postgres', `select revoked_at is not null as revoked from public.api_tokens where id = $1`, [
      token!.id,
    ])
    expect(row?.revoked).toBe(true)
  })

  it('jamais pour un autre membre ; empreinte unique et au bon format', async () => {
    await expectCode(
      q(MEMBRE_A, `insert into public.api_tokens (member_id, name, token_hash, prefix) values ($1, 'x', $2, 'sdo_abcd')`, [
        WORKER_A.member,
        hash('b'),
      ]),
      '42501',
    )
    await expectCode(create(MEMBRE_A, hash('c'), ORG_B), '23503')
    await create(MEMBRE_A, hash('d'))
    await expectCode(create(WORKER_A, hash('d')), '23505')
    await expectCode(create(WORKER_A, 'pas-un-hash'), '23514')
    await expectCode(q(MEMBRE_A, `update public.api_tokens set token_hash = $1`, [hash('e')]), '42501')
    // L'apporteur aussi peut avoir un jeton (ses droits restent ceux de son rôle).
    await create(PROSP_A, hash('f'))
  })
})
