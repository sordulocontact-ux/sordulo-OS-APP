/**
 * Tests de la migration 0009 : chaque compte ne lit, n'écrit et ne supprime que sa ligne
 * spotify_connections (Client ID + jeton de rafraîchissement Spotify), Client ID changé = jeton oublié,
 * remplacement conditionnel du jeton (spotify_replace_refresh_token).
 * Lancer : npm run test:rls
 */
import { describe, expect, it } from 'vitest'
import { ADMIN_A1, ADMIN_A2, ADMIN_B, MEMBRE_A, count, expectCode, q, setupDatabase, type Who } from './harness'

setupDatabase()

const CLIENT = '0123456789abcdef0123456789abcdef'

const insert = (who: typeof ADMIN_A1, refresh: string | null = 'rt_1', clientId = CLIENT, account: string | null = 'sacha') =>
  q(
    who,
    `insert into public.spotify_connections (user_id, client_id, refresh_token, account, premium) values ($1, $2, $3, $4, true)`,
    [who.user, clientId, refresh, account],
  )

interface Row {
  client_id: string
  refresh_token: string | null
  account: string | null
  premium: boolean
}

const rowOf = async (userId: string) =>
  (
    await q<Row>(
      'postgres',
      `select client_id, refresh_token, account, premium from public.spotify_connections where user_id = $1`,
      [userId],
    )
  )[0]

const replace = (who: Who, previous: string, next: string | null) =>
  q<{ changed: boolean }>(who, `select public.spotify_replace_refresh_token($1, $2) as changed`, [previous, next]).then(
    (rows) => rows[0]?.changed,
  )

describe('spotify_connections : sa propre ligne', () => {
  it('insère, lit, modifie et supprime sa ligne', async () => {
    await insert(ADMIN_A1)
    expect(await q<Row>(ADMIN_A1, `select client_id, refresh_token, account, premium from public.spotify_connections`)).toEqual([
      { client_id: CLIENT, refresh_token: 'rt_1', account: 'sacha', premium: true },
    ])
    await q(ADMIN_A1, `update public.spotify_connections set refresh_token = 'rt_2' where user_id = $1`, [ADMIN_A1.user])
    expect((await rowOf(ADMIN_A1.user))?.refresh_token).toBe('rt_2')
    await q(ADMIN_A1, `delete from public.spotify_connections where user_id = $1`, [ADMIN_A1.user])
    expect(await count('postgres', 'public.spotify_connections')).toBe(0)
  })

  it('user_id par défaut : auth.uid() ; Client ID seul, sans jeton ni compte', async () => {
    await q(MEMBRE_A, `insert into public.spotify_connections (client_id) values ($1)`, [CLIENT])
    expect(await rowOf(MEMBRE_A.user)).toEqual({ client_id: CLIENT, refresh_token: null, account: null, premium: false })
  })

  it('une seule ligne par compte ; upsert sur user_id', async () => {
    await insert(ADMIN_A1)
    await expectCode(insert(ADMIN_A1, 'autre'), '23505')
    await q(
      ADMIN_A1,
      `insert into public.spotify_connections (user_id, client_id) values ($1, $2)
       on conflict (user_id) do update set client_id = excluded.client_id`,
      [ADMIN_A1.user, CLIENT],
    )
    // Même Client ID : le jeton reste.
    expect((await rowOf(ADMIN_A1.user))?.refresh_token).toBe('rt_1')
  })

  it('met à jour updated_at', async () => {
    await insert(ADMIN_A1)
    await q('postgres', `update public.spotify_connections set updated_at = now() - interval '1 day'`)
    await q(ADMIN_A1, `update public.spotify_connections set premium = false`)
    const [row] = await q<{ fresh: boolean }>('postgres', `select updated_at > now() - interval '1 hour' as fresh from public.spotify_connections`)
    expect(row?.fresh).toBe(true)
  })

  it('refuse un Client ID vide, trop long ou avec d’autres caractères', async () => {
    for (const bad of ['', ' ', 'a'.repeat(65), 'abc def', 'abc&scope=x', 'é'.repeat(4)]) {
      await expectCode(insert(ADMIN_A1, 'rt', bad), '23514')
    }
    await insert(ADMIN_A1, 'rt', 'a'.repeat(64))
  })

  it('refuse un jeton blanc ou trop long, accepte null', async () => {
    await expectCode(insert(ADMIN_A1, ''), '23514')
    await expectCode(insert(ADMIN_A1, '   '), '23514')
    await expectCode(insert(ADMIN_A1, 'x'.repeat(2049)), '23514')
    await insert(ADMIN_A1, 'x'.repeat(2048))
    await q(ADMIN_A1, `update public.spotify_connections set refresh_token = null`)
    expect((await rowOf(ADMIN_A1.user))?.refresh_token).toBeNull()
  })

  it('refuse un nom de compte trop long', async () => {
    await expectCode(insert(ADMIN_A1, 'rt', CLIENT, 'x'.repeat(201)), '23514')
  })
})

describe('spotify_connections : Client ID changé', () => {
  it('sans nouveau jeton : jeton, compte et Premium oubliés', async () => {
    await insert(ADMIN_A1)
    await q(ADMIN_A1, `update public.spotify_connections set client_id = 'autre'`)
    expect(await rowOf(ADMIN_A1.user)).toEqual({ client_id: 'autre', refresh_token: null, account: null, premium: false })
  })

  it('par upsert (Client ID seul) : jeton oublié aussi', async () => {
    await insert(ADMIN_A1)
    await q(
      ADMIN_A1,
      `insert into public.spotify_connections (user_id, client_id) values ($1, 'autre')
       on conflict (user_id) do update set client_id = excluded.client_id`,
      [ADMIN_A1.user],
    )
    expect((await rowOf(ADMIN_A1.user))?.refresh_token).toBeNull()
  })

  it('avec le jeton obtenu pour le nouveau Client ID : gardé', async () => {
    await insert(ADMIN_A1)
    await q(ADMIN_A1, `update public.spotify_connections set client_id = 'autre', refresh_token = 'rt_neuf', account = 'mael'`)
    expect(await rowOf(ADMIN_A1.user)).toEqual({ client_id: 'autre', refresh_token: 'rt_neuf', account: 'mael', premium: true })
  })
})

describe('spotify_replace_refresh_token', () => {
  it('remplace le jeton s’il vaut encore l’ancien', async () => {
    await insert(ADMIN_A1)
    expect(await replace(ADMIN_A1, 'rt_1', 'rt_2')).toBe(true)
    expect((await rowOf(ADMIN_A1.user))?.refresh_token).toBe('rt_2')
  })

  it('ne touche à rien si le jeton a déjà changé (autre ordinateur)', async () => {
    await insert(ADMIN_A1, 'rt_autre_ordi')
    expect(await replace(ADMIN_A1, 'rt_1', 'rt_2')).toBe(false)
    expect((await rowOf(ADMIN_A1.user))?.refresh_token).toBe('rt_autre_ordi')
  })

  it('accès perdu : jeton à null, compte gardé (« À reconnecter »)', async () => {
    await insert(ADMIN_A1)
    expect(await replace(ADMIN_A1, 'rt_1', null)).toBe(true)
    expect(await rowOf(ADMIN_A1.user)).toMatchObject({ refresh_token: null, account: 'sacha' })
  })

  it('sans ligne : faux', async () => {
    expect(await replace(ADMIN_A1, 'rt_1', 'rt_2')).toBe(false)
  })

  it('ne touche jamais la ligne d’un autre compte, même avec son jeton', async () => {
    await insert(ADMIN_A1, 'rt_a1')
    expect(await replace(ADMIN_A2, 'rt_a1', 'vol')).toBe(false)
    expect(await replace(ADMIN_B, 'rt_a1', null)).toBe(false)
    expect((await rowOf(ADMIN_A1.user))?.refresh_token).toBe('rt_a1')
  })

  it('refuse un nouveau jeton blanc (contrôle de la table)', async () => {
    await insert(ADMIN_A1)
    await expectCode(replace(ADMIN_A1, 'rt_1', ' '), '23514')
  })

  it('anon ne peut pas l’appeler', async () => {
    await insert(ADMIN_A1)
    await expectCode(replace('anon', 'rt_1', 'x'), '42501')
    expect((await rowOf(ADMIN_A1.user))?.refresh_token).toBe('rt_1')
  })
})

describe('spotify_connections : isolation entre comptes', () => {
  async function two() {
    await insert(ADMIN_A1, 'rt_a1')
    await insert(ADMIN_B, 'rt_b', CLIENT, 'bob')
  }

  it('ne lit pas la ligne d’un autre (même organisation ou non, admin compris)', async () => {
    await two()
    for (const who of [ADMIN_A2, MEMBRE_A]) expect(await count(who, 'public.spotify_connections')).toBe(0)
    expect(await q(ADMIN_A1, `select refresh_token from public.spotify_connections`)).toEqual([{ refresh_token: 'rt_a1' }])
    expect(await q(ADMIN_B, `select refresh_token from public.spotify_connections where user_id = $1`, [ADMIN_A1.user])).toEqual([])
  })

  it('ne modifie pas la ligne d’un autre', async () => {
    await two()
    await q(ADMIN_A2, `update public.spotify_connections set refresh_token = 'vol' where user_id = $1`, [ADMIN_A1.user])
    await q(ADMIN_B, `update public.spotify_connections set refresh_token = 'vol'`)
    expect((await rowOf(ADMIN_A1.user))?.refresh_token).toBe('rt_a1')
  })

  it('ne peut pas changer son user_id vers celui d’un autre', async () => {
    await insert(ADMIN_A1)
    await expectCode(q(ADMIN_A1, `update public.spotify_connections set user_id = $1`, [ADMIN_A2.user]), '42501')
  })

  it('ne supprime pas la ligne d’un autre', async () => {
    await two()
    await q(ADMIN_A2, `delete from public.spotify_connections where user_id = $1`, [ADMIN_A1.user])
    await q(ADMIN_B, `delete from public.spotify_connections`)
    expect((await rowOf(ADMIN_A1.user))?.refresh_token).toBe('rt_a1')
    expect(await rowOf(ADMIN_B.user)).toBeUndefined()
  })

  it('ne peut pas insérer une ligne avec le user_id d’un autre', async () => {
    await expectCode(
      q(ADMIN_A2, `insert into public.spotify_connections (user_id, client_id) values ($1, $2)`, [ADMIN_A1.user, CLIENT]),
      '42501',
    )
    expect(await count('postgres', 'public.spotify_connections')).toBe(0)
  })

  it('le service_role garde l’accès', async () => {
    await two()
    expect(await count('service_role', 'public.spotify_connections')).toBe(2)
  })
})

describe('spotify_connections : anon', () => {
  it('ne voit rien et ne peut rien écrire', async () => {
    await insert(ADMIN_A1)
    await expectCode(q('anon', `select * from public.spotify_connections`), '42501')
    await expectCode(
      q('anon', `insert into public.spotify_connections (user_id, client_id) values ($1, $2)`, [ADMIN_A2.user, CLIENT]),
      '42501',
    )
    await expectCode(q('anon', `delete from public.spotify_connections`), '42501')
  })
})

describe('migration 0009', () => {
  it('supprimer le compte supprime la ligne (cascade)', async () => {
    await insert(ADMIN_A1)
    await q('postgres', `delete from auth.users where id = $1`, [ADMIN_A1.user])
    expect(await count('postgres', 'public.spotify_connections')).toBe(0)
  })
})
