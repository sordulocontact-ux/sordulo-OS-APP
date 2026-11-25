/**
 * Tests de la migration 0004 : rôle finance, lecture par rôle, devis, factures (totaux, numérotation,
 * émission, avoir, figement), statut automatique des projets, prospection, statut de connexion.
 * Lancer : npm run test:rls
 */
import { describe, expect, it } from 'vitest'
import {
  ADMIN_A1,
  ADMIN_B,
  CLIENT_A_FULL,
  CLIENT_A_NONE,
  INVITED_A,
  MEMBRE_A,
  ORG_A,
  PROJECT_A_ACTIVE,
  PROJECT_B,
  PROSP_A,
  count,
  expectCode,
  person,
  q,
  setupDatabase,
} from './harness'

const FIN_A = person(6, 'a', 'finance@a.test')

setupDatabase(`
  insert into auth.users (id, email, email_confirmed_at) values ('${FIN_A.user}', '${FIN_A.email}', now());
  insert into public.members (id, organization_id, user_id, name, email, role)
    values ('${FIN_A.member}', '${ORG_A}', '${FIN_A.user}', 'Finance A', '${FIN_A.email}', 'finance');

  update public.organizations
  set legal_name = 'Sordulo SAS', siret = '73282932000074', address_street = '1 rue de la Paix',
      address_postal_code = '75002', address_city = 'Paris', address_country = 'France',
      bank_iban = 'FR7630006000011234567890189', bank_bic = 'AGRIFRPP'
  where id = '${ORG_A}';

  update public.clients
  set siret = '55210055400013', billing_street = '2 avenue Ibé', billing_postal_code = '69001', billing_city = 'Lyon'
  where id = '${CLIENT_A_FULL}';

  insert into public.inputs (project_id, kind, title, raw_text) values ('${PROJECT_A_ACTIVE}', 'written', 'Retour', 'Texte');
  insert into public.tickets (project_id, title, type) values ('${PROJECT_A_ACTIVE}', 'Ticket', 'bug');
`)

/** Ligne de document. */
const line = (label: string, quantity: number, unit: string, unit_price_cents: number, vat_rate: number) => ({
  label,
  description: null,
  quantity,
  unit,
  unit_price_cents,
  vat_rate,
})

/** Exemple chiffré : 2 taux de TVA et des décimales. */
const TWO_RATES = [
  line('Design', 2.5, 'day', 45000, 20), // 112 500
  line('Hébergement', 1, 'flat', 33333, 5.5), // 33 333
  line('Support', 3, 'hour', 1999, 20), // 5 997
]
// HT = 151 830 ; TVA 20 % sur 118 497 = 23 699,4 → 23 699 ; TVA 5,5 % sur 33 333 = 1 833,3 → 1 833.
const TWO_RATES_TOTALS = { total_ht_cents: 151830, total_vat_cents: 25532, total_ttc_cents: 177362 }

interface Doc {
  id: string
  number: string | null
  status: string
  total_ht_cents: number
  total_vat_cents: number
  total_ttc_cents: number
}

const parisYear = async () =>
  (await q<{ y: number }>('postgres', `select extract(year from (now() at time zone 'Europe/Paris'))::int as y`))[0]!.y

async function newProject(status: string) {
  const [row] = await q<{ id: string }>(
    'postgres',
    `insert into public.projects (organization_id, client_id, name, status) values ($1, $2, 'Projet test', $3) returning id`,
    [ORG_A, CLIENT_A_FULL, status],
  )
  return row!.id
}

const projectStatus = async (id: string) =>
  (await q<{ status: string }>('postgres', `select status from public.projects where id = $1`, [id]))[0]!.status

async function newQuote(who = FIN_A, projectId: string | null = null, lines: unknown[] = TWO_RATES) {
  const [row] = await q<Doc>(
    who,
    `insert into public.quotes (client_id, project_id, title, lines) values ($1, $2, 'Devis', $3::jsonb) returning *`,
    [CLIENT_A_FULL, projectId, JSON.stringify(lines)],
  )
  return row!
}

async function newInvoice(projectId: string | null = null, kind = 'invoice', lines: unknown[] = TWO_RATES) {
  const [row] = await q<Doc>(
    FIN_A,
    `insert into public.invoices (client_id, project_id, kind, title, lines) values ($1, $2, $3, 'Facture', $4::jsonb) returning *`,
    [CLIENT_A_FULL, projectId, kind, JSON.stringify(lines)],
  )
  return row!
}

const issue = async (id: string, who = FIN_A) =>
  (await q<Doc & Record<string, unknown>>(who, `select * from public.issue_invoice($1)`, [id]))[0]!

describe('0004 : schéma', () => {
  it('a les colonnes de src/shared/types.ts', async () => {
    const expected: Record<string, string[]> = {
      quotes: [
        'id', 'organization_id', 'client_id', 'project_id', 'issuer_id', 'number', 'title', 'status', 'issue_date', 'valid_until',
        'lines', 'notes', 'total_ht_cents', 'total_vat_cents', 'total_ttc_cents', 'sent_at', 'accepted_at',
        'refused_at', 'created_by', 'created_at', 'updated_at',
      ],
      invoices: [
        'id', 'organization_id', 'client_id', 'project_id', 'quote_id', 'issuer_id', 'kind', 'status', 'number', 'title',
        'issue_date', 'due_date', 'lines', 'notes', 'deposit_percent', 'credited_invoice_id', 'seller', 'buyer',
        'total_ht_cents', 'total_vat_cents', 'total_ttc_cents', 'issued_at', 'paid_at', 'cancelled_at', 'created_by',
        'created_at', 'updated_at',
      ],
      prospects: [
        'id', 'organization_id', 'company', 'website', 'contact_name', 'contact_email', 'contact_phone', 'source',
        'stage', 'next_action_date', 'notes', 'owner_member_id', 'client_id', 'won_at', 'created_by', 'created_at',
        'updated_at',
        // 0014
        'registered_at', 'audit', 'audit_status', 'audit_notes', 'audited_at', 'audited_by', 'recommended_service_id',
        'offer_notes', 'pitch', 'lost_reason', 'do_not_contact',
      ],
      document_counters: ['organization_id', 'series', 'year', 'last_value'],
    }
    for (const [table, columns] of Object.entries(expected)) {
      const rows = await q<{ column_name: string }>(
        'postgres',
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
        [table],
      )
      expect(rows.map((r) => r.column_name).sort(), table).toEqual([...columns].sort())
    }
  })

  it('paramètres de facturation : défauts, bornes, écriture admin seulement', async () => {
    const [org] = await q<Record<string, unknown>>(
      FIN_A,
      `select default_vat_rate, payment_terms_days, quote_validity_days from public.organizations where id = $1`,
      [ORG_A],
    )
    expect(org).toEqual({ default_vat_rate: '20.00', payment_terms_days: 30, quote_validity_days: 30 })

    await q(ADMIN_A1, `update public.organizations set payment_terms_days = 45, default_vat_rate = 10, bank_bic = 'X' where id = $1`, [ORG_A])
    await expectCode(q(ADMIN_A1, `update public.organizations set payment_terms_days = 61 where id = $1`, [ORG_A]), '23514')
    await expectCode(q(ADMIN_A1, `update public.organizations set quote_validity_days = 0 where id = $1`, [ORG_A]), '23514')
    await expectCode(q(ADMIN_A1, `update public.organizations set default_vat_rate = 101 where id = $1`, [ORG_A]), '23514')
    expect(await q(FIN_A, `update public.organizations set bank_iban = 'X' where id = $1 returning id`, [ORG_A])).toEqual([])
  })

  it('le rôle finance est accepté, un rôle inconnu non', async () => {
    await q(ADMIN_A1, `update public.members set role = 'finance' where id = $1`, [MEMBRE_A.member])
    await expectCode(q('postgres', `update public.members set role = 'compta' where id = $1`, [MEMBRE_A.member]), '23514')
  })
})

describe('0004 : lecture par rôle', () => {
  it('finance lit organisation, équipe, clients, contacts, projets, membres de projet, sans rien y écrire', async () => {
    await q('postgres', `insert into public.project_members (project_id, member_id) values ($1, $2)`, [
      PROJECT_A_ACTIVE,
      MEMBRE_A.member,
    ])
    expect(await count(FIN_A, 'public.organizations')).toBe(1)
    expect(await count(FIN_A, 'public.members')).toBe(7)
    expect(await count(FIN_A, 'public.clients')).toBe(3)
    expect(await count(FIN_A, 'public.client_contacts')).toBe(2)
    expect(await count(FIN_A, 'public.projects')).toBe(2)
    expect(await count(FIN_A, 'public.project_members')).toBe(1)

    await expectCode(q(FIN_A, `insert into public.clients (organization_id, name) values ($1, 'X')`, [ORG_A]), '42501')
    await expectCode(q(FIN_A, `insert into public.projects (organization_id, name) values ($1, 'X')`, [ORG_A]), '42501')
    await expectCode(q(FIN_A, `insert into public.client_contacts (client_id, name) values ($1, 'X')`, [CLIENT_A_NONE]), '42501')
    expect(await q(FIN_A, `update public.clients set name = 'X' where id = $1 returning id`, [CLIENT_A_FULL])).toEqual([])
    expect(await q(FIN_A, `update public.projects set status = 'paid' where id = $1 returning id`, [PROJECT_A_ACTIVE])).toEqual([])
    expect(await q(FIN_A, `update public.members set name = 'X' where id = $1 returning id`, [MEMBRE_A.member])).toEqual([])
  })

  it('finance ne voit ni entrées, ni tickets, ni tâches, et n’en crée pas', async () => {
    expect(await count(ADMIN_A1, 'public.tasks')).toBe(4)
    expect(await count(MEMBRE_A, 'public.tickets')).toBe(1)
    expect(await count(MEMBRE_A, 'public.inputs')).toBe(1)
    for (const table of ['public.tasks', 'public.tickets', 'public.inputs']) {
      expect(await count(FIN_A, table), table).toBe(0)
      expect(await count(PROSP_A, table), table).toBe(0)
    }
    await expectCode(
      q(FIN_A, `insert into public.tasks (project_id, title, skill) values ($1, 'X', 'dev')`, [PROJECT_A_ACTIVE]),
      '42501',
    )
    await expectCode(
      q(PROSP_A, `insert into public.inputs (project_id, kind, raw_text) values ($1, 'written', 'X')`, [PROJECT_A_ACTIVE]),
      '42501',
    )
  })

  it('prospection ne voit que l’organisation, l’équipe et les prospects', async () => {
    expect(await count(PROSP_A, 'public.organizations')).toBe(1)
    expect(await count(PROSP_A, 'public.members')).toBe(7)
    for (const table of ['public.clients', 'public.client_contacts', 'public.projects', 'public.project_members']) {
      expect(await count(PROSP_A, table), table).toBe(0)
    }
  })

  it('membre et prospection ne lisent ni devis ni factures, et n’en créent pas', async () => {
    await newQuote()
    await newInvoice()
    expect(await count(FIN_A, 'public.quotes')).toBe(1)
    expect(await count(ADMIN_A1, 'public.invoices')).toBe(1)
    for (const who of [MEMBRE_A, PROSP_A, ADMIN_B]) {
      expect(await count(who, 'public.quotes')).toBe(0)
      expect(await count(who, 'public.invoices')).toBe(0)
    }
    await expectCode(newQuote(MEMBRE_A), '42501')
    await expectCode(newQuote(PROSP_A), '42501')
    // Client d'une autre organisation : l'organisation vient du client, la RLS refuse.
    await expectCode(newQuote(ADMIN_B), '42501')
    // Compteurs : aucun accès direct.
    await expectCode(q(FIN_A, `select * from public.document_counters`), '42501')
    await expectCode(q('anon', `select * from public.quotes`), '42501')
  })
})

describe('0004 : devis', () => {
  it('calcule les totaux (2 taux de TVA) que le client ne peut pas forcer', async () => {
    const [quote] = await q<Doc & Record<string, unknown>>(
      FIN_A,
      `insert into public.quotes (organization_id, client_id, title, issue_date, lines, total_ht_cents, number, sent_at)
       values ($1, $2, 'Refonte', '2026-03-10', $3::jsonb, 1, 'D-1999-999', now()) returning *`,
      [ORG_A, CLIENT_A_FULL, JSON.stringify(TWO_RATES)],
    )
    expect(quote).toMatchObject({
      ...TWO_RATES_TOTALS,
      number: '2026-001', // AAAA-NNN depuis la 0005 (D-AAAA-NNN avant)
      organization_id: ORG_A,
      created_by: FIN_A.member,
      status: 'draft',
      sent_at: null,
    })
    const [{ valid_until }] = await q<{ valid_until: string }>(
      'postgres',
      `select valid_until::text from public.quotes where id = $1`,
      [quote!.id],
    ) as [{ valid_until: string }]
    expect(valid_until).toBe('2026-04-09')

    const [updated] = await q<Doc>(
      FIN_A,
      `update public.quotes set lines = $2::jsonb, total_ttc_cents = 0 where id = $1 returning *`,
      [quote!.id, JSON.stringify([line('Demi-centime', 0.5, 'unit', 1, 20)])],
    )
    // round(0,5) = 1 (demi vers l'extérieur) ; TVA round(0,2) = 0.
    expect(updated).toMatchObject({ total_ht_cents: 1, total_vat_cents: 0, total_ttc_cents: 1, number: '2026-001' })

    const second = await q<Doc>(
      FIN_A,
      `insert into public.quotes (client_id, title, issue_date) values ($1, 'Autre', '2026-05-01') returning *`,
      [CLIENT_A_FULL],
    )
    expect(second[0]?.number).toBe('2026-002')
    const otherYear = await q<Doc>(
      FIN_A,
      `insert into public.quotes (client_id, title, issue_date) values ($1, 'Autre', '2027-01-02') returning *`,
      [CLIENT_A_FULL],
    )
    expect(otherYear[0]?.number).toBe('2027-001')
  })

  it('refuse des lignes invalides', async () => {
    const invalid = [
      [line('', 1, 'day', 100, 20)],
      [line('X', 0, 'day', 100, 20)],
      [line('X', 1, 'week', 100, 20)],
      [line('X', 1, 'day', 10.5, 20)],
      [line('X', 1, 'day', -100, 20)],
      [line('X', 1, 'day', 100, 120)],
      [{ label: 'X', quantity: '1', unit: 'day', unit_price_cents: 100, vat_rate: 20 }],
      [{ label: 'X', quantity: 1, unit: 'day', unit_price_cents: 100 }],
      ['ligne'],
    ]
    for (const lines of invalid) {
      await expectCode(newQuote(FIN_A, null, lines), '23514', /Ligne 1/)
    }
    await expectCode(
      q(FIN_A, `insert into public.quotes (client_id, title, lines) values ($1, 'X', '{}'::jsonb)`, [CLIENT_A_FULL]),
      '23514',
    )
  })

  it('horodate les statuts, fige un devis accepté ou refusé, ne supprime que les brouillons', async () => {
    const quote = await newQuote()
    const [sent] = await q<{ sent_at: string | null }>(
      FIN_A,
      `update public.quotes set status = 'sent' where id = $1 returning sent_at`,
      [quote.id],
    )
    expect(sent?.sent_at).not.toBeNull()
    const [accepted] = await q<{ accepted_at: string | null; sent_at: string | null }>(
      FIN_A,
      `update public.quotes set status = 'accepted' where id = $1 returning accepted_at, sent_at`,
      [quote.id],
    )
    expect(accepted?.accepted_at).not.toBeNull()
    expect(accepted?.sent_at).not.toBeNull()

    await expectCode(q(FIN_A, `update public.quotes set title = 'Changé' where id = $1`, [quote.id]), 'P0001', /accepté ou refusé/)
    await expectCode(q(FIN_A, `update public.quotes set status = 'draft' where id = $1`, [quote.id]), 'P0001')
    await expectCode(q(FIN_A, `delete from public.quotes where id = $1`, [quote.id]), 'P0001', /brouillon/)

    const draft = await newQuote()
    expect(await q(FIN_A, `delete from public.quotes where id = $1 returning id`, [draft.id])).toHaveLength(1)
  })

  it('refuse un projet d’une autre organisation', async () => {
    await expectCode(newQuote(FIN_A, PROJECT_B), '23514')
  })
})

describe('0004 : factures', () => {
  // Depuis la 0005 : AAAA-NNN, une seule série pour factures, acomptes et avoirs (ici sans émetteur).
  it('numérotation continue …-001, 002, avoir …-003, vendeur et acheteur figés', async () => {
    const year = await parisYear()
    const first = await newInvoice()
    const second = await newInvoice(null, 'deposit')
    expect(first.number).toBeNull()
    expect(first).toMatchObject(TWO_RATES_TOTALS)

    const issued1 = await issue(first.id)
    const issued2 = await issue(second.id, ADMIN_A1)
    expect(issued1.number).toBe(`${year}-001`)
    expect(issued2.number).toBe(`${year}-002`)
    expect(issued1).toMatchObject({ status: 'issued', ...TWO_RATES_TOTALS })
    expect(issued1.seller).toMatchObject({ name: 'Sordulo', legal_name: 'Sordulo SAS', siret: '73282932000074', bank_bic: 'AGRIFRPP' })
    expect(issued1.buyer).toMatchObject({
      name: 'Ibé',
      siret: '55210055400013',
      billing_city: 'Lyon',
      contact_name: 'Camille',
      contact_email: 'camille@ibe.test',
    })
    const [dates] = await q<{ days: number }>(
      'postgres',
      `select (due_date - issue_date) as days from public.invoices where id = $1`,
      [first.id],
    )
    expect(dates?.days).toBe(30)

    // Un changement d'adresse ultérieur ne touche pas la facture émise.
    await q(ADMIN_A1, `update public.organizations set address_city = 'Marseille' where id = $1`, [ORG_A])
    const [still] = await q<{ city: string }>('postgres', `select seller ->> 'address_city' as city from public.invoices where id = $1`, [first.id])
    expect(still?.city).toBe('Paris')

    await expectCode(issue(first.id), 'P0001', /déjà émise/)

    const [credit] = await q<Doc & Record<string, unknown>>(FIN_A, `select * from public.create_credit_note($1)`, [first.id])
    expect(credit).toMatchObject({
      number: `${year}-003`,
      kind: 'credit_note',
      status: 'issued',
      title: `Avoir sur ${year}-001`,
      credited_invoice_id: first.id,
      total_ht_cents: -151830,
      total_vat_cents: -25532,
      total_ttc_cents: -177362,
      created_by: FIN_A.member,
    })
    expect(credit.seller).toEqual(issued1.seller)
    expect((credit.lines as { unit_price_cents: number }[]).map((l) => l.unit_price_cents)).toEqual([-45000, -33333, -1999])

    const [original] = await q<{ status: string; cancelled_at: string | null }>(
      FIN_A,
      `select status, cancelled_at from public.invoices where id = $1`,
      [first.id],
    )
    expect(original?.status).toBe('cancelled')
    expect(original?.cancelled_at).not.toBeNull()

    await expectCode(q(FIN_A, `select * from public.create_credit_note($1)`, [first.id]), 'P0001')
    await expectCode(q(FIN_A, `select * from public.create_credit_note($1)`, [credit.id]), 'P0001')

    // La facture suivante continue la série.
    const third = await issue((await newInvoice()).id)
    expect(third.number).toBe(`${year}-004`)
  })

  it('émission refusée sans ligne, sans droit, ou depuis une autre organisation', async () => {
    const empty = await newInvoice(null, 'invoice', [])
    await expectCode(issue(empty.id), 'P0001', /au moins une ligne/)
    const draft = await newInvoice()
    await expectCode(issue(draft.id, MEMBRE_A), '42501', /Réservé aux admins et à la finance/)
    await expectCode(issue(draft.id, ADMIN_B), '42501')
    await expectCode(q('anon', `select * from public.issue_invoice($1)`, [draft.id]), '42501')
    await expectCode(q(MEMBRE_A, `select * from public.create_credit_note($1)`, [draft.id]), '42501')
    await expectCode(q(FIN_A, `select * from public.create_credit_note($1)`, [draft.id]), 'P0001')
  })

  it('un brouillon est modifiable mais ne s’émet pas à la main', async () => {
    const draft = await newInvoice()
    const [updated] = await q<Doc>(
      FIN_A,
      `update public.invoices set title = 'Nouveau', number = 'F-2026-9999', seller = '{}'::jsonb, lines = $2::jsonb
       where id = $1 returning *`,
      [draft.id, JSON.stringify([line('Forfait', 1, 'flat', 100000, 20)])],
    )
    expect(updated).toMatchObject({ number: null, total_ttc_cents: 120000 })
    await expectCode(q(FIN_A, `update public.invoices set status = 'issued' where id = $1`, [draft.id]), 'P0001')
    await expectCode(
      q(FIN_A, `insert into public.invoices (client_id, title, status) values ($1, 'X', 'issued')`, [CLIENT_A_FULL]),
      'P0001',
    )
    await expectCode(
      q(FIN_A, `insert into public.invoices (client_id, title, kind) values ($1, 'X', 'credit_note')`, [CLIENT_A_FULL]),
      'P0001',
    )
    await expectCode(newInvoice(null, 'invoice', [line('X', 1, 'day', -100, 20)]), '23514', /ne peut pas être négatif/)
    expect(await q(FIN_A, `delete from public.invoices where id = $1 returning id`, [draft.id])).toHaveLength(1)
  })

  it('facture de solde : déduction des acomptes en lignes négatives, total jamais négatif', async () => {
    // Exemple constaté : devis 2 226,95 € TTC, acompte de 30 % F-…-0001 de 668,09 € TTC.
    const quoteLines = [line('Développement', 3.5, 'day', 50000, 20), line('Livret', 1, 'flat', 12033, 5.5)]
    const deposit = await issue(
      (await newInvoice(null, 'deposit', [line('Acompte de 30 %', 1, 'flat', 3610, 5.5), line('Acompte de 30 %', 1, 'flat', 52500, 20)])).id,
    )
    expect(deposit.total_ttc_cents).toBe(66809)

    const balance = await newInvoice(null, 'invoice', [
      ...quoteLines,
      line(`Acompte ${deposit.number} déjà facturé`, 1, 'flat', -3610, 5.5),
      line(`Acompte ${deposit.number} déjà facturé`, 1, 'flat', -52500, 20),
    ])
    // 5,5 % : 8 423, TVA 463,265 → 463 ; 20 % : 122 500, TVA 24 500.
    expect(balance).toMatchObject({ total_ht_cents: 130923, total_vat_cents: 24963, total_ttc_cents: 155886 })
    expect(balance.total_ttc_cents).toBe(222695 - 66809)
    const issued = await issue(balance.id)
    expect(issued).toMatchObject({ status: 'issued', total_ttc_cents: 155886 })

    // Total à zéro : permis. Total HT (ou TTC) négatif : refusé, à la création comme en modification.
    await newInvoice(null, 'invoice', [line('Forfait', 1, 'flat', 1000, 20), line('Déduction', 1, 'flat', -1000, 20)])
    const negative = [line('Forfait', 1, 'flat', 1000, 20), line('Déduction', 1, 'flat', -1001, 20)]
    await expectCode(newInvoice(null, 'invoice', negative), '23514', /Le total d'une facture ne peut pas être négatif : crée un avoir\./)
    await expectCode(
      newInvoice(null, 'invoice', [line('Sans TVA', 1, 'flat', 1000, 0), line('Déduction', 1, 'flat', -900, 20)]), // HT 1 €, TTC -0,80 €
      '23514',
      /ne peut pas être négatif/,
    )
    const draft = await newInvoice()
    await expectCode(
      q(FIN_A, `update public.invoices set lines = $2::jsonb where id = $1`, [draft.id, JSON.stringify(negative)]),
      '23514',
      /ne peut pas être négatif/,
    )

    // Acompte : jamais de prix négatif, même avec un total positif.
    await expectCode(
      newInvoice(null, 'deposit', [line('Acompte', 1, 'flat', 5000, 20), line('Déduction', 1, 'flat', -100, 20)]),
      '23514',
      /Ligne 2 : le prix unitaire ne peut pas être négatif/,
    )

    // L'avoir d'une facture de solde inverse aussi les déductions.
    const [credit] = await q<Doc & { lines: { unit_price_cents: number }[] }>(
      FIN_A,
      `select * from public.create_credit_note($1)`,
      [balance.id],
    )
    expect(credit?.lines.map((l) => l.unit_price_cents)).toEqual([-50000, -12033, 3610, 52500])
    expect(credit?.total_ttc_cents).toBe(-155886)
  })

  it('une facture émise est figée, mais passe de émise à payée et retour', async () => {
    const invoice = await issue((await newInvoice()).id)
    const changes = [
      `lines = '[]'::jsonb`,
      `client_id = '${CLIENT_A_NONE}'`,
      `total_ht_cents = 1`,
      `title = 'Changé'`,
      `number = 'F-2026-0042'`,
      `due_date = due_date + 10`,
    ]
    for (const change of changes) {
      await expectCode(q(FIN_A, `update public.invoices set ${change} where id = $1`, [invoice.id]), 'P0001', /avoir/)
    }
    // Même en service_role.
    await expectCode(q('service_role', `update public.invoices set title = 'X' where id = $1`, [invoice.id]), 'P0001')

    const [paid] = await q<{ status: string; paid_at: string | null }>(
      FIN_A,
      `update public.invoices set status = 'paid' where id = $1 returning status, paid_at`,
      [invoice.id],
    )
    expect(paid?.paid_at).not.toBeNull()
    const [back] = await q<{ status: string; paid_at: string | null }>(
      FIN_A,
      `update public.invoices set status = 'issued' where id = $1 returning status, paid_at`,
      [invoice.id],
    )
    expect(back).toEqual({ status: 'issued', paid_at: null })

    await expectCode(q(FIN_A, `update public.invoices set status = 'cancelled' where id = $1`, [invoice.id]), 'P0001', /avoir/)
    await expectCode(q(FIN_A, `update public.invoices set status = 'draft' where id = $1`, [invoice.id]), 'P0001')
    await expectCode(q(FIN_A, `delete from public.invoices where id = $1`, [invoice.id]), 'P0001', /brouillon/)
    await expectCode(q('service_role', `delete from public.invoices where id = $1`, [invoice.id]), 'P0001')
  })
})

describe('0004 : statut automatique du projet', () => {
  it('devis envoyé → devis envoyé, devis accepté → en cours', async () => {
    const project = await newProject('prospect')
    const quote = await newQuote(FIN_A, project)
    await q(FIN_A, `update public.quotes set status = 'sent' where id = $1`, [quote.id])
    expect(await projectStatus(project)).toBe('quote_sent')
    await q(FIN_A, `update public.quotes set status = 'accepted' where id = $1`, [quote.id])
    expect(await projectStatus(project)).toBe('in_progress')
  })

  it('jamais vers l’arrière, jamais sur un projet archivé', async () => {
    for (const status of ['delivered', 'paid', 'archived']) {
      const project = await newProject(status)
      const quote = await newQuote(FIN_A, project)
      await q(FIN_A, `update public.quotes set status = 'sent' where id = $1`, [quote.id])
      await q(FIN_A, `update public.quotes set status = 'accepted' where id = $1`, [quote.id])
      expect(await projectStatus(project), status).toBe(status)
    }
    // Devis envoyé sur un projet déjà en cours : il y reste.
    const inProgress = await newProject('in_progress')
    await q(FIN_A, `update public.quotes set status = 'sent' where id = $1`, [(await newQuote(FIN_A, inProgress)).id])
    expect(await projectStatus(inProgress)).toBe('in_progress')

    const archived = await newProject('archived')
    const invoice = await issue((await newInvoice(archived)).id)
    await q(FIN_A, `update public.invoices set status = 'paid' where id = $1`, [invoice.id])
    expect(await projectStatus(archived)).toBe('archived')
  })

  it('payé quand toutes les factures (hors acomptes et avoirs, non annulées) le sont', async () => {
    const project = await newProject('delivered')
    const deposit = await issue((await newInvoice(project, 'deposit')).id)
    await q(FIN_A, `update public.invoices set status = 'paid' where id = $1`, [deposit.id])
    expect(await projectStatus(project)).toBe('delivered') // un acompte seul ne suffit pas

    const a = await issue((await newInvoice(project)).id)
    const b = await issue((await newInvoice(project)).id)
    await q(FIN_A, `update public.invoices set status = 'paid' where id = $1`, [a.id])
    expect(await projectStatus(project)).toBe('delivered')
    await q(FIN_A, `update public.invoices set status = 'paid' where id = $1`, [b.id])
    expect(await projectStatus(project)).toBe('paid')
  })

  it('payé avec acompte puis facture de solde : seulement quand le solde est payé', async () => {
    const project = await newProject('in_progress')
    const deposit = await issue((await newInvoice(project, 'deposit', [line('Acompte', 1, 'flat', 30000, 20)])).id)
    await q(FIN_A, `update public.invoices set status = 'paid' where id = $1`, [deposit.id])
    expect(await projectStatus(project)).toBe('in_progress')

    const balance = await issue(
      (
        await newInvoice(project, 'invoice', [
          line('Prestation', 1, 'flat', 100000, 20),
          line(`Acompte ${deposit.number} déjà facturé`, 1, 'flat', -30000, 20),
        ])
      ).id,
    )
    expect(balance.total_ttc_cents).toBe(84000)
    expect(await projectStatus(project)).toBe('in_progress')
    await q(FIN_A, `update public.invoices set status = 'paid' where id = $1`, [balance.id])
    expect(await projectStatus(project)).toBe('paid')
  })

  it('une facture annulée par un avoir ne bloque plus le passage à payé', async () => {
    const project = await newProject('in_progress')
    const a = await issue((await newInvoice(project)).id)
    const b = await issue((await newInvoice(project)).id)
    await q(FIN_A, `update public.invoices set status = 'paid' where id = $1`, [a.id])
    expect(await projectStatus(project)).toBe('in_progress')
    await q(FIN_A, `select public.create_credit_note($1)`, [b.id])
    expect(await projectStatus(project)).toBe('paid')
  })
})

describe('0004 : prospection', () => {
  async function newProspect(who = PROSP_A, extra: Record<string, string> = {}) {
    const fields = { company: 'Acme', contact_name: 'Alice Martin', contact_email: 'alice@acme.test', ...extra }
    const keys = Object.keys(fields)
    const [row] = await q<Record<string, string | null>>(
      who,
      `insert into public.prospects (organization_id, ${keys.join(', ')})
       values ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) returning *`,
      [ORG_A, ...Object.values(fields)],
    )
    return row!
  }

  it('prospection crée, lit et modifie ses prospects, sans les supprimer', async () => {
    const prospect = await newProspect(PROSP_A, { website: 'https://acme.test', contact_phone: '0102030405' })
    // 0014 : un prospect de l'apporteur commence « À auditer ».
    expect(prospect).toMatchObject({ stage: 'to_audit', created_by: PROSP_A.member, owner_member_id: PROSP_A.member })
    await q(ADMIN_A1, `update public.prospects set stage = 'offer_ready' where id = $1`, [prospect.id])

    const [updated] = await q<{ stage: string; next_action_date: string }>(
      PROSP_A,
      `update public.prospects set stage = 'contacted', next_action_date = '2026-12-01'
       where id = $1 returning stage, next_action_date::text`,
      [prospect.id],
    )
    expect(updated).toEqual({ stage: 'contacted', next_action_date: '2026-12-01' })
    expect(await count(ADMIN_A1, 'public.prospects')).toBe(1)

    await expectCode(q(PROSP_A, `delete from public.prospects where id = $1`, [prospect.id]), '42501')
    await expectCode(q(PROSP_A, `update public.prospects set client_id = $2 where id = $1`, [prospect.id, CLIENT_A_FULL]), '42501')
    await expectCode(q(PROSP_A, `update public.prospects set stage = 'gagné' where id = $1`, [prospect.id]), '23514')
    // 0014 : l'apporteur ne change pas le responsable (la commission en dépend).
    await expectCode(
      q(PROSP_A, `update public.prospects set owner_member_id = $2 where id = $1`, [prospect.id, ADMIN_A1.member]),
      '42501',
    )
    await expectCode(
      q(ADMIN_A1, `update public.prospects set owner_member_id = $2 where id = $1`, [prospect.id, ADMIN_B.member]),
      '23514',
    )
  })

  it('won_at suit le passage en « gagné » et ne peut pas être forcé', async () => {
    // Admin : l'apporteur ne démarche pas avant l'audit (0014).
    const prospect = await newProspect(ADMIN_A1)
    expect(prospect.won_at).toBeNull()
    await expectCode(q(PROSP_A, `update public.prospects set won_at = now() where id = $1`, [prospect.id]), '42501')
    await expectCode(q(ADMIN_A1, `update public.prospects set won_at = now() where id = $1`, [prospect.id]), '42501')

    const [won] = await q<{ won_at: string | null }>(
      ADMIN_A1,
      `update public.prospects set stage = 'won' where id = $1 returning won_at`,
      [prospect.id],
    )
    expect(won?.won_at).not.toBeNull()
    // Autre modification sans changer d'étape : la date reste.
    const [kept] = await q<{ won_at: string | null }>(
      ADMIN_A1,
      `update public.prospects set notes = 'Signé' where id = $1 returning won_at`,
      [prospect.id],
    )
    expect(kept?.won_at).toEqual(won?.won_at)
    const [lost] = await q<{ won_at: string | null }>(
      ADMIN_A1,
      `update public.prospects set stage = 'lost' where id = $1 returning won_at`,
      [prospect.id],
    )
    expect(lost?.won_at).toBeNull()

    const [direct] = await q<{ won_at: string | null }>(
      ADMIN_A1,
      `insert into public.prospects (organization_id, company, stage) values ($1, 'Déjà gagné', 'won') returning won_at`,
      [ORG_A],
    )
    expect(direct?.won_at).not.toBeNull()
  })

  it('finance et une autre organisation ne voient pas les prospects ; le membre si (audit, 0014)', async () => {
    await newProspect()
    for (const who of [FIN_A, ADMIN_B]) {
      expect(await count(who, 'public.prospects')).toBe(0)
    }
    expect(await count(MEMBRE_A, 'public.prospects')).toBe(1)
    await expectCode(newProspect(FIN_A), '42501')
  })

  it('conversion idempotente : client + contact principal, prospect gagné', async () => {
    const prospect = await newProspect(PROSP_A, { website: 'https://acme.test', notes: 'Salon', contact_phone: '0102' })
    await q(ADMIN_A1, `update public.prospects set stage = 'offer_ready' where id = $1`, [prospect.id]) // audit fait (0014)
    const clientsBefore = await count('postgres', 'public.clients')

    const [{ client_id: clientId }] = (await q<{ client_id: string }>(
      PROSP_A,
      `select public.convert_prospect($1) as client_id`,
      [prospect.id],
    )) as [{ client_id: string }]
    const [again] = await q<{ client_id: string }>(ADMIN_A1, `select public.convert_prospect($1) as client_id`, [prospect.id])
    expect(again?.client_id).toBe(clientId)
    expect(await count('postgres', 'public.clients')).toBe(clientsBefore + 1)

    const [client] = await q<Record<string, unknown>>(
      ADMIN_A1,
      `select organization_id, name, website, notes from public.clients where id = $1`,
      [clientId],
    )
    expect(client).toEqual({ organization_id: ORG_A, name: 'Acme', website: 'https://acme.test', notes: 'Salon' })
    const contacts = await q<Record<string, unknown>>(
      ADMIN_A1,
      `select name, email, phone, is_primary from public.client_contacts where client_id = $1`,
      [clientId],
    )
    expect(contacts).toEqual([{ name: 'Alice Martin', email: 'alice@acme.test', phone: '0102', is_primary: true }])

    const [after] = await q<{ stage: string; client_id: string }>(
      PROSP_A,
      `select stage, client_id from public.prospects where id = $1`,
      [prospect.id],
    )
    expect(after).toEqual({ stage: 'won', client_id: clientId })
    const [wonAt] = await q<{ won_at: string | null }>(PROSP_A, `select won_at from public.prospects where id = $1`, [prospect.id])
    expect(wonAt?.won_at).not.toBeNull()

    // prospection ne lit pas le client créé.
    expect(await q(PROSP_A, `select id from public.clients where id = $1`, [clientId])).toEqual([])
  })

  it('conversion sans contact, et refusée sans droit', async () => {
    const bare = await newProspect(PROSP_A, { contact_name: '', contact_email: '' })
    const [{ client_id: clientId }] = (await q<{ client_id: string }>(
      ADMIN_A1,
      `select public.convert_prospect($1) as client_id`,
      [bare.id],
    )) as [{ client_id: string }]
    expect(await count(ADMIN_A1, `public.client_contacts where client_id = '${clientId}'`)).toBe(0)

    const other = await newProspect()
    await expectCode(q(FIN_A, `select public.convert_prospect($1)`, [other.id]), '42501')
    await expectCode(q(ADMIN_B, `select public.convert_prospect($1)`, [other.id]), '42501')
  })

  it('0017 : conversion par un membre, projet créé une fois ; l\'apporteur limité à ses prospects', async () => {
    const mine = await newProspect(PROSP_A)
    const notMine = await newProspect(ADMIN_A1) // ni créé par l'apporteur ni à lui
    await expectCode(q(PROSP_A, `select public.convert_prospect($1)`, [notMine.id]), '42501', /apporteur/)

    const [{ client_id: clientId }] = (await q<{ client_id: string }>(
      MEMBRE_A,
      `select public.convert_prospect($1, $2) as client_id`,
      [mine.id, 'Site vitrine Acme'],
    )) as [{ client_id: string }]
    const projects = await q<{ name: string; status: string }>(
      'postgres',
      `select name, status from public.projects where client_id = $1`,
      [clientId],
    )
    expect(projects).toEqual([{ name: 'Site vitrine Acme', status: 'prospect' }])
    await q(MEMBRE_A, `select public.convert_prospect($1)`, [mine.id])
    expect(await count('postgres', `public.projects where client_id = '${clientId}'`)).toBe(1)
  })
})

describe('0004 : statut de connexion des membres', () => {
  it('un admin voit qui s’est déjà connecté ; un non-admin est refusé', async () => {
    await q('postgres', `update auth.users set last_sign_in_at = now() where id = $1`, [ADMIN_A1.user])
    const rows = await q<{ member_id: string; signed_in: boolean }>(
      ADMIN_A1,
      `select * from public.member_sign_in_status($1)`,
      [ORG_A],
    )
    const status = Object.fromEntries(rows.map((r) => [r.member_id, r.signed_in]))
    expect(rows).toHaveLength(7)
    expect(status[ADMIN_A1.member]).toBe(true)
    expect(status[MEMBRE_A.member]).toBe(false) // compte relié, jamais connecté
    expect(status[INVITED_A.member]).toBe(false) // pas de compte relié

    await expectCode(q(MEMBRE_A, `select * from public.member_sign_in_status($1)`, [ORG_A]), '42501', /Réservé aux admins/)
    await expectCode(q(FIN_A, `select * from public.member_sign_in_status($1)`, [ORG_A]), '42501')
    await expectCode(q(ADMIN_B, `select * from public.member_sign_in_status($1)`, [ORG_A]), '42501')
    await expectCode(q('anon', `select * from public.member_sign_in_status($1)`, [ORG_A]), '42501')
  })
})
