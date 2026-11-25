import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortalActionResponse, PortalResponse } from '../src/features/portal/portalContract.js'
import { resetPortalRateLimits } from './_lib/portal/handler.js'
import { createRateLimiter } from './_lib/portal/rateLimit.js'
import { computeProgress, memberDisplayName } from './_lib/portal/view.js'
import { FakeSupabase } from './_lib/testing/fake-supabase.js'

interface Rpc {
  name: string
  args: unknown
}

const state = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('./_lib/supabaseAdmin.js', () => ({ getSupabaseAdmin: () => state.client }))

const { GET, POST } = await import('./portal.js')

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444'
const CLIENT = '55555555-5555-4555-8555-555555555555'
const DELIVERABLE = '66666666-6666-4666-8666-666666666661'
const OTHER_DELIVERABLE = '66666666-6666-4666-8666-666666666662'
const V1 = '77777777-7777-4777-8777-777777777771'
const V2 = '77777777-7777-4777-8777-777777777772'
const OTHER_VERSION = '77777777-7777-4777-8777-777777777773'
const FILE1 = '88888888-8888-4888-8888-888888888881'
const FILE2 = '88888888-8888-4888-8888-888888888882'
const OTHER_FILE = '88888888-8888-4888-8888-888888888883'
const QUOTE_SENT = '99999999-9999-4999-8999-999999999991'
const QUOTE_DRAFT = '99999999-9999-4999-8999-999999999992'
const QUOTE_OTHER = '99999999-9999-4999-8999-999999999993'
const QUOTE_EXPIRED = '99999999-9999-4999-8999-999999999994'
const CONTRACT_SENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const CONTRACT_DRAFT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const CONTRACT_OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const MAEL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
const SACHA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const FINANCE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3'

const TOKEN = 'tok_' + 'A'.repeat(40)
const OTHER_TOKEN = 'tok_' + 'B'.repeat(40)
const APP = 'https://sordulo-os-app.vercel.app'

let db: FakeSupabase
let rpcs: Rpc[]
let signed: string[][]

function line(label: string) {
  return { label, description: null, quantity: 1, unit: 'flat', unit_price_cents: 100_000, vat_rate: 20, service_id: 'svc', rebilled: true }
}

function seed() {
  db.seed('organizations', [{ id: ORG, name: 'Sordulo' }])
  db.seed('clients', [{ id: CLIENT, organization_id: ORG, name: 'Ibé' }])
  db.seed('projects', [
    { id: PROJECT, organization_id: ORG, client_id: CLIENT, name: 'App Ibé', status: 'in_progress', start_date: '2026-10-01', due_date: '2027-01-15', portal_token: TOKEN, ai_instructions: 'interne' },
    { id: OTHER_PROJECT, organization_id: OTHER_ORG, client_id: null, name: 'Autre', status: 'in_progress', start_date: null, due_date: null, portal_token: OTHER_TOKEN },
  ])
  db.seed('members', [
    { id: MAEL, organization_id: ORG, name: 'Maël Auzenet', email: 'mael@sordulo.fr', role: 'admin' },
    { id: SACHA, organization_id: ORG, name: 'Sacha Moricet', email: 'sacha@sordulo.fr', role: 'membre' },
    { id: FINANCE, organization_id: ORG, name: 'Compta', email: 'compta@sordulo.fr', role: 'finance' },
  ])
  db.seed('project_members', [
    { project_id: PROJECT, member_id: SACHA },
    { project_id: PROJECT, member_id: FINANCE },
  ])
  db.seed('tasks', [
    { project_id: PROJECT, status: 'done', estimate_hours: 4, title: 'Interne' },
    { project_id: PROJECT, status: 'todo', estimate_hours: 2, title: 'Interne' },
    { project_id: OTHER_PROJECT, status: 'done' },
  ])
  db.seed('tickets', [
    { project_id: PROJECT, status: 'validated', area: 'Accueil' },
    { project_id: PROJECT, status: 'done', area: 'Accueil' },
    { project_id: PROJECT, status: 'proposed', area: 'Paiement' },
  ])
  db.seed('project_files', [
    { id: FILE1, project_id: PROJECT, organization_id: ORG, name: 'accueil-v1.png', mime_type: 'image/png', storage_path: `${ORG}/${PROJECT}/a-accueil-v1.png`, deleted_at: null },
    { id: FILE2, project_id: PROJECT, organization_id: ORG, name: 'accueil-v2.png', mime_type: 'image/png', storage_path: `${ORG}/${PROJECT}/b-accueil-v2.png`, deleted_at: null },
    { id: OTHER_FILE, project_id: OTHER_PROJECT, organization_id: OTHER_ORG, name: 'x.png', mime_type: 'image/png', storage_path: `${OTHER_ORG}/${OTHER_PROJECT}/x.png`, deleted_at: null },
  ])
  db.seed('deliverables', [
    { id: DELIVERABLE, organization_id: ORG, project_id: PROJECT, title: 'Accueil', description: null, status: 'in_review', position: 0 },
    { id: OTHER_DELIVERABLE, organization_id: OTHER_ORG, project_id: OTHER_PROJECT, title: 'Autre', description: null, status: 'in_review', position: 0 },
  ])
  db.seed('deliverable_versions', [
    { id: V1, deliverable_id: DELIVERABLE, version: 1, file_id: FILE1, note: null, status: 'changes_requested', decided_at: '2026-11-01T10:00:00Z', decided_by_name: 'Claire', created_at: '2026-10-20T10:00:00Z', created_by: SACHA },
    { id: V2, deliverable_id: DELIVERABLE, version: 2, file_id: FILE2, note: 'Couleurs corrigées', status: 'pending', decided_at: null, decided_by_name: null, created_at: '2026-11-20T10:00:00Z', created_by: SACHA },
    { id: OTHER_VERSION, deliverable_id: OTHER_DELIVERABLE, version: 1, file_id: OTHER_FILE, note: null, status: 'pending', decided_at: null, decided_by_name: null, created_at: '2026-11-20T10:00:00Z' },
  ])
  db.seed('deliverable_comments', [
    { id: crypto.randomUUID(), version_id: V1, x: 0.5, y: 0.25, body: 'Logo trop petit', author_member_id: null, author_name: 'Claire', from_client: true, resolved_at: '2026-11-02T10:00:00Z', created_at: '2026-10-21T10:00:00Z' },
    { id: crypto.randomUUID(), version_id: V1, x: null, y: null, body: 'Corrigé en V2', author_member_id: SACHA, author_name: null, from_client: false, resolved_at: null, created_at: '2026-10-22T10:00:00Z' },
  ])
  const quoteBase = { lines: [line('Design')], notes: null, total_ht_cents: 100_000, total_vat_cents: 20_000, total_ttc_cents: 120_000, accepted_at: null, issue_date: '2026-11-01' }
  db.seed('quotes', [
    { ...quoteBase, id: QUOTE_SENT, organization_id: ORG, project_id: PROJECT, number: '2026-010', title: 'Refonte', status: 'sent', valid_until: '2099-01-01' },
    { ...quoteBase, id: QUOTE_DRAFT, organization_id: ORG, project_id: PROJECT, number: '2026-011', title: 'Brouillon secret', status: 'draft', valid_until: '2099-01-01' },
    { ...quoteBase, id: QUOTE_EXPIRED, organization_id: ORG, project_id: PROJECT, number: '2026-009', title: 'Ancien', status: 'sent', valid_until: '2026-01-01' },
    { ...quoteBase, id: QUOTE_OTHER, organization_id: OTHER_ORG, project_id: OTHER_PROJECT, number: '2026-001', title: 'Autre', status: 'sent', valid_until: '2099-01-01' },
  ])
  db.seed('contracts', [
    { id: CONTRACT_SENT, organization_id: ORG, project_id: PROJECT, title: 'Contrat de prestation', body: '# Contrat', status: 'sent', sent_at: '2026-11-02T10:00:00Z', signed_at: null, signed_by_name: null, signed_via: null, created_at: '2026-11-02T10:00:00Z' },
    { id: CONTRACT_DRAFT, organization_id: ORG, project_id: PROJECT, title: 'Contrat brouillon', body: 'secret', status: 'draft', sent_at: null, signed_at: null, signed_by_name: null, signed_via: null, created_at: '2026-11-03T10:00:00Z' },
    { id: CONTRACT_OTHER, organization_id: OTHER_ORG, project_id: OTHER_PROJECT, title: 'Autre', body: '', status: 'sent', sent_at: null, signed_at: null, signed_by_name: null, signed_via: null, created_at: '2026-11-03T10:00:00Z' },
  ])
  db.seed('invoices', [
    { id: crypto.randomUUID(), organization_id: ORG, project_id: PROJECT, number: 'F-1', title: 'Acompte', kind: 'deposit', status: 'paid', total_ttc_cents: 36_000, issue_date: '2026-11-03', due_date: '2026-11-10', paid_at: '2026-11-05T10:00:00Z' },
    { id: crypto.randomUUID(), organization_id: ORG, project_id: PROJECT, number: null, title: 'Solde brouillon', kind: 'invoice', status: 'draft', total_ttc_cents: 84_000, issue_date: null, due_date: null, paid_at: null },
  ])
}

beforeEach(() => {
  db = new FakeSupabase()
  rpcs = []
  signed = []
  state.client = {
    ...db.client,
    rpc: async (name: string, args: unknown) => {
      rpcs.push({ name, args })
      return { data: crypto.randomUUID(), error: null }
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[], expires: number) => {
          signed.push(paths)
          return { data: paths.map((path) => ({ path, signedUrl: `https://storage.test/${bucket}/${path}?e=${expires}`, error: null })), error: null }
        },
      }),
    },
  }
  resetPortalRateLimits()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  seed()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function get(token: string | null, ip = '203.0.113.1'): Promise<Response> {
  const url = token === null ? `${APP}/api/portal` : `${APP}/api/portal?token=${encodeURIComponent(token)}`
  return GET(new Request(url, { headers: { 'x-forwarded-for': ip } }))
}

function post(body: unknown, ip = '203.0.113.1'): Promise<Response> {
  return POST(
    new Request(`${APP}/api/portal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }),
  )
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error
}

function notificationsOf(kind: string) {
  return db.rows('notifications').filter((n) => n.kind === kind)
}

describe('GET /api/portal', () => {
  it('404 pour un jeton absent, mal formé ou inconnu, sans requête pour un jeton mal formé', async () => {
    const fromSpy = vi.spyOn(state.client as { from: (table: string) => unknown }, 'from')
    for (const token of [null, '', 'court', 'a'.repeat(31), `${'a'.repeat(40)}!`]) {
      const response = await get(token)
      expect(response.status).toBe(404)
    }
    expect(fromSpy).not.toHaveBeenCalled()
    const unknown = await get('Z'.repeat(43))
    expect(unknown.status).toBe(404)
    expect(await errorOf(unknown)).toContain('pas valide')
  })

  it('404 quand le portail est désactivé (jeton remis à null)', async () => {
    db.rows('projects').find((p) => p.id === PROJECT)!.portal_token = null
    expect((await get(TOKEN)).status).toBe(404)
  })

  it('renvoie le projet, l’avancement et les livrables avec des URLs signées courtes', async () => {
    const response = await get(TOKEN)
    expect(response.status).toBe(200)
    expect(response.headers.get('x-robots-tag')).toContain('noindex')
    const body = (await response.json()) as PortalResponse
    expect(body.project).toEqual({
      name: 'App Ibé',
      clientName: 'Ibé',
      agencyName: 'Sordulo',
      status: 'in_progress',
      startDate: '2026-10-01',
      dueDate: '2027-01-15',
    })
    expect(body.progress).toEqual({ tasksDone: 1, tasksTotal: 2, areas: [{ area: 'Accueil', open: 1, done: 1 }] })
    expect(body.deliverables).toHaveLength(1)
    const [deliverable] = body.deliverables
    expect(deliverable?.versions.map((v) => v.version)).toEqual([1, 2])
    expect(deliverable?.versions[1]?.file.url).toBe(`https://storage.test/files/${ORG}/${PROJECT}/b-accueil-v2.png?e=600`)
    expect(signed.flat()).not.toContain(`${OTHER_ORG}/${OTHER_PROJECT}/x.png`)
    const comments = deliverable?.versions[0]?.comments ?? []
    expect(comments.map((c) => [c.authorName, c.fromClient, c.resolved])).toEqual([
      ['Claire', true, true],
      ['Sacha', false, false],
    ])
  })

  it('n’expose jamais les brouillons ni les données internes', async () => {
    const response = await get(TOKEN)
    const body = (await response.json()) as PortalResponse
    expect(body.quotes.map((q) => q.number).sort()).toEqual(['2026-009', '2026-010'])
    expect(body.quotes.find((q) => q.number === '2026-009')?.expired).toBe(true)
    expect(body.contracts.map((c) => c.title)).toEqual(['Contrat de prestation'])
    expect(body.invoices.map((i) => i.title)).toEqual(['Acompte'])
    const text = JSON.stringify(body)
    for (const secret of ['Brouillon secret', 'Contrat brouillon', 'Solde brouillon', 'interne', '@sordulo.fr', SACHA, MAEL, 'estimate', 'rebilled', 'service_id', 'organization_id', 'storage_path', 'created_by']) {
      expect(text).not.toContain(secret)
    }
  })

  it('le jeton d’un autre projet ne montre que cet autre projet', async () => {
    const body = (await (await get(OTHER_TOKEN)).json()) as PortalResponse
    expect(body.project.name).toBe('Autre')
    expect(body.quotes.map((q) => q.id)).toEqual([QUOTE_OTHER])
    expect(JSON.stringify(body)).not.toContain('App Ibé')
  })

  it('429 au-delà de la limite par jeton et adresse', async () => {
    let last: Response | null = null
    for (let i = 0; i < 91; i++) last = await get(TOKEN)
    expect(last?.status).toBe(429)
    expect((await get(TOKEN, '198.51.100.7')).status).toBe(200)
  })
})

describe('POST /api/portal : commentaires', () => {
  it('ajoute un commentaire du client épinglé, sans notification serveur (la base s’en charge)', async () => {
    const response = await post({ token: TOKEN, action: 'comment', versionId: V2, x: 0.3, y: 0.7, body: '  Bouton plus grand  ', authorName: ' Claire ' })
    expect(response.status).toBe(200)
    const result = (await response.json()) as PortalActionResponse
    expect(result.comment).toMatchObject({ x: 0.3, y: 0.7, body: 'Bouton plus grand', authorName: 'Claire', fromClient: true })
    const row = db.rows('deliverable_comments').find((c) => c.body === 'Bouton plus grand')
    expect(row).toMatchObject({ version_id: V2, from_client: true, author_name: 'Claire' })
    expect(db.rows('notifications')).toHaveLength(0)
  })

  it('refuse une version d’un autre projet', async () => {
    const response = await post({ token: TOKEN, action: 'comment', versionId: OTHER_VERSION, body: 'Coucou', authorName: 'Claire' })
    expect(response.status).toBe(404)
    expect(db.rows('deliverable_comments')).toHaveLength(2)
  })

  it('400 pour un corps invalide (épingle incomplète, texte vide, nom trop long)', async () => {
    expect((await post({ token: TOKEN, action: 'comment', versionId: V2, x: 0.3, body: 'a', authorName: 'C' })).status).toBe(400)
    expect((await post({ token: TOKEN, action: 'comment', versionId: V2, body: '   ', authorName: 'C' })).status).toBe(400)
    expect((await post({ token: TOKEN, action: 'comment', versionId: V2, body: 'a', authorName: 'C'.repeat(81) })).status).toBe(400)
    expect((await post({ token: TOKEN, action: 'comment', versionId: V2, x: 2, y: 0, body: 'a', authorName: 'C' })).status).toBe(400)
    expect((await post({ token: TOKEN, action: 'inconnue' })).status).toBe(400)
  })

  it('404 avec un jeton mal formé, avant toute requête', async () => {
    const fromSpy = vi.spyOn(state.client as { from: (table: string) => unknown }, 'from')
    const response = await post({ token: 'nope', action: 'comment', versionId: V2, body: 'a', authorName: 'C' })
    expect(response.status).toBe(404)
    expect(fromSpy).not.toHaveBeenCalled()
  })
})

describe('POST /api/portal : validation des livrables', () => {
  it('valide la dernière version et notifie les membres admin / membre du projet', async () => {
    const response = await post({ token: TOKEN, action: 'approve', versionId: V2, authorName: 'Claire', note: 'Parfait' })
    expect(response.status).toBe(200)
    expect(db.rows('deliverable_versions').find((v) => v.id === V2)).toMatchObject({ status: 'approved', decided_by_name: 'Claire' })
    expect(db.rows('deliverable_comments').some((c) => c.body === 'Parfait' && c.version_id === V2 && c.x === null)).toBe(true)
    const notifications = notificationsOf('deliverable.approved')
    // Sacha (membre du projet) ; pas Finance (rôle finance) ni Maël (pas membre du projet).
    expect(notifications.map((n) => n.member_id)).toEqual([SACHA])
    expect(notifications[0]).toMatchObject({ link: `/projects/${PROJECT}/deliverables`, organization_id: ORG })
  })

  it('demande des modifications ; 409 ensuite (déjà répondu)', async () => {
    expect((await post({ token: TOKEN, action: 'request_changes', versionId: V2, authorName: 'Claire' })).status).toBe(200)
    expect(db.rows('deliverable_versions').find((v) => v.id === V2)?.status).toBe('changes_requested')
    expect(notificationsOf('deliverable.changes_requested')).toHaveLength(1)
    expect((await post({ token: TOKEN, action: 'approve', versionId: V2, authorName: 'Claire' })).status).toBe(409)
  })

  it('409 sur une ancienne version', async () => {
    db.rows('deliverable_versions').find((v) => v.id === V1)!.status = 'pending'
    expect((await post({ token: TOKEN, action: 'approve', versionId: V1, authorName: 'Claire' })).status).toBe(409)
  })

  it('notifie les admins quand le projet n’a pas de membres', async () => {
    db.tables.project_members = []
    await post({ token: TOKEN, action: 'approve', versionId: V2, authorName: 'Claire' })
    expect(notificationsOf('deliverable.approved').map((n) => n.member_id)).toEqual([MAEL])
  })

  it('404 pour la version d’un autre projet', async () => {
    expect((await post({ token: TOKEN, action: 'approve', versionId: OTHER_VERSION, authorName: 'Claire' })).status).toBe(404)
    expect(db.rows('deliverable_versions').find((v) => v.id === OTHER_VERSION)?.status).toBe('pending')
  })
})

describe('POST /api/portal : devis', () => {
  const accept = (quoteId: string, extra: Record<string, unknown> = {}) =>
    post({ token: TOKEN, action: 'accept_quote', quoteId, authorName: 'Claire Dupont', accepted: true, ...extra })

  it('accepte un devis envoyé du projet, propose les tâches et notifie', async () => {
    const response = await accept(QUOTE_SENT)
    expect(response.status).toBe(200)
    const quote = db.rows('quotes').find((q) => q.id === QUOTE_SENT)
    expect(quote?.status).toBe('accepted')
    expect(typeof quote?.accepted_at).toBe('string')
    expect(rpcs).toEqual([{ name: 'propose_tasks_from_quote', args: { p_quote_id: QUOTE_SENT } }])
    expect(notificationsOf('quote.accepted')).toHaveLength(1)
    expect(notificationsOf('quote.accepted')[0]?.title).toContain('2026-010')
  })

  it('refuse sans la case « Bon pour accord »', async () => {
    expect((await accept(QUOTE_SENT, { accepted: false })).status).toBe(400)
    expect(db.rows('quotes').find((q) => q.id === QUOTE_SENT)?.status).toBe('sent')
  })

  it('404 pour un brouillon (invisible) ou le devis d’un autre projet', async () => {
    expect((await accept(QUOTE_DRAFT)).status).toBe(404)
    expect((await accept(QUOTE_OTHER)).status).toBe(404)
    expect(db.rows('quotes').find((q) => q.id === QUOTE_DRAFT)?.status).toBe('draft')
    expect(db.rows('quotes').find((q) => q.id === QUOTE_OTHER)?.status).toBe('sent')
    expect(rpcs).toHaveLength(0)
  })

  it('409 pour un devis déjà accepté ou expiré', async () => {
    await accept(QUOTE_SENT)
    expect((await accept(QUOTE_SENT)).status).toBe(409)
    const expired = await accept(QUOTE_EXPIRED)
    expect(expired.status).toBe(409)
    expect(await errorOf(expired)).toContain('expiré')
  })
})

describe('POST /api/portal : contrats', () => {
  const sign = (contractId: string, extra: Record<string, unknown> = {}) =>
    post({ token: TOKEN, action: 'sign_contract', contractId, signerName: 'Claire Dupont', accepted: true, ...extra })

  it('signe un contrat envoyé du projet (signed_via portal) et notifie', async () => {
    expect((await sign(CONTRACT_SENT)).status).toBe(200)
    expect(db.rows('contracts').find((c) => c.id === CONTRACT_SENT)).toMatchObject({
      status: 'signed',
      signed_by_name: 'Claire Dupont',
      signed_via: 'portal',
    })
    expect(notificationsOf('contract.signed')).toHaveLength(1)
    expect((await sign(CONTRACT_SENT)).status).toBe(409)
  })

  it('refuse un brouillon, le contrat d’un autre projet ou sans case cochée', async () => {
    expect((await sign(CONTRACT_DRAFT)).status).toBe(404)
    expect((await sign(CONTRACT_OTHER)).status).toBe(404)
    expect((await sign(CONTRACT_SENT, { accepted: 'oui' })).status).toBe(400)
    expect((await sign(CONTRACT_SENT, { signerName: '  ' })).status).toBe(400)
    expect(db.rows('contracts').filter((c) => c.status === 'signed')).toHaveLength(0)
  })
})

describe('logique du portail', () => {
  it('limiteur à fenêtre glissante', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, maxKeys: 2 })
    expect(limiter.take('a', 0)).toBe(true)
    expect(limiter.take('a', 10)).toBe(true)
    expect(limiter.take('a', 20)).toBe(false)
    expect(limiter.take('a', 1011)).toBe(true)
    expect(limiter.take('b', 1011)).toBe(true)
    expect(limiter.take('c', 1012)).toBe(true)
  })

  it('avancement : tickets validés et terminés par partie, sans partie en dernier', () => {
    expect(
      computeProgress(
        [{ status: 'done' }, { status: 'review' }],
        [
          { status: 'validated', area: null },
          { status: 'validated', area: 'Paiement' },
          { status: 'validated', area: 'Paiement' },
          { status: 'done', area: 'Accueil' },
          { status: 'rejected', area: 'Accueil' },
        ],
      ),
    ).toEqual({
      tasksDone: 1,
      tasksTotal: 2,
      areas: [
        { area: 'Paiement', open: 2, done: 0 },
        { area: 'Accueil', open: 0, done: 1 },
        { area: null, open: 1, done: 0 },
      ],
    })
  })

  it('prénom seulement pour les membres', () => {
    expect(memberDisplayName('Sacha Moricet')).toBe('Sacha')
    expect(memberDisplayName(null)).toBe('L’équipe')
  })
})
