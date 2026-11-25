/**
 * Tests de la migration 0005 : émetteurs de facturation (droits, défaut unique), émetteur des devis et
 * factures, numérotation AAAA-NNN par émetteur qui continue après les numéros importés, vendeur copié
 * depuis l'émetteur, avoir dans la série de l'émetteur, import des documents historiques réservé au serveur.
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
  ORG_B,
  PROSP_A,
  count,
  expectCode,
  person,
  q,
  setupDatabase,
} from './harness'

const FIN_A = person(6, 'a', 'finance@a.test')
const SACHA = 'a0000000-0000-4000-8000-000000000601' // émetteur par défaut de A
const MAEL = 'a0000000-0000-4000-8000-000000000602'
const OLD = 'a0000000-0000-4000-8000-000000000603' // archivé
const ISSUER_B = 'b0000000-0000-4000-8000-000000000601'

setupDatabase(`
  insert into auth.users (id, email, email_confirmed_at) values ('${FIN_A.user}', '${FIN_A.email}', now());
  insert into public.members (id, organization_id, user_id, name, email, role)
    values ('${FIN_A.member}', '${ORG_A}', '${FIN_A.user}', 'Finance A', '${FIN_A.email}', 'finance');

  update public.organizations
  set legal_name = 'Sordulo SAS', siret = '73282932000074', address_city = 'Paris', bank_iban = 'FR76 ORG'
  where id = '${ORG_A}';

  insert into public.billing_issuers (id, organization_id, member_id, display_name, legal_name, legal_form, siret,
    address_street, address_postal_code, address_city, address_country, vat_mention, vat_number, bank_iban, bank_bic,
    email, phone, is_default, archived_at) values
    ('${SACHA}', '${ORG_A}', '${ADMIN_A2.member}', 'Sacha Moricet EI', 'Sacha Moricet', 'EI', '11111111100011',
     '1 rue A', '75001', 'Paris', 'France', 'TVA non applicable, art. 293 B du CGI', null, 'FR76 SACHA', 'BICSACHA',
     'sacha@sordulo.test', '0600000001', true, null),
    ('${MAEL}', '${ORG_A}', '${ADMIN_A1.member}', 'Maël Auzenet EI', 'Maël Auzenet', 'EI', '22222222200022',
     '2 rue B', '69001', 'Lyon', 'France', 'TVA non applicable, art. 293 B du CGI', 'FR00222222222', 'FR76 MAEL', 'BICMAEL',
     'mael@sordulo.test', '0600000002', false, null),
    ('${OLD}', '${ORG_A}', null, 'Ancienne micro', null, null, null, null, null, null, null, null, null, null, null,
     null, null, false, now()),
    ('${ISSUER_B}', '${ORG_B}', null, 'Émetteur B', null, null, null, null, null, null, null, null, null, null, null,
     null, null, true, null);
`)

const LINES = JSON.stringify([
  { label: 'Design', description: null, quantity: 2, unit: 'day', unit_price_cents: 50000, vat_rate: 0 },
])

interface Doc {
  id: string
  number: string | null
  status: string
  issuer_id: string | null
  seller: Record<string, unknown> | null
  buyer: Record<string, unknown> | null
  total_ht_cents: number
  total_ttc_cents: number
  [key: string]: unknown
}

const parisYear = async () =>
  (await q<{ y: number }>('postgres', `select extract(year from (now() at time zone 'Europe/Paris'))::int as y`))[0]!.y

async function newInvoice(issuerId: string | null = null, extra: { quoteId?: string; who?: typeof FIN_A } = {}) {
  const [row] = await q<Doc>(
    extra.who ?? FIN_A,
    `insert into public.invoices (client_id, quote_id, issuer_id, title, lines)
     values ($1, $2, $3, 'Facture', $4::jsonb) returning *`,
    [CLIENT_A_FULL, extra.quoteId ?? null, issuerId, LINES],
  )
  return row!
}

async function newQuote(issuerId: string | null = null, issueDate: string | null = null) {
  const [row] = await q<Doc>(
    FIN_A,
    `insert into public.quotes (client_id, issuer_id, title, issue_date, lines)
     values ($1, $2, 'Devis', coalesce($3::date, (now() at time zone 'Europe/Paris')::date), $4::jsonb) returning *`,
    [CLIENT_A_FULL, issuerId, issueDate, LINES],
  )
  return row!
}

const issue = async (id: string, who = FIN_A) =>
  (await q<Doc>(who, `select * from public.issue_invoice($1)`, [id]))[0]!

const creditNote = async (id: string) =>
  (await q<Doc>(FIN_A, `select * from public.create_credit_note($1)`, [id]))[0]!

async function newProject(status: string) {
  const [row] = await q<{ id: string }>(
    'postgres',
    `insert into public.projects (organization_id, client_id, name, status) values ($1, $2, 'Projet', $3) returning id`,
    [ORG_A, CLIENT_A_FULL, status],
  )
  return row!.id
}

const projectStatus = async (id: string) =>
  (await q<{ status: string }>('postgres', `select status from public.projects where id = $1`, [id]))[0]!.status

/** Active l'import pour le reste de la transaction du test (set local). */
const startImport = (who: 'postgres' | 'service_role' | typeof FIN_A = 'postgres') =>
  q(who, `select set_config('sordulo.import', 'on', true)`)

describe('0005 : schéma', () => {
  it('a les colonnes de src/shared/types.ts', async () => {
    const rows = await q<{ column_name: string }>(
      'postgres',
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'billing_issuers'`,
    )
    expect(rows.map((r) => r.column_name).sort()).toEqual(
      [
        'id', 'organization_id', 'member_id', 'display_name', 'legal_name', 'legal_form', 'siret', 'address_street',
        'address_postal_code', 'address_city', 'address_country', 'vat_mention', 'vat_number', 'bank_iban', 'bank_bic',
        'email', 'phone', 'is_default', 'archived_at', 'created_at', 'updated_at',
      ].sort(),
    )
  })

  it('lit l’année et le rang de tous les formats de numéro', async () => {
    const cases: [string, number | null, number | null][] = [
      ['2026_001', 2026, 1],
      ['2026-001', 2026, 1],
      ['2026-02', 2026, 2],
      ['2026_011', 2026, 11],
      ['F-2026-0001', 2026, 1],
      ['D-2026-001', 2026, 1],
      ['A-2026-0012', 2026, 12],
      [' 2027-1000 ', 2027, 1000],
      ['Facture 12', null, null],
      ['', null, null],
    ]
    for (const [number, year, seq] of cases) {
      const [row] = await q<{ year: number | null; seq: number | null }>(
        'postgres',
        `select * from private.parse_document_number($1)`,
        [number],
      )
      expect(row, number).toEqual({ year, seq })
    }
  })
})

describe('0005 : droits sur les émetteurs', () => {
  it('admin et finance lisent les émetteurs de leur organisation ; membre et prospection non', async () => {
    expect(await count(FIN_A, 'public.billing_issuers')).toBe(3)
    expect(await count(ADMIN_A1, 'public.billing_issuers')).toBe(3)
    expect(await count(ADMIN_B, 'public.billing_issuers')).toBe(1)
    expect(await count(MEMBRE_A, 'public.billing_issuers')).toBe(0)
    expect(await count(PROSP_A, 'public.billing_issuers')).toBe(0)
    await expectCode(q('anon', `select * from public.billing_issuers`), '42501')
  })

  it('finance n’écrit pas ; admin crée, modifie et archive, sans supprimer', async () => {
    await expectCode(
      q(FIN_A, `insert into public.billing_issuers (organization_id, display_name) values ($1, 'X')`, [ORG_A]),
      '42501',
    )
    expect(await q(FIN_A, `update public.billing_issuers set display_name = 'X' where id = $1 returning id`, [MAEL])).toEqual([])

    const [created] = await q<{ id: string; is_default: boolean }>(
      ADMIN_A1,
      `insert into public.billing_issuers (organization_id, display_name, siret) values ($1, 'Nouvelle EI', '33333333300033')
       returning id, is_default`,
      [ORG_A],
    )
    expect(created?.is_default).toBe(false)
    const [archived] = await q<{ archived_at: string | null }>(
      ADMIN_A2,
      `update public.billing_issuers set display_name = 'Nouvelle EI (fermée)', archived_at = now() where id = $1
       returning archived_at`,
      [created!.id],
    )
    expect(archived?.archived_at).not.toBeNull()

    await expectCode(q(ADMIN_A1, `delete from public.billing_issuers where id = $1`, [created!.id]), '42501')
    await expectCode(q('service_role', `delete from public.billing_issuers where id = $1`, [created!.id]), '42501')
    // Autre organisation, SIRET invalide, membre d'une autre organisation, organisation modifiée.
    await expectCode(
      q(ADMIN_A1, `insert into public.billing_issuers (organization_id, display_name) values ($1, 'X')`, [ORG_B]),
      '42501',
    )
    await expectCode(
      q(ADMIN_A1, `insert into public.billing_issuers (organization_id, display_name, siret) values ($1, 'X', '123')`, [ORG_A]),
      '23514',
    )
    await expectCode(
      q(ADMIN_A1, `insert into public.billing_issuers (organization_id, display_name) values ($1, ' ')`, [ORG_A]),
      '23514',
    )
    await expectCode(
      q(ADMIN_A1, `update public.billing_issuers set member_id = $2 where id = $1`, [MAEL, ADMIN_B.member]),
      '23514',
      /membre relié/,
    )
    await expectCode(q(ADMIN_A1, `update public.billing_issuers set organization_id = $2 where id = $1`, [MAEL, ORG_B]), '42501')
    expect(await q(ADMIN_B, `update public.billing_issuers set display_name = 'X' where id = $1 returning id`, [MAEL])).toEqual([])
  })

  it('un seul émetteur par défaut, jamais archivé', async () => {
    await expectCode(q(ADMIN_A1, `update public.billing_issuers set is_default = true where id = $1`, [MAEL]), '23505')
    await expectCode(
      q(ADMIN_A1, `insert into public.billing_issuers (organization_id, display_name, is_default) values ($1, 'X', true)`, [ORG_A]),
      '23505',
    )
    await expectCode(
      q(ADMIN_A1, `update public.billing_issuers set archived_at = now() where id = $1`, [SACHA]),
      '23514',
      /par défaut ne peut pas être archivé/,
    )
    // Changer de défaut : l'ancien d'abord, puis le nouveau.
    await q(ADMIN_A1, `update public.billing_issuers set is_default = false where id = $1`, [SACHA])
    await q(ADMIN_A1, `update public.billing_issuers set is_default = true where id = $1`, [MAEL])
    const rows = await q<{ id: string }>(ADMIN_A1, `select id from public.billing_issuers where is_default`)
    expect(rows).toEqual([{ id: MAEL }])
    // Une autre organisation a son propre défaut.
    expect(await count(ADMIN_B, 'public.billing_issuers where is_default')).toBe(1)
  })
})

describe('0005 : émetteur des devis et factures', () => {
  it('par défaut : l’émetteur par défaut, ou celui du devis d’origine', async () => {
    expect((await newQuote()).issuer_id).toBe(SACHA)
    expect((await newInvoice()).issuer_id).toBe(SACHA)
    expect((await newInvoice(MAEL)).issuer_id).toBe(MAEL)

    const maelQuote = await newQuote(MAEL)
    expect(maelQuote.issuer_id).toBe(MAEL)
    expect((await newInvoice(null, { quoteId: maelQuote.id })).issuer_id).toBe(MAEL)

    // Sans émetteur par défaut : l'organisation émet (null).
    await q('postgres', `update public.billing_issuers set is_default = false where id = $1`, [SACHA])
    expect((await newInvoice()).issuer_id).toBeNull()
  })

  it('refuse un émetteur d’une autre organisation ou archivé ; modifiable sur un brouillon, figé ensuite', async () => {
    await expectCode(newInvoice(ISSUER_B), '23514', /organisation du document/)
    await expectCode(newQuote(ISSUER_B), '23514', /organisation du document/)
    await expectCode(newInvoice(OLD), '23514', /archivé/)
    await expectCode(newQuote(OLD), '23514', /archivé/)

    const draft = await newInvoice()
    const [changed] = await q<Doc>(FIN_A, `update public.invoices set issuer_id = $2 where id = $1 returning *`, [draft.id, MAEL])
    expect(changed?.issuer_id).toBe(MAEL)
    await expectCode(q(FIN_A, `update public.invoices set issuer_id = $2 where id = $1`, [draft.id, ISSUER_B]), '23514')
    await expectCode(q(FIN_A, `update public.invoices set issuer_id = $2 where id = $1`, [draft.id, OLD]), '23514', /archivé/)

    const quote = await newQuote()
    await q(FIN_A, `update public.quotes set issuer_id = $2 where id = $1`, [quote.id, MAEL])
    await expectCode(q(FIN_A, `update public.quotes set issuer_id = $2 where id = $1`, [quote.id, ISSUER_B]), '23514')

    const issued = await issue(draft.id)
    await expectCode(
      q(FIN_A, `update public.invoices set issuer_id = $2 where id = $1`, [issued.id, SACHA]),
      'P0001',
      /avoir/,
    )
    await q(FIN_A, `update public.quotes set status = 'accepted' where id = $1`, [quote.id])
    await expectCode(q(FIN_A, `update public.quotes set issuer_id = $2 where id = $1`, [quote.id, SACHA]), 'P0001')
  })

  it('émission refusée si l’émetteur a été archivé depuis le brouillon', async () => {
    const draft = await newInvoice(MAEL)
    await q(ADMIN_A1, `update public.billing_issuers set archived_at = now() where id = $1`, [MAEL])
    await expectCode(issue(draft.id), 'P0001', /archivé/)
  })
})

describe('0005 : numérotation et vendeur', () => {
  it('deux séries de factures indépendantes ; l’avoir reste dans celle de son émetteur', async () => {
    const year = await parisYear()
    const s1 = await issue((await newInvoice(SACHA)).id)
    const m1 = await issue((await newInvoice(MAEL)).id)
    const s2 = await issue((await newInvoice(SACHA)).id)
    const m2 = await issue((await newInvoice(MAEL)).id, ADMIN_A1)
    expect([s1.number, m1.number, s2.number, m2.number]).toEqual([
      `${year}-001`,
      `${year}-001`,
      `${year}-002`,
      `${year}-002`,
    ])

    const credit = await creditNote(m1.id)
    expect(credit).toMatchObject({
      kind: 'credit_note',
      number: `${year}-003`,
      issuer_id: MAEL,
      title: `Avoir sur ${year}-001`,
    })
    expect(credit.seller).toEqual(m1.seller)
    // Acompte : même série que les factures de l'émetteur.
    const [deposit] = await q<Doc>(
      FIN_A,
      `insert into public.invoices (client_id, issuer_id, kind, title, lines) values ($1, $2, 'deposit', 'Acompte', $3::jsonb)
       returning *`,
      [CLIENT_A_FULL, SACHA, LINES],
    )
    expect((await issue(deposit!.id)).number).toBe(`${year}-003`)

    const counters = await q<{ series: string; last_value: number }>(
      'postgres',
      `select series, last_value from public.document_counters where organization_id = $1 and year = $2 order by series`,
      [ORG_A, year],
    )
    expect(counters).toEqual([
      { series: `invoice:${SACHA}`, last_value: 3 },
      { series: `invoice:${MAEL}`, last_value: 3 },
    ].sort((a, b) => a.series.localeCompare(b.series, 'en')))
  })

  it('devis : AAAA-NNN, série de l’organisation quel que soit l’émetteur', async () => {
    expect((await newQuote(SACHA, '2026-03-01')).number).toBe('2026-001')
    expect((await newQuote(MAEL, '2026-03-02')).number).toBe('2026-002')
    expect((await newQuote(null, '2027-01-05')).number).toBe('2027-001')
  })

  it('le vendeur est copié depuis l’émetteur, ou depuis l’organisation sans émetteur', async () => {
    const issued = await issue((await newInvoice(MAEL)).id)
    expect(issued.seller).toEqual({
      name: 'Maël Auzenet EI',
      legal_name: 'Maël Auzenet',
      legal_form: 'EI',
      siret: '22222222200022',
      address_street: '2 rue B',
      address_postal_code: '69001',
      address_city: 'Lyon',
      address_country: 'France',
      vat_mention: 'TVA non applicable, art. 293 B du CGI',
      vat_number: 'FR00222222222',
      bank_iban: 'FR76 MAEL',
      bank_bic: 'BICMAEL',
      email: 'mael@sordulo.test',
      phone: '0600000002',
    })
    expect(issued.buyer).toMatchObject({ name: 'Ibé' })

    // Changement ultérieur de l'émetteur : la facture émise ne bouge pas.
    await q(ADMIN_A1, `update public.billing_issuers set address_city = 'Nantes' where id = $1`, [MAEL])
    const [still] = await q<{ city: string }>('postgres', `select seller ->> 'address_city' as city from public.invoices where id = $1`, [issued.id])
    expect(still?.city).toBe('Lyon')

    const draft = await newInvoice()
    await q(FIN_A, `update public.invoices set issuer_id = null where id = $1`, [draft.id])
    const orgIssued = await issue(draft.id)
    expect(orgIssued.issuer_id).toBeNull()
    expect(orgIssued.seller).toMatchObject({
      name: 'Sordulo',
      legal_name: 'Sordulo SAS',
      siret: '73282932000074',
      bank_iban: 'FR76 ORG',
      vat_number: null,
      email: null,
      phone: null,
    })
    // Avoir d'une facture sans émetteur : reste sans émetteur, même s'il existe un émetteur par défaut.
    const credit = await creditNote(orgIssued.id)
    expect(credit.issuer_id).toBeNull()
    expect(credit.seller).toEqual(orgIssued.seller)
  })
})

describe('0005 : import des documents historiques', () => {
  it('facture importée : numéro, statut, dates, vendeur gardés ; la série de l’émetteur continue', async () => {
    const year = await parisYear()
    await startImport()
    const [imported] = await q<Doc>(
      'postgres',
      `insert into public.invoices (client_id, issuer_id, status, number, title, issue_date, due_date, issued_at, paid_at,
         lines, seller, buyer, total_ttc_cents)
       values ($1, $2, 'paid', $3, 'Import', $4::date, $4::date + 30, $4::date, $4::date + 10, $5::jsonb,
         '{"name": "Maël Auzenet EI (2026)"}'::jsonb, '{"name": "Ibé (2026)"}'::jsonb, 1)
       returning *, issue_date::text as issue_date_text, paid_at is not null as has_paid_at`,
      [CLIENT_A_FULL, MAEL, `${year}_001`, `${year}-01-15`, LINES],
    )
    expect(imported).toMatchObject({
      number: `${year}_001`,
      status: 'paid',
      issuer_id: MAEL,
      issue_date_text: `${year}-01-15`,
      has_paid_at: true,
      seller: { name: 'Maël Auzenet EI (2026)' },
      buyer: { name: 'Ibé (2026)' },
      total_ht_cents: 100000, // recalculé
      total_ttc_cents: 100000,
    })

    // Ancien format F-AAAA-NNNN pour Sacha.
    await q(
      'postgres',
      `insert into public.invoices (client_id, issuer_id, status, number, title, issue_date, lines, seller, buyer)
       values ($1, $2, 'issued', $3, 'Import', $4::date, $5::jsonb, '{}'::jsonb, '{}'::jsonb)`,
      [CLIENT_A_FULL, SACHA, `F-${year}-0007`, `${year}-02-01`, LINES],
    )

    expect((await issue((await newInvoice(MAEL)).id)).number).toBe(`${year}-002`)
    expect((await issue((await newInvoice(SACHA)).id)).number).toBe(`${year}-008`)
    // Les numéros importés restent uniques dans la série de l'émetteur.
    await expectCode(
      q(
        'postgres',
        `insert into public.invoices (client_id, issuer_id, status, number, title, issue_date, lines, seller, buyer)
         values ($1, $2, 'issued', $3, 'Doublon', '2026-01-01', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
        [CLIENT_A_FULL, MAEL, `${year}-002`],
      ),
      '23505',
    )
  })

  it('devis importés « 2026_011 » et « 2026-02 » : le prochain devis est 2026-012 ; statut du projet fourni', async () => {
    const project = await newProject('prospect')
    await startImport()
    const [accepted] = await q<Record<string, unknown>>(
      'postgres',
      `insert into public.quotes (client_id, project_id, issuer_id, number, title, status, issue_date, sent_at, accepted_at, lines)
       values ($1, $2, $3, '2026_011', 'Import', 'accepted', '2026-02-10', '2026-02-10 10:00+01', '2026-02-20 10:00+01', $4::jsonb)
       returning number, status, issuer_id, accepted_at = '2026-02-20 10:00+01'::timestamptz as same_accepted_at, total_ht_cents`,
      [CLIENT_A_FULL, project, MAEL, LINES],
    )
    expect(accepted).toEqual({
      number: '2026_011',
      status: 'accepted',
      issuer_id: MAEL,
      same_accepted_at: true,
      total_ht_cents: 100000,
    })
    await q(
      'postgres',
      `insert into public.quotes (client_id, project_id, number, title, status, issue_date, lines)
       values ($1, $2, '2026-02', 'Import', 'sent', '2026-01-05', $3::jsonb)`,
      [CLIENT_A_FULL, project, LINES],
    )
    // Pendant l'import, le statut du projet n'est pas touché.
    expect(await projectStatus(project)).toBe('prospect')

    expect((await newQuote(null, '2026-06-01')).number).toBe('2026-012')
  })

  it('service_role importe aussi ; vendeur et acheteur complétés s’ils manquent', async () => {
    await startImport('service_role')
    const [imported] = await q<Doc>(
      'service_role',
      `insert into public.invoices (client_id, issuer_id, status, number, title, issue_date, lines)
       values ($1, $2, 'issued', '2026-02', 'Import', '2026-03-01', $3::jsonb) returning *`,
      [CLIENT_A_FULL, SACHA, LINES],
    )
    expect(imported).toMatchObject({ number: '2026-02', status: 'issued', issuer_id: SACHA })
    expect(imported!.seller).toMatchObject({ name: 'Sacha Moricet EI', siret: '11111111100011', email: 'sacha@sordulo.test' })
    expect(imported!.buyer).toMatchObject({ name: 'Ibé' })
  })

  it('0018 : import_document_from_file garde le numéro d’origine, réservé au serveur', async () => {
    const project = await newProject('prospect')
    const doc = (extra: Record<string, unknown>) =>
      JSON.stringify({ client_id: CLIENT_A_FULL, project_id: project, issuer_id: SACHA, lines: JSON.parse(LINES), ...extra })
    const [quote] = await q<{ id: string }>('service_role', `select public.import_document_from_file('quote', $1::jsonb) as id`, [
      doc({ number: 'DEV-2026-77', title: 'Refonte', status: 'accepted', issue_date: '2026-03-02' }),
    ])
    const [savedQuote] = await q<Record<string, unknown>>(
      'postgres',
      `select number, status, accepted_at is not null as accepted, total_ht_cents from public.quotes where id = $1`,
      [quote!.id],
    )
    expect(savedQuote).toEqual({ number: 'DEV-2026-77', status: 'accepted', accepted: true, total_ht_cents: 100000 })

    const [invoice] = await q<{ id: string }>('service_role', `select public.import_document_from_file('invoice', $1::jsonb) as id`, [
      doc({ number: '2026-031', status: 'paid', issue_date: '2026-03-10' }),
    ])
    const [savedInvoice] = await q<Record<string, unknown>>(
      'postgres',
      `select number, status, paid_at is not null as paid from public.invoices where id = $1`,
      [invoice!.id],
    )
    expect(savedInvoice).toEqual({ number: '2026-031', status: 'paid', paid: true })

    await expectCode(q(FIN_A, `select public.import_document_from_file('quote', $1::jsonb)`, [doc({ number: 'X-1' })]), '42501')
    await expectCode(
      q('service_role', `select public.import_document_from_file('quote', $1::jsonb)`, [doc({ number: '' })]),
      '23514',
    )
  })

  it('sans import, service_role ne crée pas de facture émise (0004 inchangé)', async () => {
    await expectCode(
      q(
        'service_role',
        `insert into public.invoices (client_id, status, number, title) values ($1, 'issued', '2026-900', 'X')`,
        [CLIENT_A_FULL],
      ),
      'P0001',
    )
  })

  it('un client authentifié qui active sordulo.import ne contourne rien', async () => {
    const project = await newProject('prospect')
    await startImport(FIN_A)
    const [flag] = await q<{ trusted: boolean; setting: string }>(
      FIN_A,
      `select private.is_trusted_import() as trusted, current_setting('sordulo.import') as setting`,
    )
    expect(flag).toEqual({ trusted: false, setting: 'on' })

    // Devis : le trigger (security definer) attribue le numéro et les dates, et fait avancer le projet.
    const [quote] = await q<Record<string, unknown>>(
      FIN_A,
      `insert into public.quotes (client_id, project_id, number, title, status, issue_date, accepted_at, lines)
       values ($1, $2, '2026_500', 'Pirate', 'accepted', '2026-04-01', '2020-01-01', $3::jsonb)
       returning number, accepted_at > now() - interval '1 hour' as accepted_now`,
      [CLIENT_A_FULL, project, LINES],
    )
    expect(quote).toEqual({ number: '2026-001', accepted_now: true })
    expect(await projectStatus(project)).toBe('in_progress')

    // Facture : jamais créée hors brouillon, numéro et vendeur ignorés.
    await expectCode(
      q(
        FIN_A,
        `insert into public.invoices (client_id, status, number, title, lines) values ($1, 'paid', '2026_900', 'Pirate', $2::jsonb)`,
        [CLIENT_A_FULL, LINES],
      ),
      'P0001',
    )
    // Émetteur archivé : refusé, même avec l'import activé.
    await expectCode(
      q(
        FIN_A,
        `insert into public.invoices (client_id, issuer_id, title, lines) values ($1, $2, 'Pirate', $3::jsonb)`,
        [CLIENT_A_FULL, OLD, LINES],
      ),
      '23514',
      /archivé/,
    )
    const [plain] = await q<Doc>(
      FIN_A,
      `insert into public.invoices (client_id, number, title, seller, lines)
       values ($1, '2026_900', 'Pirate', '{"name": "Faux"}'::jsonb, $2::jsonb) returning *`,
      [CLIENT_A_FULL, LINES],
    )
    expect(plain).toMatchObject({ number: null, seller: null, status: 'draft' })
    // Ni l'avoir à la main.
    await expectCode(
      q(
        FIN_A,
        `insert into public.invoices (client_id, kind, status, number, title, credited_invoice_id)
         values ($1, 'credit_note', 'issued', '2026_901', 'Pirate', $2)`,
        [CLIENT_A_FULL, plain!.id],
      ),
      'P0001',
    )
  })
})
