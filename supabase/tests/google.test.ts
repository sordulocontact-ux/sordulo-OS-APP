/**
 * Tests de la migration 0024 (connexions Google) : chaque compte ne lit, n'écrit et ne supprime que ses
 * lignes google_connections (une par service : calendar, gmail), jeton de rafraîchissement et curseur Gmail.
 * Lancer : npm run test:rls
 */
import { describe, expect, it } from 'vitest'
import { ADMIN_A1, ADMIN_A2, ADMIN_B, MEMBRE_A, count, expectCode, q, setupDatabase, type Person } from './harness'

setupDatabase()

type Service = 'calendar' | 'gmail'

const insert = (who: Person, service: Service = 'calendar', refresh: string | null = 'rt_1', account: string | null = 'sacha@sordulo.fr') =>
  q(
    who,
    `insert into public.google_connections (user_id, service, refresh_token, account) values ($1, $2, $3, $4)`,
    [who.user, service, refresh, account],
  )

interface Row {
  service: Service
  refresh_token: string | null
  account: string | null
  cursor_at: string | null
}

const rowOf = async (userId: string, service: Service = 'calendar') =>
  (
    await q<Row>(
      'postgres',
      `select service, refresh_token, account, cursor_at::text from public.google_connections where user_id = $1 and service = $2`,
      [userId, service],
    )
  )[0]

const upsert = (who: Person, service: Service, refresh: string, account: string) =>
  q(
    who,
    `insert into public.google_connections (user_id, service, refresh_token, account) values ($1, $2, $3, $4)
     on conflict (user_id, service) do update set refresh_token = excluded.refresh_token, account = excluded.account`,
    [who.user, service, refresh, account],
  )

describe('google_connections : ses propres lignes', () => {
  it('insère, lit, modifie et supprime sa ligne', async () => {
    await insert(ADMIN_A1)
    expect(await q<Row>(ADMIN_A1, `select service, refresh_token, account, cursor_at from public.google_connections`)).toEqual([
      { service: 'calendar', refresh_token: 'rt_1', account: 'sacha@sordulo.fr', cursor_at: null },
    ])
    await q(ADMIN_A1, `update public.google_connections set refresh_token = 'rt_2' where service = 'calendar'`)
    expect((await rowOf(ADMIN_A1.user))?.refresh_token).toBe('rt_2')
    await q(ADMIN_A1, `delete from public.google_connections where service = 'calendar'`)
    expect(await count('postgres', 'public.google_connections')).toBe(0)
  })

  it('user_id par défaut : auth.uid() ; ligne sans jeton ni compte acceptée', async () => {
    await q(MEMBRE_A, `insert into public.google_connections (service) values ('gmail')`)
    expect(await rowOf(MEMBRE_A.user, 'gmail')).toEqual({ service: 'gmail', refresh_token: null, account: null, cursor_at: null })
  })

  it('une ligne par service : Agenda et Gmail sur le même compte', async () => {
    await insert(ADMIN_A1, 'calendar', 'rt_cal')
    await insert(ADMIN_A1, 'gmail', 'rt_mail')
    expect(await q<{ service: string }>(ADMIN_A1, `select service from public.google_connections order by service`)).toEqual([
      { service: 'calendar' },
      { service: 'gmail' },
    ])
    // Déconnecter un service laisse l'autre.
    await q(ADMIN_A1, `delete from public.google_connections where service = 'gmail'`)
    expect((await rowOf(ADMIN_A1.user, 'calendar'))?.refresh_token).toBe('rt_cal')
  })

  it('une seule ligne par compte et par service ; upsert sur (user_id, service)', async () => {
    await insert(ADMIN_A1, 'gmail')
    await expectCode(insert(ADMIN_A1, 'gmail', 'autre'), '23505')
    await upsert(ADMIN_A1, 'gmail', 'rt_neuf', 'mael@sordulo.fr')
    expect(await rowOf(ADMIN_A1.user, 'gmail')).toMatchObject({ refresh_token: 'rt_neuf', account: 'mael@sordulo.fr' })
    await upsert(ADMIN_A1, 'calendar', 'rt_cal', 'mael@sordulo.fr')
    expect(await count(ADMIN_A1, 'public.google_connections')).toBe(2)
  })

  it('accès perdu : jeton à null, compte gardé (« À reconnecter »)', async () => {
    await insert(ADMIN_A1, 'gmail')
    await q(ADMIN_A1, `update public.google_connections set refresh_token = null where service = 'gmail'`)
    expect(await rowOf(ADMIN_A1.user, 'gmail')).toMatchObject({ refresh_token: null, account: 'sacha@sordulo.fr' })
  })

  it('curseur Gmail enregistré et modifiable', async () => {
    await insert(ADMIN_A1, 'gmail')
    await q(ADMIN_A1, `update public.google_connections set cursor_at = '2026-11-25T08:00:00Z' where service = 'gmail'`)
    const [row] = await q<{ ok: boolean }>(
      'postgres',
      `select cursor_at = '2026-11-25T08:00:00Z'::timestamptz as ok from public.google_connections where service = 'gmail'`,
    )
    expect(row?.ok).toBe(true)
  })

  it('met à jour updated_at', async () => {
    await insert(ADMIN_A1)
    await q('postgres', `update public.google_connections set updated_at = now() - interval '1 day'`)
    await q(ADMIN_A1, `update public.google_connections set account = 'autre@sordulo.fr'`)
    const [row] = await q<{ fresh: boolean }>('postgres', `select updated_at > now() - interval '1 hour' as fresh from public.google_connections`)
    expect(row?.fresh).toBe(true)
  })

  it('refuse un service inconnu ou absent', async () => {
    await expectCode(q(ADMIN_A1, `insert into public.google_connections (service) values ('drive')`), '23514')
    await expectCode(q(ADMIN_A1, `insert into public.google_connections (service) values ('Gmail')`), '23514')
    await expectCode(q(ADMIN_A1, `insert into public.google_connections (refresh_token) values ('rt')`), '23502')
  })

  it('refuse un jeton blanc ou trop long, accepte null', async () => {
    await expectCode(insert(ADMIN_A1, 'calendar', ''), '23514')
    await expectCode(insert(ADMIN_A1, 'calendar', '   '), '23514')
    await expectCode(insert(ADMIN_A1, 'calendar', 'x'.repeat(2049)), '23514')
    await insert(ADMIN_A1, 'calendar', 'x'.repeat(2048))
    await insert(ADMIN_A1, 'gmail', null)
    expect((await rowOf(ADMIN_A1.user, 'gmail'))?.refresh_token).toBeNull()
  })

  it('refuse une adresse de compte trop longue', async () => {
    await expectCode(insert(ADMIN_A1, 'calendar', 'rt', 'x'.repeat(321)), '23514')
    await insert(ADMIN_A1, 'calendar', 'rt', 'x'.repeat(320))
  })
})

describe('google_connections : isolation entre comptes', () => {
  async function two() {
    await insert(ADMIN_A1, 'calendar', 'rt_a1')
    await insert(ADMIN_A1, 'gmail', 'rt_a1_mail')
    await insert(ADMIN_B, 'gmail', 'rt_b', 'bob@b.test')
  }

  it('ne lit pas les lignes d’un autre (même organisation ou non, admin compris)', async () => {
    await two()
    for (const who of [ADMIN_A2, MEMBRE_A]) expect(await count(who, 'public.google_connections')).toBe(0)
    expect(await count(ADMIN_A1, 'public.google_connections')).toBe(2)
    expect(await q(ADMIN_B, `select refresh_token from public.google_connections`)).toEqual([{ refresh_token: 'rt_b' }])
    expect(await q(ADMIN_B, `select refresh_token from public.google_connections where user_id = $1`, [ADMIN_A1.user])).toEqual([])
  })

  it('ne modifie pas les lignes d’un autre', async () => {
    await two()
    await q(ADMIN_A2, `update public.google_connections set refresh_token = 'vol' where user_id = $1`, [ADMIN_A1.user])
    await q(ADMIN_B, `update public.google_connections set refresh_token = 'vol', cursor_at = now()`)
    expect(await rowOf(ADMIN_A1.user, 'calendar')).toMatchObject({ refresh_token: 'rt_a1', cursor_at: null })
    expect((await rowOf(ADMIN_A1.user, 'gmail'))?.refresh_token).toBe('rt_a1_mail')
  })

  it('ne peut pas changer son user_id vers celui d’un autre', async () => {
    await insert(ADMIN_A1)
    await expectCode(q(ADMIN_A1, `update public.google_connections set user_id = $1`, [ADMIN_A2.user]), '42501')
  })

  it('ne supprime pas les lignes d’un autre', async () => {
    await two()
    await q(ADMIN_A2, `delete from public.google_connections where user_id = $1`, [ADMIN_A1.user])
    await q(ADMIN_B, `delete from public.google_connections`)
    expect(await count('postgres', 'public.google_connections')).toBe(2)
    expect(await rowOf(ADMIN_B.user, 'gmail')).toBeUndefined()
  })

  it('ne peut pas insérer une ligne avec le user_id d’un autre', async () => {
    await expectCode(
      q(ADMIN_A2, `insert into public.google_connections (user_id, service, refresh_token) values ($1, 'gmail', 'rt')`, [ADMIN_A1.user]),
      '42501',
    )
    expect(await count('postgres', 'public.google_connections')).toBe(0)
  })

  it('l’upsert d’un autre compte ne touche pas la ligne existante', async () => {
    await insert(ADMIN_A1, 'gmail', 'rt_a1')
    await upsert(ADMIN_A2, 'gmail', 'rt_a2', 'admin2@a.test')
    expect((await rowOf(ADMIN_A1.user, 'gmail'))?.refresh_token).toBe('rt_a1')
    expect((await rowOf(ADMIN_A2.user, 'gmail'))?.refresh_token).toBe('rt_a2')
  })

  it('le service_role garde l’accès', async () => {
    await two()
    expect(await count('service_role', 'public.google_connections')).toBe(3)
  })
})

describe('google_connections : anon', () => {
  it('ne voit rien et ne peut rien écrire', async () => {
    await insert(ADMIN_A1)
    await expectCode(q('anon', `select * from public.google_connections`), '42501')
    await expectCode(
      q('anon', `insert into public.google_connections (user_id, service) values ($1, 'gmail')`, [ADMIN_A2.user]),
      '42501',
    )
    await expectCode(q('anon', `update public.google_connections set refresh_token = null`), '42501')
    await expectCode(q('anon', `delete from public.google_connections`), '42501')
  })
})

describe('migration 0024 : google_connections', () => {
  it('supprimer le compte supprime ses lignes (cascade)', async () => {
    await insert(ADMIN_A1, 'calendar')
    await insert(ADMIN_A1, 'gmail')
    await insert(ADMIN_B, 'gmail')
    await q('postgres', `delete from auth.users where id = $1`, [ADMIN_A1.user])
    expect(await count('postgres', 'public.google_connections')).toBe(1)
  })
})
