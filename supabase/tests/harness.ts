/**
 * Harnais commun des tests RLS (PGlite, Postgres en mémoire, ni base ni réseau).
 * Simule ce que Supabase fournit : rôles anon / authenticated / service_role, auth.users,
 * auth.sessions, auth.uid() et auth.jwt() (lus dans le réglage request.jwt.claims), storage.buckets.
 * Applique 0001, 0002, les données de départ, puis 0003, 0004, 0005, 0007 et 0008 deux fois chacune (elles
 * doivent être rejouables).
 *
 * Chaque test tourne dans une transaction annulée à la fin : les données de départ restent intactes.
 * Chaque fichier de test a sa propre base (vitest isole les modules par fichier).
 */
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest'

const migration = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')

const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id                 uuid primary key,
    email              text,
    email_confirmed_at timestamptz,
    last_sign_in_at    timestamptz
  );
  create table auth.sessions (
    id      uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (
    id              text primary key,
    name            text not null,
    public          boolean,
    file_size_limit bigint
  );
`

// Identifiants fixes des données de départ.
export const ORG_A = 'a0000000-0000-4000-8000-000000000001'
export const ORG_B = 'b0000000-0000-4000-8000-000000000001'

export interface Person {
  user: string
  member: string
  email: string
}

export const person = (n: number, org: 'a' | 'b', email: string): Person => ({
  user: `${org}0000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`,
  member: `${org}0000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
  email,
})

export const ADMIN_A1 = person(1, 'a', 'admin1@a.test')
export const ADMIN_A2 = person(2, 'a', 'admin2@a.test')
export const MEMBRE_A = person(3, 'a', 'membre@a.test')
export const PROSP_A = person(4, 'a', 'prosp@a.test')
export const WORKER_A = person(5, 'a', 'worker@a.test')
export const ADMIN_B = person(1, 'b', 'admin@b.test')
/** Invité de l'organisation A qui ne s'est jamais connecté (user_id null). */
export const INVITED_A = { member: 'a0000000-0000-4000-8000-000000000299', email: 'invite@a.test' }
export const INVITED_A_USER = 'a0000000-0000-4000-8000-000000000199'

export const CLIENT_A_FULL = 'a0000000-0000-4000-8000-000000000301' // contact_name + contact_email
export const CLIENT_A_EMAIL = 'a0000000-0000-4000-8000-000000000302' // contact_email seul
export const CLIENT_A_NONE = 'a0000000-0000-4000-8000-000000000303' // aucun contact
export const CLIENT_B = 'b0000000-0000-4000-8000-000000000301'
export const PROJECT_A_ACTIVE = 'a0000000-0000-4000-8000-000000000401'
export const PROJECT_A_ODD = 'a0000000-0000-4000-8000-000000000402'
export const PROJECT_B = 'b0000000-0000-4000-8000-000000000401'
export const TASK_DONE = 'a0000000-0000-4000-8000-000000000501'
export const TASK_TODO = 'a0000000-0000-4000-8000-000000000502'
export const TASK_REVIEW = 'a0000000-0000-4000-8000-000000000503'
export const TASK_OTHER = 'a0000000-0000-4000-8000-000000000504'

const FIXTURES = `
  insert into public.organizations (id, name) values
    ('${ORG_A}', 'Sordulo'), ('${ORG_B}', 'Autre agence');

  insert into auth.users (id, email, email_confirmed_at) values
    ${[ADMIN_A1, ADMIN_A2, MEMBRE_A, PROSP_A, WORKER_A, ADMIN_B].map((p) => `('${p.user}', '${p.email}', now())`).join(',\n    ')};

  insert into public.members (id, organization_id, user_id, name, email, role, skills) values
    ('${ADMIN_A1.member}', '${ORG_A}', '${ADMIN_A1.user}', 'Admin A1', '${ADMIN_A1.email}', 'admin', '{"dev": 5}'),
    ('${ADMIN_A2.member}', '${ORG_A}', '${ADMIN_A2.user}', 'Admin A2', '${ADMIN_A2.email}', 'admin', '{"design": 5}'),
    ('${MEMBRE_A.member}', '${ORG_A}', '${MEMBRE_A.user}', 'Membre A', '${MEMBRE_A.email}', 'membre', '{}'),
    ('${PROSP_A.member}', '${ORG_A}', '${PROSP_A.user}', 'Prosp A', '${PROSP_A.email}', 'prospection', '{}'),
    ('${WORKER_A.member}', '${ORG_A}', '${WORKER_A.user}', 'Worker A', '${WORKER_A.email}', 'membre', '{"dev": 3}'),
    ('${INVITED_A.member}', '${ORG_A}', null, 'Invité A', '${INVITED_A.email}', 'membre', '{}'),
    ('${ADMIN_B.member}', '${ORG_B}', '${ADMIN_B.user}', 'Admin B', '${ADMIN_B.email}', 'admin', '{}');

  insert into public.clients (id, organization_id, name, contact_name, contact_email) values
    ('${CLIENT_A_FULL}', '${ORG_A}', 'Ibé', '  Camille  ', 'camille@ibe.test'),
    ('${CLIENT_A_EMAIL}', '${ORG_A}', 'Client email', '', 'contact@client.test'),
    ('${CLIENT_A_NONE}', '${ORG_A}', 'Client sans contact', null, null),
    ('${CLIENT_B}', '${ORG_B}', 'Client B', 'Bob', null);

  insert into public.projects (id, organization_id, client_id, name, status) values
    ('${PROJECT_A_ACTIVE}', '${ORG_A}', '${CLIENT_A_FULL}', 'App Ibé', 'active'),
    ('${PROJECT_A_ODD}', '${ORG_A}', null, 'Projet ancien', 'en pause'),
    ('${PROJECT_B}', '${ORG_B}', '${CLIENT_B}', 'Projet B', 'active');

  insert into public.tasks (id, project_id, title, skill, assignee_member_id, status) values
    ('${TASK_DONE}', '${PROJECT_A_ACTIVE}', 'Faite', 'dev', '${WORKER_A.member}', 'done'),
    ('${TASK_TODO}', '${PROJECT_A_ACTIVE}', 'À faire', 'dev', '${WORKER_A.member}', 'todo'),
    ('${TASK_REVIEW}', '${PROJECT_A_ACTIVE}', 'En relecture', 'dev', '${WORKER_A.member}', 'review'),
    ('${TASK_OTHER}', '${PROJECT_A_ACTIVE}', 'Autre', 'design', '${MEMBRE_A.member}', 'todo');

  insert into auth.sessions (user_id) values ('${WORKER_A.user}'), ('${WORKER_A.user}'), ('${MEMBRE_A.user}');
`

export type Who = Person | 'anon' | 'service_role' | 'postgres'

let db: PGlite

/**
 * Monte la base pour le fichier de test : migrations, données de départ, puis `extraSql`
 * (données propres au fichier, appliquées après toutes les migrations). Chaque test tourne
 * dans une transaction annulée.
 */
export function setupDatabase(extraSql = '') {
  beforeAll(async () => {
    db = await PGlite.create()
    await db.exec(SUPABASE_STUBS)
    await db.exec(migration('0001_init.sql'))
    await db.exec(migration('0002_ticket_area.sql'))
    await db.exec(FIXTURES)
    await db.exec(migration('0003_clients_projects_team.sql'))
    await db.exec(migration('0003_clients_projects_team.sql')) // rejouable
    await db.exec(migration('0004_finance_prospection.sql'))
    await db.exec(migration('0004_finance_prospection.sql')) // rejouable
    await db.exec(migration('0005_billing_issuers.sql'))
    await db.exec(migration('0005_billing_issuers.sql')) // rejouable
    await db.exec(migration('0007_project_ai_instructions.sql'))
    await db.exec(migration('0007_project_ai_instructions.sql')) // rejouable
    await db.exec(migration('0008_vercel_connections.sql'))
    await db.exec(migration('0008_vercel_connections.sql')) // rejouable
    if (extraSql) await db.exec(extraSql)
  })

  afterAll(async () => {
    await db?.close()
  })

  beforeEach(async () => {
    await db.exec('begin')
  })

  afterEach(async () => {
    await db.exec('rollback')
  })
}

/**
 * Exécute une requête sous l'identité donnée, dans un savepoint : une erreur attendue
 * n'interrompt pas la transaction du test. Fait comme PostgREST : request.jwt.claims puis set role.
 */
export async function q<T = Record<string, unknown>>(who: Who, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('savepoint q')
  try {
    if (who !== 'postgres') {
      const role = typeof who === 'string' ? who : 'authenticated'
      const claims = typeof who === 'string' ? { role } : { sub: who.user, email: who.email, role }
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
      await db.exec(`set role ${role}`)
    }
    const result = await db.query<T>(sql, params)
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', true)`)
    await db.exec('release savepoint q')
    return result.rows
  } catch (error) {
    await db.exec('rollback to savepoint q')
    throw error
  }
}

/** Attend une erreur Postgres de ce code (42501 droits / RLS, 23514 check, 23505 unicité, P0001 règle métier). */
export async function expectCode(promise: Promise<unknown>, code: string, message?: RegExp) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught as { code?: string; message?: string },
  )
  expect(error, `erreur ${code} attendue`).not.toBeNull()
  expect(error?.code).toBe(code)
  if (message) expect(error?.message).toMatch(message)
}

export const count = async (who: Who, table: string) =>
  Number((await q<{ n: number }>(who, `select count(*)::int as n from ${table}`))[0]?.n)
