// Seeds the starting data. Idempotent: fixed UUIDs + "on conflict do update".
// Emails come from SEED_MAEL_EMAIL and SEED_SACHA_EMAIL (never committed).
// Usage: npm run db:seed (after npm run db:migrate)
import { connect, fail, loadEnv, requireEnv } from './lib/db.mjs'

const SEED_IDS = {
  organization: '5e0d0000-0000-4000-8000-000000000001',
  memberMael: '5e0d0000-0000-4000-8000-000000000101',
  memberSacha: '5e0d0000-0000-4000-8000-000000000102',
  clientIbe: '5e0d0000-0000-4000-8000-000000000201',
  projectAppIbe: '5e0d0000-0000-4000-8000-000000000301',
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function readEmail(name) {
  const email = requireEnv(name, 'Email de connexion (lien magique) du membre, à mettre dans .env.local.')
  if (!EMAIL_PATTERN.test(email)) fail(`${name} n’est pas un email valide.`)
  return email
}

async function main() {
  loadEnv()
  const maelEmail = readEmail('SEED_MAEL_EMAIL')
  const sachaEmail = readEmail('SEED_SACHA_EMAIL')
  if (maelEmail.toLowerCase() === sachaEmail.toLowerCase()) {
    fail('SEED_MAEL_EMAIL et SEED_SACHA_EMAIL doivent être différents.')
  }

  const members = [
    { id: SEED_IDS.memberMael, name: 'Maël', email: maelEmail, skills: { dev: 5, design: 2 } },
    { id: SEED_IDS.memberSacha, name: 'Sacha', email: sachaEmail, skills: { design: 5, dev: 1 } },
  ]

  const client = await connect()
  try {
    await client.query('begin')

    await client.query(
      `insert into public.organizations (id, name) values ($1, 'Sordulo')
       on conflict (id) do update set name = excluded.name`,
      [SEED_IDS.organization],
    )

    for (const member of members) {
      await client.query(
        `insert into public.members (id, organization_id, name, email, role, skills, weekly_capacity_hours)
         values ($1, $2, $3, $4, 'admin', $5::jsonb, 35)
         on conflict (id) do update set
           organization_id = excluded.organization_id,
           name = excluded.name,
           email = excluded.email,
           role = excluded.role,
           skills = excluded.skills,
           weekly_capacity_hours = excluded.weekly_capacity_hours`,
        [member.id, SEED_IDS.organization, member.name, member.email, JSON.stringify(member.skills)],
      )
    }

    await client.query(
      `insert into public.clients (id, organization_id, name) values ($1, $2, 'Ibé')
       on conflict (id) do update set name = excluded.name`,
      [SEED_IDS.clientIbe, SEED_IDS.organization],
    )

    await client.query(
      `insert into public.projects (id, organization_id, client_id, name, status)
       values ($1, $2, $3, 'App Ibé', 'active')
       on conflict (id) do update set
         client_id = excluded.client_id,
         name = excluded.name,
         status = excluded.status`,
      [SEED_IDS.projectAppIbe, SEED_IDS.organization, SEED_IDS.clientIbe],
    )

    // Auth accounts created before the seed: link them now (the auth.users trigger
    // only fires for accounts created after the seed).
    await client.query(
      `update public.members m
       set user_id = u.id
       from auth.users u
       where m.id = any($1::uuid[])
         and m.user_id is null
         and lower(u.email) = lower(m.email)`,
      [members.map((member) => member.id)],
    )

    const { rows } = await client.query(
      `select name, user_id is not null as linked from public.members where id = any($1::uuid[]) order by name`,
      [members.map((member) => member.id)],
    )

    await client.query('commit')

    console.log('✔ Organisation « Sordulo », client « Ibé », projet « App Ibé »')
    for (const row of rows) {
      console.log(
        `✔ Membre ${row.name} : ${row.linked ? 'lié à son compte' : 'pas encore de compte (liaison à la première connexion)'}`,
      )
    }
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => fail(`Seed échoué, transaction annulée. ${error.message}`))
