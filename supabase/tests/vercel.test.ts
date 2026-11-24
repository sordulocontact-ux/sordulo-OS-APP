/**
 * Tests de la migration 0008 : chaque compte ne lit, n'écrit et ne supprime que sa ligne
 * vercel_connections (jeton Vercel).
 * Lancer : npm run test:rls
 */
import { describe, expect, it } from 'vitest'
import { ADMIN_A1, ADMIN_A2, ADMIN_B, MEMBRE_A, count, expectCode, q, setupDatabase } from './harness'

setupDatabase()

const insert = (who: typeof ADMIN_A1, token = 'vcp_token', account: string | null = 'sacha') =>
  q(who, `insert into public.vercel_connections (user_id, token, account) values ($1, $2, $3)`, [who.user, token, account])

const tokenOf = async (userId: string) =>
  (await q<{ token: string }>('postgres', `select token from public.vercel_connections where user_id = $1`, [userId]))[0]?.token

describe('vercel_connections : son propre jeton', () => {
  it('insère, lit, modifie et supprime sa ligne', async () => {
    await insert(ADMIN_A1)
    expect(await q<{ token: string; account: string }>(ADMIN_A1, `select token, account from public.vercel_connections`)).toEqual([
      { token: 'vcp_token', account: 'sacha' },
    ])
    await q(ADMIN_A1, `update public.vercel_connections set token = 'vcp_new' where user_id = $1`, [ADMIN_A1.user])
    expect(await tokenOf(ADMIN_A1.user)).toBe('vcp_new')
    await q(ADMIN_A1, `delete from public.vercel_connections where user_id = $1`, [ADMIN_A1.user])
    expect(await count('postgres', 'public.vercel_connections')).toBe(0)
  })

  it('user_id par défaut : auth.uid()', async () => {
    await q(MEMBRE_A, `insert into public.vercel_connections (token) values ('vcp_x')`)
    expect(await tokenOf(MEMBRE_A.user)).toBe('vcp_x')
  })

  it('une seule ligne par compte', async () => {
    await insert(ADMIN_A1)
    await expectCode(insert(ADMIN_A1, 'autre'), '23505')
  })

  it('met à jour updated_at', async () => {
    await insert(ADMIN_A1)
    await q('postgres', `update public.vercel_connections set updated_at = now() - interval '1 day'`)
    await q(ADMIN_A1, `update public.vercel_connections set account = 'nouveau'`)
    const [row] = await q<{ fresh: boolean }>('postgres', `select updated_at > now() - interval '1 hour' as fresh from public.vercel_connections`)
    expect(row?.fresh).toBe(true)
  })

  it('refuse un jeton vide, blanc ou trop long', async () => {
    await expectCode(insert(ADMIN_A1, ''), '23514')
    await expectCode(insert(ADMIN_A1, '   '), '23514')
    await expectCode(insert(ADMIN_A1, 'x'.repeat(513)), '23514')
    await insert(ADMIN_A1, 'x'.repeat(512))
    await expectCode(q(ADMIN_A1, `update public.vercel_connections set token = ' '`), '23514')
  })
})

describe('vercel_connections : isolation entre comptes', () => {
  async function two() {
    await insert(ADMIN_A1, 'vcp_a1')
    await insert(ADMIN_B, 'vcp_b', 'bob')
  }

  it('ne lit pas la ligne d’un autre (même organisation ou non, admin compris)', async () => {
    await two()
    for (const who of [ADMIN_A2, MEMBRE_A]) expect(await count(who, 'public.vercel_connections')).toBe(0)
    expect(await q(ADMIN_A1, `select token from public.vercel_connections`)).toEqual([{ token: 'vcp_a1' }])
    expect(await q(ADMIN_B, `select token from public.vercel_connections where user_id = $1`, [ADMIN_A1.user])).toEqual([])
  })

  it('ne modifie pas la ligne d’un autre', async () => {
    await two()
    await q(ADMIN_A2, `update public.vercel_connections set token = 'vol' where user_id = $1`, [ADMIN_A1.user])
    await q(ADMIN_B, `update public.vercel_connections set token = 'vol'`)
    expect(await tokenOf(ADMIN_A1.user)).toBe('vcp_a1')
  })

  it('ne peut pas changer son user_id vers celui d’un autre', async () => {
    await insert(ADMIN_A1)
    await expectCode(q(ADMIN_A1, `update public.vercel_connections set user_id = $1`, [ADMIN_A2.user]), '42501')
  })

  it('ne supprime pas la ligne d’un autre', async () => {
    await two()
    await q(ADMIN_A2, `delete from public.vercel_connections where user_id = $1`, [ADMIN_A1.user])
    await q(ADMIN_B, `delete from public.vercel_connections`)
    expect(await tokenOf(ADMIN_A1.user)).toBe('vcp_a1')
    expect(await tokenOf(ADMIN_B.user)).toBeUndefined()
  })

  it('ne peut pas insérer une ligne avec le user_id d’un autre', async () => {
    await expectCode(
      q(ADMIN_A2, `insert into public.vercel_connections (user_id, token) values ($1, 'vcp_x')`, [ADMIN_A1.user]),
      '42501',
    )
    expect(await count('postgres', 'public.vercel_connections')).toBe(0)
  })

  it('le service_role garde l’accès', async () => {
    await two()
    expect(await count('service_role', 'public.vercel_connections')).toBe(2)
  })
})

describe('vercel_connections : anon', () => {
  it('ne voit rien et ne peut rien écrire', async () => {
    await insert(ADMIN_A1)
    await expectCode(q('anon', `select * from public.vercel_connections`), '42501')
    await expectCode(q('anon', `insert into public.vercel_connections (user_id, token) values ($1, 'x')`, [ADMIN_A2.user]), '42501')
    await expectCode(q('anon', `delete from public.vercel_connections`), '42501')
  })
})

describe('migration 0008', () => {
  it('supprimer le compte supprime la ligne (cascade)', async () => {
    await insert(ADMIN_A1)
    await q('postgres', `delete from auth.users where id = $1`, [ADMIN_A1.user])
    expect(await count('postgres', 'public.vercel_connections')).toBe(0)
  })
})
