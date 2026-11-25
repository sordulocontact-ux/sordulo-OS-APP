/**
 * Tests de la migration 0010 : fichiers des projets (versions, corbeille, liens), règles « Toujours »,
 * dépôts en attente (statuts du client et du serveur), bucket « files » et politiques storage.objects
 * (dossier de l'organisation, dossier inbox du membre). Et de la 0019 : fichiers de devis / factures
 * réservés à admin et finance, chemins Storage contrôlés.
 * Lancer : npm run test:rls
 */
import { describe, expect, it } from 'vitest'
import {
  ADMIN_A1,
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
const QUOTE_B = 'b0000000-0000-4000-8000-000000000701'
const SHA = 'a'.repeat(64)

setupDatabase(`
  insert into auth.users (id, email, email_confirmed_at) values ('${FIN_A.user}', '${FIN_A.email}', now());
  insert into public.members (id, organization_id, user_id, name, email, role)
    values ('${FIN_A.member}', '${ORG_A}', '${FIN_A.user}', 'Finance A', '${FIN_A.email}', 'finance');
  insert into public.quotes (id, client_id, title) values ('${QUOTE_B}', '${CLIENT_B}', 'Devis B');
`)

interface FileRow {
  id: string
  organization_id: string
  version_group_id: string
  version: number
  uploaded_by: string | null
  folder: string
}

let n = 0
const path = (project = PROJECT_A_ACTIVE, org = ORG_A) => `${org}/${project}/${String(++n).padStart(8, '0')}-brief.pdf`

/** Fichier rangé (un brief par défaut : les fichiers de devis / factures sont réservés à admin et finance, 0019). */
async function newFile(who: Who = MEMBRE_A, extra: Record<string, unknown> = {}) {
  const fields: Record<string, unknown> = {
    project_id: PROJECT_A_ACTIVE,
    name: 'Brief.pdf',
    storage_path: path(),
    kind: 'brief',
    folder: 'Briefs',
    sha256: SHA,
    ...extra,
  }
  const keys = Object.keys(fields)
  const [row] = await q<FileRow>(
    who,
    `insert into public.project_files (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    Object.values(fields),
  )
  return row!
}

async function newIntake(who: Who = MEMBRE_A, member = MEMBRE_A.member) {
  const [row] = await q<{ id: string; created_by: string; status: string }>(
    who,
    `insert into public.file_intakes (organization_id, source, storage_path, name, sha256)
     values ($1, 'island', $2, 'Facture.pdf', $3) returning id, created_by, status`,
    [ORG_A, `${ORG_A}/inbox/${member}/${String(++n).padStart(8, '0')}-facture.pdf`, SHA],
  )
  return row!
}

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

describe('0010 : schéma', () => {
  it('a les colonnes de src/shared/types.ts', async () => {
    expect(await columns('project_files')).toEqual(
      [
        'id', 'organization_id', 'project_id', 'folder', 'name', 'storage_path', 'mime_type', 'size_bytes', 'sha256',
        'kind', 'summary', 'version_group_id', 'version', 'change_summary', 'quote_id', 'invoice_id', 'uploaded_by',
        'deleted_at', 'created_at', 'updated_at',
      ].sort(),
    )
    expect(await columns('filing_rules')).toEqual(
      ['id', 'organization_id', 'client_id', 'kind', 'project_id', 'folder', 'created_by', 'created_at', 'revoked_at'].sort(),
    )
    expect(await columns('file_intakes')).toEqual(
      [
        'id', 'organization_id', 'created_by', 'source', 'batch_id', 'storage_path', 'name', 'mime_type', 'size_bytes',
        'sha256', 'extracted_text', 'proposal', 'confidence', 'status', 'error_message', 'filed_file_id', 'auto_filed',
        'rule_id', 'created_at', 'updated_at',
      ].sort(),
    )
  })

  it('crée le bucket privé « files » de 100 Mo', async () => {
    const [bucket] = await q<{ public: boolean; file_size_limit: string }>(
      'postgres',
      `select public, file_size_limit::text from storage.buckets where id = 'files'`,
    )
    expect(bucket).toEqual({ public: false, file_size_limit: '104857600' })
  })
})

describe('0010 : project_files', () => {
  it('organisation du projet, auteur = membre connecté, lecture admin / membre / finance seulement', async () => {
    await expectCode(newFile(MEMBRE_A, { organization_id: ORG_B }), '42501') // déduite du projet, jamais fournie
    const file = await newFile(MEMBRE_A)
    expect(file).toMatchObject({ organization_id: ORG_A, uploaded_by: MEMBRE_A.member, version: 1, folder: 'Briefs' })
    expect(file.version_group_id).toBe(file.id)

    for (const who of [ADMIN_A1, MEMBRE_A, FIN_A]) expect(await count(who, 'public.project_files')).toBe(1)
    for (const who of [PROSP_A, ADMIN_B]) expect(await count(who, 'public.project_files')).toBe(0)

    await newFile(FIN_A) // la finance range aussi
    await expectCode(newFile(PROSP_A), '42501')
    await expectCode(newFile(ADMIN_B), '42501')
  })

  it('refuse un chemin hors du dossier de l’organisation, un devis d’une autre organisation, un doublon de chemin', async () => {
    await expectCode(newFile(MEMBRE_A, { storage_path: path(PROJECT_B, ORG_B) }), '23514')
    await expectCode(newFile(ADMIN_A1, { quote_id: QUOTE_B }), '23514')
    const file = await newFile()
    const [{ storage_path: taken }] = (await q<{ storage_path: string }>(
      'postgres',
      `select storage_path from public.project_files where id = $1`,
      [file.id],
    )) as [{ storage_path: string }]
    await expectCode(newFile(MEMBRE_A, { storage_path: taken }), '23505')
    await expectCode(newFile(MEMBRE_A, { folder: 'x'.repeat(81) }), '23514')
    await expectCode(newFile(MEMBRE_A, { kind: 'photo' }), '23514')
  })

  it('numérote les versions dans le groupe de la 1re', async () => {
    const v1 = await newFile()
    await expectCode(newFile(MEMBRE_A, { version_group_id: v1.id, version: 7 }), '42501') // numéro posé par la base
    const v2 = await newFile(MEMBRE_A, { version_group_id: v1.id, change_summary: 'Prix revu' })
    const v3 = await newFile(FIN_A, { version_group_id: v1.id })
    expect([v2.version, v3.version]).toEqual([2, 3])
    expect(v2.version_group_id).toBe(v1.id)
    await expectCode(newFile(MEMBRE_A, { version_group_id: 'a0000000-0000-4000-8000-00000000ffff' }), '23503')
  })

  it('corbeille, déplacement dans un autre projet de l’organisation, jamais dans une autre organisation', async () => {
    const file = await newFile()
    await q(MEMBRE_A, `update public.project_files set deleted_at = now(), project_id = $2 where id = $1`, [file.id, PROJECT_A_ODD])
    const [moved] = await q<{ project_id: string; deleted: boolean }>(
      'postgres',
      `select project_id, deleted_at is not null as deleted from public.project_files where id = $1`,
      [file.id],
    )
    expect(moved).toEqual({ project_id: PROJECT_A_ODD, deleted: true })
    await expectCode(q('postgres', `update public.project_files set project_id = $2 where id = $1`, [file.id, PROJECT_B]), '42501')
    // Chemin, version et auteur ne se modifient pas.
    await expectCode(q(MEMBRE_A, `update public.project_files set storage_path = 'x' where id = $1`, [file.id]), '42501')
    await expectCode(q(MEMBRE_A, `update public.project_files set version = 4 where id = $1`, [file.id]), '42501')
  })
})

describe('0019 : fichiers de devis, de factures et de contrats (admin et finance)', () => {
  const quoteFile = (who: Who, extra: Record<string, unknown> = {}) =>
    newFile(who, { kind: 'quote', folder: 'Devis', name: 'Devis.pdf', ...extra })

  it('le membre ne lit, ne crée, ne modifie ni ne supprime un fichier de devis ou de facture', async () => {
    const quote = await quoteFile(FIN_A)
    await newFile(FIN_A, { kind: 'invoice', folder: 'Factures' })
    const brief = await newFile(MEMBRE_A)
    for (const who of [ADMIN_A1, FIN_A]) expect(await count(who, 'public.project_files')).toBe(3)
    expect(await count(MEMBRE_A, 'public.project_files')).toBe(1)
    expect(await count(WORKER_A, 'public.project_files')).toBe(1)

    await expectCode(quoteFile(MEMBRE_A), '42501')
    await expectCode(newFile(MEMBRE_A, { kind: 'invoice' }), '42501')
    // Un contrat porte aussi les prix (orchestrateur, 0019).
    await expectCode(newFile(MEMBRE_A, { kind: 'contract', folder: 'Contrats' }), '42501')
    // Un autre type relié à un devis compte comme un fichier de devis.
    const [{ id: quoteId }] = (await q<{ id: string }>(
      FIN_A,
      `insert into public.quotes (client_id, title) values ($1, 'Devis A') returning id`,
      [CLIENT_A_FULL],
    )) as [{ id: string }]
    await expectCode(newFile(MEMBRE_A, { quote_id: quoteId }), '42501')
    expect(await q(MEMBRE_A, `update public.project_files set kind = 'other' where id = $1 returning id`, [quote.id])).toEqual([])
    expect(await q(MEMBRE_A, `delete from public.project_files where id = $1 returning id`, [quote.id])).toEqual([])
    // Il ne classe pas non plus un de ses fichiers en devis (la ligne sortirait de ses droits).
    await expectCode(q(MEMBRE_A, `update public.project_files set kind = 'quote' where id = $1`, [brief.id]), '42501')

    // Admin et finance gardent la main.
    await q(ADMIN_A1, `update public.project_files set summary = 'Devis v1' where id = $1`, [quote.id])
    await quoteFile(ADMIN_A1)
    await q(FIN_A, `delete from public.project_files where id = $1`, [quote.id])
  })

  it('l’objet Storage d’un fichier de devis : admin et finance seulement ; les autres objets du projet restent partagés', async () => {
    const put = (who: Who, name: string) => q(who, `insert into storage.objects (bucket_id, name) values ('files', $1)`, [name])
    const visible = async (who: Who) =>
      (await q<{ name: string }>(who, `select name from storage.objects where bucket_id = 'files' order by name`)).map((r) => r.name)
    const quotePath = `${ORG_A}/${PROJECT_A_ACTIVE}/0001-devis.pdf`
    const briefPath = `${ORG_A}/${PROJECT_A_ACTIVE}/0002-brief.pdf`
    await put(FIN_A, quotePath)
    await quoteFile(FIN_A, { storage_path: quotePath })
    await put(MEMBRE_A, briefPath)
    await newFile(MEMBRE_A, { storage_path: briefPath })

    expect(await visible(MEMBRE_A)).toEqual([briefPath])
    expect(await visible(FIN_A)).toEqual([quotePath, briefPath])
    expect(await visible(ADMIN_A1)).toEqual([quotePath, briefPath])
    // Le membre ne l'écrase ni ne le supprime.
    await q(MEMBRE_A, `delete from storage.objects where name = $1`, [quotePath])
    await q(MEMBRE_A, `update storage.objects set updated_at = now() where name = $1`, [quotePath])
    expect(await visible(FIN_A)).toEqual([quotePath, briefPath])
  })
})

describe('0019 : chemins Storage des fichiers et des dépôts', () => {
  it('project_files : <organisation>/<projet de la ligne>/<nom>, sans « .. », serveur compris', async () => {
    const bad = [
      `${ORG_A}/${PROJECT_A_ODD}/0001-x.pdf`, // autre projet de l'organisation
      `${ORG_A}/inbox/${ADMIN_A1.member}/11111111-1111-4111-8111-111111111111-secret.pdf`, // dossier inbox d'un admin
      `${ORG_A}/../${ORG_B}/${PROJECT_B}/f.pdf`,
      `${ORG_A}/${PROJECT_A_ACTIVE}/sous/0001-x.pdf`,
      `${ORG_A}/${PROJECT_A_ACTIVE}/..`,
      `${ORG_A}/${PROJECT_A_ACTIVE}/.`,
      `${ORG_A}/${PROJECT_A_ACTIVE}/0001-a..b.pdf`,
      `${ORG_A}/${PROJECT_A_ACTIVE}/`,
      `${ORG_A}/${PROJECT_A_ACTIVE}`,
    ]
    for (const storage_path of bad) {
      await expectCode(newFile(MEMBRE_A, { storage_path }), '23514')
      await expectCode(newFile('service_role', { storage_path }), '23514')
    }
    // Le rangement du serveur (objet déplacé vers le chemin du projet) passe.
    const [served] = await q<{ uploaded_by: string | null }>(
      'service_role',
      `insert into public.project_files (project_id, name, storage_path, uploaded_by) values ($1, 'x.pdf', $2, $3) returning uploaded_by`,
      [PROJECT_A_ODD, path(PROJECT_A_ODD), MEMBRE_A.member],
    )
    expect(served?.uploaded_by).toBe(MEMBRE_A.member)
    await newFile(MEMBRE_A, { storage_path: `${ORG_A}/${PROJECT_A_ACTIVE}/0001-Devis.v2.pdf` })
  })

  it('file_intakes : <organisation>/inbox/<auteur>/<nom>, sans « .. »', async () => {
    const intake = (who: Who, storagePath: string) =>
      q(who, `insert into public.file_intakes (organization_id, storage_path, name, extracted_text) values ($1, $2, 'x.pdf', 'x')`, [
        ORG_A,
        storagePath,
      ])
    for (const storagePath of [
      `${ORG_A}/${PROJECT_A_ACTIVE}/abc.pdf`, // chemin d'un fichier rangé
      `${ORG_A}/inbox/${WORKER_A.member}/abc.pdf`, // dossier d'un autre membre
      `${ORG_A}/inbox/${MEMBRE_A.member}/../${WORKER_A.member}/abc.pdf`,
      `${ORG_A}/inbox/${MEMBRE_A.member}/sous/abc.pdf`,
      `${ORG_A}/inbox/${MEMBRE_A.member}/..`,
      `${ORG_A}/inbox/${MEMBRE_A.member}/`,
    ]) {
      await expectCode(intake(MEMBRE_A, storagePath), '23514')
    }
    await intake(MEMBRE_A, `${ORG_A}/inbox/${MEMBRE_A.member}/0001-facture.pdf`)
    // Sans auteur (le serveur oublie created_by) : refusé.
    await expectCode(intake('service_role', `${ORG_A}/inbox/${MEMBRE_A.member}/0002-facture.pdf`), '23514')
  })

  it('storage.objects : aucun « .. » ni « . » dans le chemin', async () => {
    const put = (name: string) => q(MEMBRE_A, `insert into storage.objects (bucket_id, name) values ('files', $1)`, [name])
    await expectCode(put(`${ORG_A}/${PROJECT_A_ACTIVE}/..`), '42501')
    await expectCode(put(`${ORG_A}/${PROJECT_A_ACTIVE}/0001-a..b.pdf`), '42501')
    await expectCode(put(`${ORG_A}/inbox/${MEMBRE_A.member}/.`), '42501')
    await put(`${ORG_A}/${PROJECT_A_ACTIVE}/0001-a.b.pdf`)
  })
})

describe('0010 : filing_rules', () => {
  it('une règle active par client et type, révocable, isolée par organisation', async () => {
    const [rule] = await q<{ id: string; organization_id: string; created_by: string }>(
      MEMBRE_A,
      `insert into public.filing_rules (client_id, kind, project_id, folder) values ($1, 'invoice', $2, 'Factures')
       returning id, organization_id, created_by`,
      [CLIENT_A_FULL, PROJECT_A_ACTIVE],
    )
    expect(rule).toMatchObject({ organization_id: ORG_A, created_by: MEMBRE_A.member })
    await expectCode(
      q(ADMIN_A1, `insert into public.filing_rules (client_id, kind) values ($1, 'invoice')`, [CLIENT_A_FULL]),
      '23505',
    )
    await expectCode(q(MEMBRE_A, `update public.filing_rules set kind = 'quote' where id = $1`, [rule!.id]), '42501')
    await q(MEMBRE_A, `update public.filing_rules set revoked_at = now() where id = $1`, [rule!.id])
    await q(ADMIN_A1, `insert into public.filing_rules (client_id, kind) values ($1, 'invoice')`, [CLIENT_A_FULL])

    expect(await count(ADMIN_B, 'public.filing_rules')).toBe(0)
    expect(await count(PROSP_A, 'public.filing_rules')).toBe(0)
    await expectCode(
      q(ADMIN_A1, `insert into public.filing_rules (client_id, kind, project_id) values ($1, 'quote', $2)`, [
        CLIENT_A_FULL,
        PROJECT_B,
      ]),
      '23514',
    )
    await expectCode(q(ADMIN_B, `insert into public.filing_rules (client_id, kind) values ($1, 'quote')`, [CLIENT_A_FULL]), '42501')
  })
})

describe('0010 : file_intakes', () => {
  it('visible par son auteur et les admins, jamais par un autre membre ou une autre organisation', async () => {
    const intake = await newIntake()
    expect(intake).toMatchObject({ created_by: MEMBRE_A.member, status: 'uploaded' })
    expect(await count(MEMBRE_A, 'public.file_intakes')).toBe(1)
    expect(await count(ADMIN_A1, 'public.file_intakes')).toBe(1)
    for (const who of [WORKER_A, FIN_A, PROSP_A, ADMIN_B]) expect(await count(who, 'public.file_intakes')).toBe(0)
    await expectCode(newIntake(PROSP_A, PROSP_A.member), '42501')
    // Un autre membre ne voit pas le dépôt : rien n'est modifié.
    expect(await q(WORKER_A, `update public.file_intakes set status = 'cancelled' where id = $1 returning id`, [intake.id])).toEqual([])
  })

  it('le serveur classe ; le client range, annule ou remet à ranger, jamais la proposition', async () => {
    const intake = await newIntake()
    await expectCode(q(MEMBRE_A, `update public.file_intakes set status = 'classifying' where id = $1`, [intake.id]), '42501')
    await expectCode(q(MEMBRE_A, `update public.file_intakes set proposal = '{}' where id = $1`, [intake.id]), '42501')
    await expectCode(q(MEMBRE_A, `update public.file_intakes set auto_filed = true where id = $1`, [intake.id]), '42501')

    await q(
      'service_role',
      `update public.file_intakes set status = 'ready', confidence = 0.92, proposal = '{"kind": "invoice"}' where id = $1`,
      [intake.id],
    )
    await expectCode(q(MEMBRE_A, `update public.file_intakes set status = 'filed' where id = $1`, [intake.id]), '23514')

    const file = await newFile()
    await q(MEMBRE_A, `update public.file_intakes set status = 'filed', filed_file_id = $2 where id = $1`, [intake.id, file.id])
    await q(MEMBRE_A, `update public.file_intakes set status = 'ready' where id = $1`, [intake.id]) // rangement annulé
    await q(MEMBRE_A, `update public.file_intakes set status = 'cancelled' where id = $1`, [intake.id])

    // Suppression définitive du fichier : le dépôt rangé n'empêche rien.
    const other = await newIntake()
    const file2 = await newFile()
    await q(MEMBRE_A, `update public.file_intakes set status = 'filed', filed_file_id = $2 where id = $1`, [other.id, file2.id])
    await q(MEMBRE_A, `delete from public.project_files where id = $1`, [file2.id])
    const [after] = await q<{ status: string; filed_file_id: string | null }>(
      'postgres',
      `select status, filed_file_id from public.file_intakes where id = $1`,
      [other.id],
    )
    expect(after).toEqual({ status: 'filed', filed_file_id: null })
  })

  it('refuse un chemin hors de l’organisation, un fichier ou une règle d’une autre organisation', async () => {
    await expectCode(
      q(MEMBRE_A, `insert into public.file_intakes (organization_id, storage_path, name) values ($1, $2, 'x.pdf')`, [
        ORG_A,
        `${ORG_B}/inbox/${MEMBRE_A.member}/x.pdf`,
      ]),
      '23514',
    )
    const [fileB] = await q<{ id: string }>(
      'postgres',
      `insert into public.project_files (project_id, name, storage_path) values ($1, 'b.pdf', $2) returning id`,
      [PROJECT_B, path(PROJECT_B, ORG_B)],
    )
    const intake = await newIntake()
    await expectCode(
      q(MEMBRE_A, `update public.file_intakes set status = 'filed', filed_file_id = $2 where id = $1`, [intake.id, fileB!.id]),
      '23514',
    )
  })
})

describe('0010 : storage.objects (bucket « files »)', () => {
  const put = (who: Who, name: string, bucket = 'files') =>
    q(who, `insert into storage.objects (bucket_id, name) values ($1, $2)`, [bucket, name])
  const visible = async (who: Who) =>
    (await q<{ name: string }>(who, `select name from storage.objects where bucket_id = 'files' order by name`)).map((r) => r.name)

  it('dossier d’un projet : admin, membre et finance de l’organisation', async () => {
    const name = `${ORG_A}/${PROJECT_A_ACTIVE}/0001-devis.pdf`
    await put(MEMBRE_A, name)
    await put(FIN_A, `${ORG_A}/${PROJECT_A_ACTIVE}/0002-facture.pdf`)
    expect(await visible(ADMIN_A1)).toHaveLength(2)
    expect(await visible(FIN_A)).toHaveLength(2)
    expect(await visible(PROSP_A)).toEqual([])
    expect(await visible(ADMIN_B)).toEqual([])

    await expectCode(put(PROSP_A, `${ORG_A}/${PROJECT_A_ACTIVE}/0003-x.pdf`), '42501')
    await expectCode(put(ADMIN_B, `${ORG_A}/${PROJECT_A_ACTIVE}/0003-x.pdf`), '42501')
    // Projet d'une autre organisation, dossier d'une autre organisation, chemin sans projet, autre bucket.
    await expectCode(put(MEMBRE_A, `${ORG_A}/${PROJECT_B}/0004-x.pdf`), '42501')
    await expectCode(put(MEMBRE_A, `${ORG_B}/${PROJECT_B}/0004-x.pdf`), '42501')
    await expectCode(put(MEMBRE_A, `${ORG_A}/0004-x.pdf`), '42501')
    await expectCode(put(MEMBRE_A, `${ORG_A}/${PROJECT_A_ACTIVE}/sous/0004-x.pdf`), '42501')
    await expectCode(put(MEMBRE_A, `${ORG_A}/${PROJECT_A_ACTIVE}/0004-x.pdf`, 'audio'), '42501')

    await q(FIN_A, `delete from storage.objects where name = $1`, [name])
    expect(await visible(ADMIN_A1)).toHaveLength(1)
  })

  it('dossier inbox : seulement son propre dossier ; les admins le lisent sans le modifier', async () => {
    const mine = `${ORG_A}/inbox/${MEMBRE_A.member}/0001-facture.pdf`
    await put(MEMBRE_A, mine)
    await expectCode(put(MEMBRE_A, `${ORG_A}/inbox/${WORKER_A.member}/0002-x.pdf`), '42501')
    await expectCode(put(PROSP_A, `${ORG_A}/inbox/${PROSP_A.member}/0002-x.pdf`), '42501')
    await expectCode(put(ADMIN_B, `${ORG_A}/inbox/${ADMIN_B.member}/0002-x.pdf`), '42501')

    expect(await visible(MEMBRE_A)).toEqual([mine])
    expect(await visible(WORKER_A)).toEqual([])
    expect(await visible(ADMIN_A1)).toEqual([mine])
    expect(await visible(ADMIN_B)).toEqual([])

    await q(ADMIN_A1, `delete from storage.objects where name = $1`, [mine]) // filtré par la RLS : rien n'est supprimé
    await q(WORKER_A, `delete from storage.objects where name = $1`, [mine])
    expect(await visible(MEMBRE_A)).toEqual([mine])
    await q(MEMBRE_A, `delete from storage.objects where name = $1`, [mine])
    expect(await visible(MEMBRE_A)).toEqual([])
  })
})
