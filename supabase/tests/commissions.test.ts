/**
 * Tests de la migration 0014 : apporteur limité à ses prospects (ni audit ni offre, étapes de démarche
 * seulement, date d'enregistrement figée), audit humain, et commissions calculées par la base au paiement
 * (barème cumulatif sur acompte + solde, devis suivant, hors fenêtre, avoir négatif, frais refacturés exclus).
 * Même calcul que src/shared/commission.ts.
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
const SERVICE = 'a0000000-0000-4000-8000-000000000801'
const SERVICE_B = 'b0000000-0000-4000-8000-000000000801'
const TIERS = [
  { up_to_cents: 300000, rate: 12 },
  { up_to_cents: 1000000, rate: 10 },
  { up_to_cents: null, rate: 8 },
]

setupDatabase(`
  insert into auth.users (id, email, email_confirmed_at) values ('${FIN_A.user}', '${FIN_A.email}', now());
  insert into public.members (id, organization_id, user_id, name, email, role)
    values ('${FIN_A.member}', '${ORG_A}', '${FIN_A.user}', 'Finance A', '${FIN_A.email}', 'finance');
  insert into public.services (id, organization_id, name) values
    ('${SERVICE}', '${ORG_A}', 'Refonte de site'),
    ('${SERVICE_B}', 'b0000000-0000-4000-8000-000000000001', 'Service B');
  insert into public.commission_plans (member_id, tiers, followup_rate)
    values ('${PROSP_A.member}', '${JSON.stringify(TIERS)}', 5);
`)

const line = (label: string, unit_price_cents: number, extra: Record<string, unknown> = {}) => ({
  label,
  description: null,
  quantity: 1,
  unit: 'flat',
  unit_price_cents,
  vat_rate: 20,
  ...extra,
})

async function newProspect(who: Who, company = 'Boulangerie Dupont', extra: Record<string, unknown> = {}) {
  const fields: Record<string, unknown> = { organization_id: ORG_A, company, ...extra }
  const keys = Object.keys(fields)
  const [row] = await q<Record<string, unknown> & { id: string }>(
    who,
    `insert into public.prospects (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
    Object.values(fields),
  )
  return row!
}

const today = async () =>
  (await q<{ d: string }>('postgres', `select ((now() at time zone 'Europe/Paris')::date)::text as d`))[0]!.d

/* ---------- Apporteur ---------- */

describe('0014 : apporteur limité à ses prospects', () => {
  it('ne voit que les prospects dont il est responsable ou auteur ; admin et membre voient tout', async () => {
    await newProspect(PROSP_A, 'À lui')
    await newProspect(ADMIN_A1, 'Confié', { owner_member_id: PROSP_A.member })
    await newProspect(ADMIN_A1, 'Pas à lui')
    const visible = async (who: Who) =>
      (await q<{ company: string }>(who, `select company from public.prospects order by company`)).map((r) => r.company)
    expect(await visible(PROSP_A)).toEqual(['Confié', 'À lui'])
    expect(await visible(ADMIN_A1)).toHaveLength(3)
    expect(await visible(MEMBRE_A)).toHaveLength(3)
    expect(await visible(FIN_A)).toEqual([])
    expect(await visible(ADMIN_B)).toEqual([])
  })

  it('à la création : « À auditer », enregistré aujourd’hui, responsable = lui, sans audit ni offre', async () => {
    const prospect = await newProspect(PROSP_A, 'Garage', {
      stage: 'meeting',
      registered_at: '2020-01-01',
      owner_member_id: ADMIN_A1.member,
      audit_notes: 'Rien',
      offer_notes: 'Offre',
      recommended_service_id: SERVICE,
    })
    const [registered] = await q<{ d: string }>('postgres', `select registered_at::text as d from public.prospects where id = $1`, [
      prospect.id,
    ])
    expect(registered?.d).toBe(await today())
    expect(prospect).toMatchObject({
      stage: 'to_audit',
      owner_member_id: PROSP_A.member,
      created_by: PROSP_A.member,
      audit_notes: null,
      offer_notes: null,
      recommended_service_id: null,
      audit_status: 'none',
      do_not_contact: false,
    })
    await expectCode(newProspect(PROSP_A, 'X', { audit: '{}' }), '42501') // écrit par le serveur seulement
  })

  it('jamais l’audit, l’offre, la date ni le responsable ; seulement les étapes de démarche après l’audit', async () => {
    const { id } = await newProspect(PROSP_A)
    const update = (who: Who, set: string, params: unknown[] = []) =>
      q(who, `update public.prospects set ${set} where id = $1`, [id, ...params])

    await expectCode(update(PROSP_A, `audit_notes = 'x'`), '42501')
    await expectCode(update(PROSP_A, `offer_notes = 'x'`), '42501')
    await expectCode(update(PROSP_A, `recommended_service_id = $2`, [SERVICE]), '42501')
    await expectCode(update(PROSP_A, `audit = '{}'`), '42501')
    await expectCode(update(PROSP_A, `audit_status = 'done'`), '42501')
    await expectCode(update(PROSP_A, `registered_at = '2020-01-01'`), '42501')
    await expectCode(update(PROSP_A, `owner_member_id = $2`, [ADMIN_A1.member]), '42501')
    await expectCode(update(PROSP_A, `stage = 'offer_ready'`), '42501')
    await expectCode(update(PROSP_A, `stage = 'contacted'`), 'P0001', /audit/)

    // Ce qu'il peut écrire.
    await update(PROSP_A, `pitch = 'Votre site n''est pas lisible sur mobile', do_not_contact = true, lost_reason = 'Budget'`)

    // L'agence fait l'audit et choisit l'offre ; le serveur écrit le pré-audit.
    await update('service_role', `audit = '{"summary": "Site lent"}', audit_status = 'done'`)
    const [audited] = await q<{ audited_by: string; audited: boolean }>(
      MEMBRE_A,
      `update public.prospects set audit_notes = 'Design daté', recommended_service_id = $2, offer_notes = 'Refonte', stage = 'offer_ready'
       where id = $1 returning audited_by, audited_at is not null as audited`,
      [id, SERVICE],
    )
    expect(audited).toEqual({ audited_by: MEMBRE_A.member, audited: true })
    await expectCode(update(ADMIN_A1, `recommended_service_id = $2`, [SERVICE_B]), '23514')

    await update(PROSP_A, `stage = 'contacted'`)
    await update(PROSP_A, `stage = 'meeting'`)
    await expectCode(update(PROSP_A, `stage = 'to_audit'`), '42501')
    await update(ADMIN_A1, `registered_at = '2026-10-01'`) // un admin corrige la date
  })

  it('« Perdu » reste possible avant l’audit', async () => {
    const { id } = await newProspect(PROSP_A)
    await q(PROSP_A, `update public.prospects set stage = 'lost', lost_reason = 'Fermé' where id = $1`, [id])
  })
})

/* ---------- 0019 : responsable et date d'enregistrement ---------- */

describe('0019 : la commission ne se détourne pas', () => {
  it('un membre ne change ni le responsable ni la date d’enregistrement ; un admin oui, avant la conversion', async () => {
    const { id } = await newProspect(MEMBRE_A, 'Beta')
    const update = (who: Who, set: string, params: unknown[] = []) =>
      q<{ owner_member_id: string; registered_at: string }>(
        who,
        `update public.prospects set ${set} where id = $1 returning owner_member_id, registered_at::text`,
        [id, ...params],
      )
    // Le scénario de la revue : le membre confie le prospect à l'apporteur et l'antidate.
    await expectCode(update(MEMBRE_A, `owner_member_id = $2, registered_at = '2020-01-01'`, [PROSP_A.member]), '42501', /admin/)
    await expectCode(update(MEMBRE_A, `owner_member_id = $2`, [PROSP_A.member]), '42501')
    await expectCode(update(MEMBRE_A, `registered_at = '2020-01-01'`), '42501')
    // Valeur inchangée renvoyée par le formulaire : acceptée.
    await update(MEMBRE_A, `owner_member_id = $2, notes = 'RAS'`, [MEMBRE_A.member])

    const [moved] = await update(ADMIN_A1, `owner_member_id = $2, registered_at = '2026-10-01'`, [PROSP_A.member])
    expect(moved).toEqual({ owner_member_id: PROSP_A.member, registered_at: '2026-10-01' })
  })

  it('à la création, un membre ne confie pas le prospect à un autre et ne l’antidate pas ; un admin oui', async () => {
    await expectCode(newProspect(MEMBRE_A, 'X', { owner_member_id: PROSP_A.member }), '42501')
    await expectCode(newProspect(MEMBRE_A, 'X', { registered_at: '2020-01-01' }), '42501')
    const mine = await newProspect(MEMBRE_A, 'Mien', { owner_member_id: MEMBRE_A.member, registered_at: await today() })
    expect(mine).toMatchObject({ owner_member_id: MEMBRE_A.member, created_by: MEMBRE_A.member })
    const confided = await newProspect(ADMIN_A1, 'Confié', { owner_member_id: PROSP_A.member, registered_at: '2026-10-01' })
    expect(confided.owner_member_id).toBe(PROSP_A.member)
    const [registered] = await q<{ d: string }>('postgres', `select registered_at::text as d from public.prospects where id = $1`, [
      confided.id,
    ])
    expect(registered?.d).toBe('2026-10-01')
  })

  it('prospect devenu client : responsable et date figés, même pour un admin ; le serveur garde la main', async () => {
    const { prospectId } = await broughtClient('Converti')
    for (const who of [ADMIN_A1, MEMBRE_A]) {
      await expectCode(
        q(who, `update public.prospects set owner_member_id = $2 where id = $1`, [prospectId, WORKER_A.member]),
        '42501',
        who === ADMIN_A1 ? /devenu client/ : undefined,
      )
      await expectCode(q(who, `update public.prospects set registered_at = '2020-01-01' where id = $1`, [prospectId]), '42501')
    }
    // Les autres champs restent modifiables.
    await q(ADMIN_A1, `update public.prospects set notes = 'Signé' where id = $1`, [prospectId])
    await q('service_role', `update public.prospects set registered_at = '2026-01-01' where id = $1`, [prospectId])
  })
})

/* ---------- Commissions ---------- */

interface CommissionRow {
  member_id: string
  kind: string
  base_cents: string
  amount_cents: string
  status: string
  quote_id: string | null
  payer_issuer_id: string | null
}

const commissions = () =>
  q<CommissionRow>(
    'postgres',
    `select member_id, kind, base_cents::text, amount_cents::text, status, quote_id, payer_issuer_id
     from public.commissions order by kind, amount_cents`,
  )

/** Prospect de l'apporteur, audité, converti en client : renvoie l'id du client. */
async function broughtClient(company = 'Boulangerie Dupont') {
  const prospect = await newProspect(PROSP_A, company)
  await q(ADMIN_A1, `update public.prospects set stage = 'offer_ready' where id = $1`, [prospect.id])
  const [row] = await q<{ id: string }>(ADMIN_A1, `select public.convert_prospect($1) as id`, [prospect.id])
  return { clientId: row!.id, prospectId: prospect.id }
}

async function acceptedQuote(clientId: string, lines: unknown[]) {
  const [row] = await q<{ id: string }>(
    FIN_A,
    `insert into public.quotes (client_id, title, lines) values ($1, 'Devis', $2::jsonb) returning id`,
    [clientId, JSON.stringify(lines)],
  )
  await q(FIN_A, `update public.quotes set status = 'accepted' where id = $1`, [row!.id])
  return row!.id
}

async function paidInvoice(clientId: string, quoteId: string | null, lines: unknown[], kind = 'invoice') {
  const [draft] = await q<{ id: string }>(
    FIN_A,
    `insert into public.invoices (client_id, quote_id, kind, title, lines) values ($1, $2, $3, 'Facture', $4::jsonb) returning id`,
    [clientId, quoteId, kind, JSON.stringify(lines)],
  )
  await q(FIN_A, `select public.issue_invoice($1)`, [draft!.id])
  await q(FIN_A, `update public.invoices set status = 'paid' where id = $1`, [draft!.id])
  return draft!.id
}

describe('0014 : commissions calculées au paiement', () => {
  it('premier devis : barème cumulatif sur acompte puis solde, frais refacturés exclus (8 000 € → 860 €)', async () => {
    const { clientId } = await broughtClient()
    const quoteId = await acceptedQuote(clientId, [line('Refonte', 800000), line('Hébergement', 50000, { rebilled: true })])

    await paidInvoice(clientId, quoteId, [line('Acompte 30 %', 240000)], 'deposit')
    expect(await commissions()).toEqual([
      expect.objectContaining({ member_id: PROSP_A.member, kind: 'first', base_cents: '240000', amount_cents: '28800', status: 'due' }),
    ])

    await paidInvoice(clientId, quoteId, [
      line('Refonte', 800000),
      line('Hébergement', 50000, { rebilled: true }),
      line('Acompte déjà facturé', -240000),
    ])
    const rows = await commissions()
    expect(rows.map((r) => [r.kind, r.base_cents, r.amount_cents])).toEqual([
      ['first', '240000', '28800'],
      ['first', '560000', '57200'],
    ])
    expect(rows.reduce((sum, r) => sum + Number(r.amount_cents), 0)).toBe(86000)
  })

  it('devis suivant dans les 12 mois : taux fixe ; hors fenêtre ou sans devis : rien', async () => {
    const { clientId } = await broughtClient()
    const first = await acceptedQuote(clientId, [line('Refonte', 500000)])
    await paidInvoice(clientId, first, [line('Refonte', 500000)])

    const second = await acceptedQuote(clientId, [line('Maintenance', 400000)])
    await paidInvoice(clientId, second, [line('Maintenance', 400000)])
    expect((await commissions()).map((r) => [r.kind, r.base_cents, r.amount_cents, r.quote_id])).toEqual([
      ['first', '500000', '56000', first],
      ['followup', '400000', '20000', second],
    ])

    // Devis accepté 13 mois après le premier (import : date d'acceptation fournie) : rien.
    await q('postgres', `select set_config('sordulo.import', 'on', true)`)
    const [late] = await q<{ id: string }>(
      'postgres',
      `insert into public.quotes (client_id, title, status, number, lines, accepted_at)
       values ($1, 'Tardif', 'accepted', '2027-900', $2::jsonb, now() + interval '13 months') returning id`,
      [clientId, JSON.stringify([line('Évolution', 300000)])],
    )
    await q('postgres', `select set_config('sordulo.import', 'off', true)`)
    await paidInvoice(clientId, late!.id, [line('Évolution', 300000)])
    // Facture sans devis : rien.
    await paidInvoice(clientId, null, [line('Divers', 100000)])
    expect(await commissions()).toHaveLength(2)
  })

  it('premier devis signé après la fenêtre de 6 mois : client non apporté, aucune commission', async () => {
    const { clientId, prospectId } = await broughtClient('Ancien prospect')
    // Donnée de départ (prospect converti : registered_at ne se modifie plus par l'app, 0019).
    await q('postgres', `update public.prospects set registered_at = current_date - interval '8 months' where id = $1`, [prospectId])
    const quoteId = await acceptedQuote(clientId, [line('Refonte', 500000)])
    await paidInvoice(clientId, quoteId, [line('Refonte', 500000)])
    expect(await commissions()).toEqual([])
  })

  it('sans barème actif, ou client qui ne vient pas d’un prospect : rien', async () => {
    await q('postgres', `update public.commission_plans set active = false`)
    const { clientId } = await broughtClient()
    const quoteId = await acceptedQuote(clientId, [line('Refonte', 500000)])
    await paidInvoice(clientId, quoteId, [line('Refonte', 500000)])
    await q('postgres', `update public.commission_plans set active = true`)
    const direct = await acceptedQuote(CLIENT_A_FULL, [line('Refonte', 500000)])
    await paidInvoice(CLIENT_A_FULL, direct, [line('Refonte', 500000)])
    expect(await commissions()).toEqual([])
  })

  it('avoir : commission négative au taux marginal ; une facture qui repasse en émise retire sa commission due', async () => {
    const { clientId } = await broughtClient()
    const quoteId = await acceptedQuote(clientId, [line('Refonte', 800000)])
    await paidInvoice(clientId, quoteId, [line('Acompte', 300000)], 'deposit')
    const balance = await paidInvoice(clientId, quoteId, [line('Refonte', 800000), line('Acompte', -300000)])
    expect((await commissions()).map((r) => r.amount_cents)).toEqual(['36000', '50000'])

    await q(FIN_A, `select public.create_credit_note($1)`, [balance])
    const rows = await commissions()
    expect(rows.map((r) => [r.base_cents, r.amount_cents])).toEqual([
      ['-500000', '-50000'],
      ['300000', '36000'],
      ['500000', '50000'],
    ])
    expect(rows.reduce((sum, r) => sum + Number(r.amount_cents), 0)).toBe(36000)

    // Paiement annulé (payée → émise) : la commission due disparaît, recalculée au nouveau paiement.
    const other = await paidInvoice(clientId, quoteId, [line('Complément', 100000)])
    expect(await count('postgres', `public.commissions where invoice_id = '${other}'`)).toBe(1)
    await q(FIN_A, `update public.invoices set status = 'issued' where id = $1`, [other])
    expect(await count('postgres', `public.commissions where invoice_id = '${other}'`)).toBe(0)
    await q(FIN_A, `update public.invoices set status = 'paid' where id = $1`, [other])
    expect(await count('postgres', `public.commissions where invoice_id = '${other}'`)).toBe(1)
  })

  it('lecture : admin, finance et l’apporteur ; statut et note : admin et finance ; notification', async () => {
    const { clientId } = await broughtClient()
    const quoteId = await acceptedQuote(clientId, [line('Refonte', 500000)])
    await paidInvoice(clientId, quoteId, [line('Refonte', 500000)])

    for (const who of [ADMIN_A1, FIN_A, PROSP_A]) expect(await count(who, 'public.commissions')).toBe(1)
    for (const who of [MEMBRE_A, WORKER_A, ADMIN_B]) expect(await count(who, 'public.commissions')).toBe(0)

    const [{ id }] = (await q<{ id: string }>('postgres', `select id from public.commissions`)) as [{ id: string }]
    expect(await q(PROSP_A, `update public.commissions set status = 'paid' where id = $1 returning id`, [id])).toEqual([])
    await expectCode(q(FIN_A, `update public.commissions set amount_cents = 1 where id = $1`, [id]), '42501')
    const [invoiced] = await q<{ status: string; invoiced: boolean; paid: boolean }>(
      FIN_A,
      `update public.commissions set status = 'invoiced', note = 'Facture apporteur n° 12' where id = $1
       returning status, invoiced_at is not null as invoiced, paid_at is not null as paid`,
      [id],
    )
    expect(invoiced).toEqual({ status: 'invoiced', invoiced: true, paid: false })
    await expectCode(q(ADMIN_A1, `insert into public.commissions (organization_id) values ($1)`, [ORG_A]), '42501')

    const notified = await q<{ member_id: string; title: string; body: string | null }>(
      'postgres',
      `select member_id, title, body from public.notifications where kind = 'commission.created' order by member_id`,
    )
    expect(notified.map((n) => n.member_id).sort()).toEqual([ADMIN_A1.member, ADMIN_A2.member, PROSP_A.member].sort())
    expect(notified.find((n) => n.member_id === PROSP_A.member)).toMatchObject({
      title: 'Commission : 560,00 € (Boulangerie Dupont)',
      body: null,
    })
  })

  it('les documents importés ne donnent pas de commission', async () => {
    const { clientId } = await broughtClient()
    const quoteId = await acceptedQuote(clientId, [line('Refonte', 500000)])
    await q('postgres', `select set_config('sordulo.import', 'on', true)`)
    await q(
      'postgres',
      `insert into public.invoices (client_id, quote_id, kind, status, number, title, lines, issue_date)
       values ($1, $2, 'invoice', 'paid', '2026-950', 'Importée', $3::jsonb, current_date)`,
      [clientId, quoteId, JSON.stringify([line('Refonte', 500000)])],
    )
    await q('postgres', `select set_config('sordulo.import', 'off', true)`)
    expect(await commissions()).toEqual([])
  })
})
