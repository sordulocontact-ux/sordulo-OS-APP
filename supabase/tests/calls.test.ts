/**
 * Tests de la migration 0024 (appels) : moments marqués d'une entrée (inputs.markers), origine externe
 * unique par organisation (inputs.external_ref), ticket tiré d'un moment marqué (tickets.from_marker).
 * Lancer : npm run test:rls
 */
import { describe, expect, it } from 'vitest'
import { ADMIN_B, MEMBRE_A, ORG_A, ORG_B, PROJECT_A_ACTIVE, PROJECT_A_ODD, PROJECT_B, expectCode, q, setupDatabase } from './harness'

setupDatabase()

/** Entrée créée comme le fait l'API (service_role) ; organization_id vient du projet (trigger). */
async function insertInput(project: string, extra: { markers?: string; external_ref?: string | null } = {}): Promise<string> {
  const [row] = await q<{ id: string }>(
    'service_role',
    `insert into public.inputs (project_id, kind, raw_text, markers, external_ref)
     values ($1, 'written', 'Retour', coalesce($2::jsonb, '[]'::jsonb), $3)
     returning id`,
    [project, extra.markers ?? null, extra.external_ref ?? null],
  )
  if (!row) throw new Error('entrée non créée')
  return row.id
}

const markersOf = async (id: string) =>
  (await q<{ markers: unknown }>('postgres', `select markers from public.inputs where id = $1`, [id]))[0]?.markers

describe('inputs.markers', () => {
  it('vaut [] par défaut', async () => {
    const [row] = await q<{ id: string }>(
      'service_role',
      `insert into public.inputs (project_id, kind, raw_text) values ($1, 'written', 'Retour') returning id`,
      [PROJECT_A_ACTIVE],
    )
    expect(await markersOf(row!.id)).toEqual([])
  })

  it('accepte des secondes >= 0, décimales comprises', async () => {
    const id = await insertInput(PROJECT_A_ACTIVE, { markers: '[0, 12.5, 3600]' })
    expect(await markersOf(id)).toEqual([0, 12.5, 3600])
  })

  it('accepte 100 repères, refuse le 101e', async () => {
    const hundred = JSON.stringify(Array.from({ length: 100 }, (_, i) => i))
    const id = await insertInput(PROJECT_A_ACTIVE, { markers: hundred })
    expect(await markersOf(id)).toHaveLength(100)
    await expectCode(insertInput(PROJECT_A_ACTIVE, { markers: JSON.stringify(Array.from({ length: 101 }, (_, i) => i)) }), '23514')
  })

  it('refuse autre chose qu’un tableau', async () => {
    for (const bad of ['{}', '{"0": 1}', '5', '"12"', 'null']) {
      await expectCode(insertInput(PROJECT_A_ACTIVE, { markers: bad }), '23514')
    }
  })

  it('refuse un repère négatif ou qui n’est pas un nombre', async () => {
    for (const bad of ['[-1]', '[3, -0.5]', '["12"]', '[null]', '[true]', '[[1]]', '[{"t": 1}]']) {
      await expectCode(insertInput(PROJECT_A_ACTIVE, { markers: bad }), '23514')
    }
  })

  it('refuse null', async () => {
    const id = await insertInput(PROJECT_A_ACTIVE)
    await expectCode(q('service_role', `update public.inputs set markers = null where id = $1`, [id]), '23502')
  })

  it('reste lisible et modifiable par un membre (droits de inputs inchangés)', async () => {
    const id = await insertInput(PROJECT_A_ACTIVE, { markers: '[42]' })
    expect(await q(MEMBRE_A, `select markers, external_ref from public.inputs where id = $1`, [id])).toEqual([
      { markers: [42], external_ref: null },
    ])
    await q(MEMBRE_A, `update public.inputs set speaker_names = '{"0": "Maël"}' where id = $1`, [id])
    await expectCode(q(MEMBRE_A, `update public.inputs set markers = '[-3]' where id = $1`, [id]), '23514')
    // Une autre organisation ne voit rien.
    expect(await q(ADMIN_B, `select id from public.inputs where id = $1`, [id])).toEqual([])
  })
})

describe('inputs.external_ref', () => {
  const MESSAGE_ID = '<CAF=abc123@mail.gmail.com>'

  it('null par défaut, plusieurs entrées sans origine dans la même organisation', async () => {
    const a = await insertInput(PROJECT_A_ACTIVE)
    const b = await insertInput(PROJECT_A_ACTIVE)
    const rows = await q<{ external_ref: string | null }>('postgres', `select external_ref from public.inputs where id in ($1, $2)`, [a, b])
    expect(rows).toEqual([{ external_ref: null }, { external_ref: null }])
  })

  it('unique par organisation, même sur deux projets différents', async () => {
    await insertInput(PROJECT_A_ACTIVE, { external_ref: MESSAGE_ID })
    await expectCode(insertInput(PROJECT_A_ACTIVE, { external_ref: MESSAGE_ID }), '23505')
    await expectCode(insertInput(PROJECT_A_ODD, { external_ref: MESSAGE_ID }), '23505')
  })

  it('la même origine dans deux organisations est acceptée', async () => {
    const a = await insertInput(PROJECT_A_ACTIVE, { external_ref: MESSAGE_ID })
    const b = await insertInput(PROJECT_B, { external_ref: MESSAGE_ID })
    const rows = await q<{ organization_id: string }>(
      'postgres',
      `select organization_id from public.inputs where id in ($1, $2) order by organization_id`,
      [a, b],
    )
    expect(rows.map((r) => r.organization_id)).toEqual([ORG_A, ORG_B])
  })

  it('refuse une origine vide, blanche ou trop longue', async () => {
    for (const bad of ['', '   ', 'x'.repeat(513)]) {
      await expectCode(insertInput(PROJECT_A_ACTIVE, { external_ref: bad }), '23514')
    }
    await insertInput(PROJECT_A_ACTIVE, { external_ref: 'x'.repeat(512) })
  })
})

describe('tickets.from_marker', () => {
  async function insertTicket(fromMarker?: boolean): Promise<boolean | undefined> {
    const input = await insertInput(PROJECT_A_ACTIVE)
    const columns = fromMarker === undefined ? '' : ', from_marker'
    const values = fromMarker === undefined ? '' : `, ${fromMarker}`
    const [row] = await q<{ from_marker: boolean }>(
      'service_role',
      `insert into public.tickets (project_id, input_id, title, type${columns})
       values ($1, $2, 'Agrandir le bouton', 'modification'${values})
       returning from_marker`,
      [PROJECT_A_ACTIVE, input],
    )
    return row?.from_marker
  }

  it('vaut false par défaut', async () => {
    expect(await insertTicket()).toBe(false)
  })

  it('posé à true par le serveur, lisible par un membre', async () => {
    expect(await insertTicket(true)).toBe(true)
    expect(await q(MEMBRE_A, `select from_marker from public.tickets where from_marker`)).toEqual([{ from_marker: true }])
  })

  it('refuse null', async () => {
    await insertTicket()
    await expectCode(q('service_role', `update public.tickets set from_marker = null`), '23502')
  })
})
